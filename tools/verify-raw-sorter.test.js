import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { createFolderSorter } from './folder-sorter.js'
import { normalizeImageBytes } from './image-input.js'

const sample = path.resolve('data/eval/raw/sample.orf')
let hasSample = true
try { await access(sample) } catch { hasSample = false }

test('folder sorter accepts RAW, decodes it for analysis, and copies original bytes', { skip: !hasSample }, async () => {
  const workspace = await mkdtemp(path.resolve('artifacts/raw-sorter-'))
  const input = path.join(workspace, '输入')
  const output = path.join(workspace, '输出')
  const stateDir = path.join(workspace, '状态')
  await mkdir(input)
  const source = path.join(input, 'sample.orf')
  const original = await readFile(sample)
  await writeFile(source, original)
  let calls = 0
  const sorter = await createFolderSorter({
    input, output, stateDir, batch: true, pollMs: 20, stableMs: 40, analysisVersion: 9,
    analyze: async (bytes, meta) => {
      calls++
      assert.equal(meta.fileName, 'sample.orf')
      const jpeg = await normalizeImageBytes(bytes, { fileName: meta.fileName })
      assert.equal((await sharp(jpeg).metadata()).width, 1600)
      return { category: '风景', reason: 'RAW fixture', durationMs: 1 }
    },
  })
  try {
    await sorter.finished
    const state = JSON.parse(await readFile(path.join(stateDir, 'records.json'), 'utf8'))
    const record = state.sources[source]
    assert.equal(record.status, 'done')
    assert.equal(record.result.category, '风景')
    assert.match(record.output, /\.orf$/)
    assert.equal((await readFile(record.output)).equals(original), true)
    assert.equal((await readFile(source)).equals(original), true)
    assert.equal(calls, 1)
  } finally { await sorter.close() }
})
