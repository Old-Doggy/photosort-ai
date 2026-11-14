import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises'
import { createControlServer } from './control-server.js'

test('a corrupt config is backed up and the server can still start', async () => {
  const workspace = await mkdtemp(path.resolve('artifacts/config-recovery-'))
  const controlDir = path.join(workspace, 'control')
  await mkdir(controlDir)
  await writeFile(path.join(controlDir, 'config.json'), '{ broken json')
  const server = await createControlServer({
    root: process.cwd(),
    controlDir,
    port: 0,
    analyzerFactory: async () => ({ device: { name: 'test CPU' }, analyze: async () => ({ category: '风景' }), close: async () => {} }),
  })
  try {
    const status = await (await fetch(server.origin + '/api/status')).json()
    assert.match(status.configWarning, /配置文件损坏/)
    assert.ok((await readdir(controlDir)).some(name => name.startsWith('config.json.corrupt-')))
  } finally { await server.close() }
})
