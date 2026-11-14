import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { access, copyFile, mkdir, mkdtemp } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { createControlServer } from './control-server.js'

const sample = path.resolve('data/eval/raw/sample.orf')
let hasSample = true
try { await access(sample) } catch { hasSample = false }

test('RAW thumbnails and large preview are decoded by the HTTP layer', { skip: !hasSample }, async () => {
  const workspace = await mkdtemp(path.resolve('artifacts/raw-preview-'))
  const input = path.join(workspace, '输入')
  const output = path.join(workspace, '输出')
  await mkdir(input); await mkdir(output)
  await copyFile(sample, path.join(input, 'sample.orf'))
  const server = await createControlServer({ root: process.cwd(), controlDir: path.join(workspace, 'control'), port: 0,
    analyzerFactory: async () => ({ device: { name: 'test CPU' }, analyze: async (_bytes, meta) => {
      assert.equal(meta?.fileName, 'sample.orf')
      return { category: '风景', reason: 'RAW preview fixture' }
    }, close: async () => {} }),
  })
  try {
    const initialResponse = await fetch(server.origin + '/api/status')
    const cookie = initialResponse.headers.get('set-cookie').split(';')[0]
    const post = async (route, body) => {
      const response = await fetch(server.origin + route, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) })
      const text = await response.text()
      assert.equal(response.status, 200, text)
      return text ? JSON.parse(text) : null
    }
    await post('/api/config', { input, output, backend: 'cpu', model: 'off', visionMode: 'off', semanticModel: 'clip' })
    await post('/api/start', {})
    let status
    for (let attempt = 0; attempt < 120; attempt++) {
      status = await (await fetch(server.origin + '/api/status')).json()
      if (status.phase === 'stopped' && status.records.length === 1) break
      await sleep(100)
    }
    assert.equal(status.records.length, 1)
    const id = status.records[0].id
    for (const route of ['/api/thumbnail/' + id, '/api/photo-image/' + id]) {
      const response = await fetch(server.origin + route)
      assert.equal(response.status, 200)
      assert.match(response.headers.get('content-type') ?? '', /image\/jpeg/)
      assert.ok((await response.arrayBuffer()).byteLength > 10_000)
    }
    const curation = await post('/api/curate', {})
    assert.equal(curation.curation.phase, 'finished')
  } finally { await server.close() }
})
