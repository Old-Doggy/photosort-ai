import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import sharp from 'sharp'
import { createControlServer } from './control-server.js'

test('two manual scene corrections become a suggestion without auto-changing pending photos', async () => {
  const workspace = await mkdtemp(path.resolve('artifacts/preference-api-'))
  const input = path.join(workspace, '输入')
  const output = path.join(workspace, '输出')
  await mkdir(input); await mkdir(output)
  for (const [name, color] of [['a.jpg', '#88aa99'], ['b.jpg', '#aa8899'], ['c.jpg', '#9988aa']]) {
    await writeFile(path.join(input, name), await sharp({ create: { width: 80, height: 60, channels: 3, background: color } }).jpeg().toBuffer())
  }
  const server = await createControlServer({ root: process.cwd(), controlDir: path.join(workspace, 'control'), port: 0,
    analyzerFactory: async () => ({ device: { name: 'test CPU' }, analyze: async () => ({ category: '待确认', sceneLabel: '同一场景', reason: 'fixture', qualityScore: 60 }), close: async () => {} }),
  })
  try {
    const get = async route => (await fetch(server.origin + route)).json()
    const initialResponse = await fetch(server.origin + '/api/status')
    const cookie = initialResponse.headers.get('set-cookie').split(';')[0]
    const post = async (route, body) => {
      const response = await fetch(server.origin + route, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) })
      const text = await response.text()
      assert.equal(response.status, 200, text)
      return text ? JSON.parse(text) : null
    }
    await post('/api/config', { input, output, backend: 'cpu', model: 'off', visionMode: 'off' })
    await post('/api/start', {})
    for (let attempt = 0; attempt < 100; attempt++) {
      const status = await get('/api/status')
      if (status.phase === 'stopped' && status.records.length === 3) break
      await sleep(100)
    }
    const before = await get('/api/status')
    assert.equal(before.records.length, 3)
    const [first, second, third] = before.records
    // Concurrent requests must either commit independently or explicitly reject
    // contention; a successful response must never be lost to another writer.
    const favoriteResponses = await Promise.all([first, second].map(record => fetch(server.origin + '/api/toggle-favorite', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ id: record.id, favorite: true }),
    })))
    for (const [index, response] of favoriteResponses.entries()) {
      assert.ok([200, 409].includes(response.status))
      if (response.status === 409) await post('/api/toggle-favorite', { id: [first, second][index].id, favorite: true })
    }
    const favorites = await get('/api/status')
    assert.equal(favorites.records.filter(record => record.favorite).length, 2, 'successful concurrent writes must both survive')
    await post('/api/update-category', { id: first.id, category: '风景', confirm: true })
    await post('/api/update-category', { id: second.id, category: '风景', confirm: true })
    const after = await get('/api/status')
    const pending = after.records.find(record => record.id === third.id)
    assert.equal(pending.category, '待确认')
    assert.deepEqual(pending.preferenceSuggestion, { category: '风景', count: 2, total: 2, sceneLabel: '同一场景' })
    const summary = await fetch(server.origin + '/api/preferences')
    assert.equal(summary.status, 404)
  } finally { await server.close() }
})
