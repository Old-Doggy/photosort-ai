import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { createControlServer } from './control-server.js'

test('网页模型配置持久化并传入分析器，批次结束自动释放', async () => {
  const workspace = await mkdtemp(path.resolve('artifacts/model-config-'))
  const input = path.join(workspace, '输入')
  const output = path.join(workspace, '输出')
  await mkdir(input); await mkdir(output); await writeFile(path.join(input, 'photo.jpg'), 'test')
  let receivedModel = null
  let receivedOptions = null
  let closed = 0
  const server = await createControlServer({ root: process.cwd(), controlDir: path.join(workspace, 'control'), port: 0, analyzerFactory: async (_root, _backend, model, options) => {
    receivedModel = model
    receivedOptions = options
    return { device: { name: 'test CPU' }, npuVerified: false, analyze: async () => ({ category: '风景' }), close: async () => { closed++ } }
  } })
  try {
    const get = route => fetch(server.origin + route).then(response => response.json())
    const initialResponse = await fetch(server.origin + '/api/status')
    const cookie = initialResponse.headers.get('set-cookie').split(';')[0]
    const post = async (route, body) => {
      const response = await fetch(server.origin + route, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) })
      const text = await response.text()
      assert.equal(response.status, 200, text)
      return text ? JSON.parse(text) : null
    }
    await post('/api/config', { input, output, backend: 'auto', model: 'off', visionMode: 'precision', semanticModel: 'siglip2' })
    assert.equal((await get('/api/status')).config.model, 'off')
    assert.equal((await get('/api/status')).config.visionMode, 'precision')
    assert.equal((await get('/api/status')).config.semanticModel, 'siglip2')
    await post('/api/start', {})
    for (let attempt = 0; attempt < 80; attempt++) {
      const status = await get('/api/status')
      if (status.phase === 'stopped') break
      await sleep(100)
    }
    const finished = await get('/api/status')
    assert.equal(finished.phase, 'stopped')
    assert.equal(receivedModel, 'off')
    assert.equal(receivedOptions?.visionMode, 'precision')
    assert.equal(receivedOptions?.semanticModel, 'siglip2')
    assert.equal(closed, 1)
  } finally { await server.close() }
})
