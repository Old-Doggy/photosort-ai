import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { applyLegacyEnvironment } from './runtime-compat.js'
import { createControlServer } from './control-server.js'

test('legacy launcher overrides remain usable and explicit current values win', () => {
  const environment = { LENSSORT_PORT: '4350', LENSSORT_CONTROL_DIR: 'legacy-state', LENSSORT_OLLAMA_URL: 'http://localhost:11435', PHOTOSORT_PORT: '4351' }
  applyLegacyEnvironment(environment)
  assert.equal(environment.PHOTOSORT_PORT, '4351')
  assert.equal(environment.PHOTOSORT_CONTROL_DIR, 'legacy-state')
  assert.equal(environment.PHOTOSORT_OLLAMA_URL, 'http://localhost:11435')
})

test('renaming preserves saved folder configuration and accepts existing authenticated clients', async () => {
  const root = await mkdtemp(path.resolve('artifacts/rename-compat-'))
  const controlDir = path.join(root, 'control')
  await mkdir(controlDir)
  const config = { input: path.join(root, 'inbox'), output: path.join(root, 'sorted'), backend: 'cpu', model: 'off' }
  await writeFile(path.join(controlDir, 'config.json'), JSON.stringify(config))
  const server = await createControlServer({ root: process.cwd(), controlDir, port: 0 })
  try {
    const status = await (await fetch(server.origin + '/api/status')).json()
    assert.equal(status.config.input, config.input)
    assert.equal(status.config.output, config.output)
    for (const header of ['x-lenssort-token', 'x-photosort-token']) {
      const request = token => fetch(server.origin + '/api/stop', { method: 'POST', headers: { 'content-type': 'application/json', [header]: token }, body: '{}' })
      assert.equal((await request('wrong')).status, 403)
      assert.equal((await request(status.token)).status, 200)
    }
  } finally { await server.close() }
})
