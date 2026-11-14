import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { createFolderSorter } from './folder-sorter.js'
const fixture = async () => {
  const root = await mkdtemp(path.resolve('artifacts/migration-'))
  const input = path.join(root, '输入')
  await mkdir(input)
  const source = path.join(input, '原图.jpg')
  await writeFile(source, 'original-content')
  return { source, options: { input, output: path.join(root, '输出'), stateDir: path.join(root, '状态'), batch: true, pollMs: 20, stableMs: 40 } }
}
test('version upgrade retains manual label on same content and source bytes', async () => {
  const { source, options } = await fixture()
  const initial = await createFolderSorter({ ...options, analysisVersion: 1, analyze: async () => ({ category: '单人' }) })
  await initial.finished
  await initial.updateCategory(source, '风景')
  const next = await createFolderSorter({ ...options, analysisVersion: 2, analyze: async () => ({ category: '多人' }) })
  try {
    await next.finished
    const state = JSON.parse(await readFile(path.join(options.stateDir, 'records.json'), 'utf8'))
    assert.equal(state.sources[source].result.category, '风景')
    assert.equal(state.sources[source].manualCategory, '风景')
    assert.equal(await readFile(source, 'utf8'), 'original-content')
  } finally { await next.close() }
})
test('version upgrade never recreates a manually deleted output', async () => {
  const { source, options } = await fixture()
  const initial = await createFolderSorter({ ...options, analysisVersion: 1, analyze: async () => ({ category: '单人' }) })
  await initial.finished
  await initial.deleteOutput(source)
  let calls = 0
  const next = await createFolderSorter({ ...options, analysisVersion: 2, analyze: async () => { calls++; return { category: '多人' } } })
  try {
    await next.finished
    const state = JSON.parse(await readFile(path.join(options.stateDir, 'records.json'), 'utf8'))
    assert.equal(state.sources[source].status, 'output-deleted')
    assert.equal(calls, 0)
    assert.equal(await readFile(source, 'utf8'), 'original-content')
  } finally { await next.close() }
})

test('an empty stale service lock is recovered instead of blocking startup', async () => {
  const root = await mkdtemp(path.resolve('artifacts/lock-recovery-'))
  const input = path.join(root, '输入')
  const output = path.join(root, '输出')
  const stateDir = path.join(root, '状态')
  await mkdir(input); await mkdir(stateDir)
  await writeFile(path.join(stateDir, 'service.lock'), '')
  const sorter = await createFolderSorter({ input, output, stateDir, batch: false, pollMs: 50, stableMs: 100, analyze: async () => ({ category: '单人' }) })
  await sorter.close()
})
