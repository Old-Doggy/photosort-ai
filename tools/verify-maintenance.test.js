import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, mkdir, writeFile, readFile, readdir, access, utimes } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { createControlServer } from './control-server.js'
import { createFolderSorter } from './folder-sorter.js'

async function workspace() {
  const root = await mkdtemp(path.resolve('artifacts/maintenance-'))
  const input = path.join(root, 'input')
  const output = path.join(root, 'output')
  const stateDir = path.join(root, 'state')
  const controlDir = path.join(root, 'control')
  for (const folder of [input, output, stateDir, controlDir]) await mkdir(folder)
  return { root, input, output, stateDir, controlDir }
}

test('corrupt config is backed up verbatim and defaults allow startup', async () => {
  const fixture = await workspace()
  const original = '{ interrupted'
  await writeFile(path.join(fixture.controlDir, 'config.json'), original)
  const server = await createControlServer({ root: process.cwd(), controlDir: fixture.controlDir, port: 0 })
  try {
    const status = await (await fetch(server.origin + '/api/status')).json()
    assert.match(status.configWarning, /配置文件损坏/)
    const backup = (await readdir(fixture.controlDir)).find(name => name.startsWith('config.json.corrupt-'))
    assert.ok(backup)
    assert.equal(await readFile(path.join(fixture.controlDir, backup), 'utf8'), original)
  } finally { await server.close() }
})

test('empty stale lock is recovered but a live process lock is preserved', async () => {
  const fixture = await workspace()
  const lock = path.join(fixture.stateDir, 'service.lock')
  await writeFile(lock, '')
  await assert.rejects(createFolderSorter({ ...fixture, batch: true, analyze: async () => ({ category: '风景' }) }), /being initialized/)
  await utimes(lock, new Date(0), new Date(0))
  const sorter = await createFolderSorter({ ...fixture, batch: true, analyze: async () => ({ category: '风景' }) })
  await sorter.finished
  await sorter.close()
  await assert.rejects(access(lock), { code: 'ENOENT' })
  const liveLock = JSON.stringify({ pid: process.pid })
  await writeFile(lock, liveLock)
  await assert.rejects(createFolderSorter({ ...fixture, batch: true, analyze: async () => ({ category: '风景' }) }), /already running/)
  assert.equal(await readFile(lock, 'utf8'), liveLock)
})

test('rescan during final analysis completes without a shutdown deadlock', async () => {
  const fixture = await workspace()
  await writeFile(path.join(fixture.input, 'last.jpg'), 'last')
  let started
  let release
  const ready = new Promise(resolve => { started = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const sorter = await createFolderSorter({ ...fixture, batch: true, pollMs: 20, stableMs: 40,
    analyze: async () => { started(); await gate; return { category: '风景' } },
  })
  try {
    await ready
    const rescan = sorter.rescan()
    release()
    const results = await Promise.race([Promise.all([rescan, sorter.finished]), sleep(2000).then(() => { throw new Error('shutdown deadlock') })])
    assert.equal(results[1].phase, 'finished')
  } finally { release(); await sorter.close() }
})

test('overlapping favorite writes cannot silently lose a successful update', async () => {
  const fixture = await workspace()
  for (const name of ['one.jpg', 'two.jpg']) await writeFile(path.join(fixture.input, name), name)
  const server = await createControlServer({ root: process.cwd(), controlDir: fixture.controlDir, port: 0,
    analyzerFactory: async () => ({ device: { name: 'test CPU' }, analyze: async () => ({ category: '风景' }), close: async () => {} }),
  })
  try {
    const get = async () => (await fetch(server.origin + '/api/status')).json()
    const token = (await get()).token
    const post = (route, body) => fetch(server.origin + route, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-photosort-token': token }, body: JSON.stringify(body) })
    assert.equal((await post('/api/config', { input: fixture.input, output: fixture.output, backend: 'cpu', model: 'off' })).status, 200)
    assert.equal((await post('/api/start', {})).status, 200)
    let status
    for (let attempt = 0; attempt < 100; attempt++) {
      status = await get()
      if (status.phase === 'stopped' && status.records.length === 2) break
      await sleep(50)
    }
    assert.equal(status.records.length, 2)
    const responses = await Promise.all(status.records.map(record => post('/api/toggle-favorite', { id: record.id, favorite: true })))
    for (const [index, response] of responses.entries()) {
      assert.ok([200, 409].includes(response.status))
      if (response.status === 409) assert.equal((await post('/api/toggle-favorite', { id: status.records[index].id, favorite: true })).status, 200)
    }
    assert.equal((await get()).records.filter(record => record.favorite).length, 2)
    for (const record of status.records) assert.equal(await readFile(path.join(fixture.input, record.name), 'utf8'), record.name)
  } finally { await server.close() }
})
