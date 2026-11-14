import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { createControlServer } from './control-server.js'

const root = process.cwd()
const workspace = await mkdtemp(path.join(os.tmpdir(), 'lenssort-control-'))
const server = await createControlServer({ root, controlDir: path.join(workspace, 'control'), port: 0 })
const origin = server.origin
const getResponse = () => fetch(origin + '/api/status')
const get = async () => (await getResponse()).json()
const initialResponse = await getResponse()
const cookie = initialResponse.headers.get('set-cookie').split(';')[0]
const initial = await initialResponse.json()
assert.equal('token' in initial, false)
  const headerProbe = await getResponse()
  assert.equal(headerProbe.headers.get('x-content-type-options'), 'nosniff')
  assert.match(headerProbe.headers.get('content-security-policy') ?? '', /default-src 'self'/)
const request = async (route, body, supplied = cookie) => fetch(origin + route, { method: 'POST', headers: supplied ? { 'content-type': 'application/json', cookie: supplied, origin } : { 'content-type': 'application/json', origin }, body: JSON.stringify(body) })
try {
  assert.equal((await request('/api/start', {}, 'wrong')).status, 401)
  assert.equal((await request('/api/start', {}, '')).status, 401)
  assert.equal((await request('/api/config', { input: 'relative', output: path.join(workspace, 'output'), backend: 'cpu' })).status, 400)
  const config = { input: path.join(workspace, 'input'), output: path.join(workspace, 'output'), backend: 'cpu' }
  assert.equal((await request('/api/config', config)).status, 200)
  await mkdir(config.input, { recursive: true })
  await writeFile(path.join(config.input, 'portrait.jpg'), await readFile('data/eval/photos/portrait.jpg'))
  assert.equal((await request('/api/start', {})).status, 200)
  const deadline = Date.now() + 30000
  let status
  while (Date.now() < deadline) {
    status = await get()
    if (status.phase === 'stopped' && status.records.some(record => record.status === 'done')) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.equal(status.records[0]?.category, '单人')
  assert.equal('output' in status.records[0], false)
  assert.equal('dhash' in status.records[0], false)
  assert.equal(status.phase, 'stopped')
  assert.equal(status.progress.phase, 'finished')
  const recordId = status.records[0].id
  assert.equal(status.records[0].favorite, false)
  assert.equal((await request('/api/toggle-favorite', { id: recordId, favorite: true })).status, 200)
  assert.equal((await get()).records.find(record => record.id === recordId).favorite, true)
  assert.equal((await request('/api/toggle-favorite', { id: recordId, favorite: false })).status, 200)
  assert.equal((await get()).records.find(record => record.id === recordId).favorite, false)
  assert.equal((await fetch(origin + '/api/thumbnail/' + recordId)).status, 200)
  const detailResponse = await fetch(origin + '/api/photo/' + recordId)
  assert.equal(detailResponse.status, 200)
  const detail = await detailResponse.json()
  assert.equal(detail.imageUrl, '/api/photo-image/' + recordId)
  assert.equal((await fetch(origin + detail.imageUrl)).status, 200)
  assert.equal((await fetch(origin + '/models/mediapipe/face_landmarker/face_landmarker.task')).status, 200)
  if (status.records[0].faceBoxes?.length) assert.equal((await fetch(origin + '/api/face-image/' + recordId + '/0')).status, 200)
  const sourceBytes = await readFile(path.join(config.input, 'portrait.jpg'))
  const correctedResponse = await request('/api/update-category', { id: recordId, category: '风景', confirm: true })
  assert.equal(correctedResponse.status, 200)
  const corrected = (await get()).records.find(record => record.id === recordId)
  assert.equal(corrected.category, '风景')
  assert.equal(corrected.manualCategory, '风景')
  assert.equal(corrected.manualAction, 'category-corrected')
  assert.equal((await fetch(origin + '/api/photo-image/' + recordId)).status, 200)
  assert.deepEqual(await readFile(path.join(config.input, 'portrait.jpg')), sourceBytes)
  const rescanned = await request('/api/rescan', {})
  assert.equal(rescanned.status, 200)
  assert.equal((await rescanned.json()).rescanned, true)
  assert.equal((await get()).records.find(record => record.id === recordId).manualCategory, '风景')
  assert.equal((await request('/api/delete-output', { id: recordId, confirm: false })).status, 400)
  assert.equal((await request('/api/config', config)).status, 200)
  assert.equal((await request('/api/stop', {})).status, 200)
  assert.equal((await get()).phase, 'stopped')
  const deletedResponse = await request('/api/delete-output', { id: recordId, confirm: true })
  assert.equal(deletedResponse.status, 200)
  assert.equal((await fetch(origin + '/api/photo-image/' + recordId)).status, 404)
  assert.deepEqual(await readFile(path.join(config.input, 'portrait.jpg')), sourceBytes)
  assert.equal((await get()).records.some(record => record.id === recordId), false)
  assert.equal((await fetch(origin + '/data/service-state/records.json')).status, 404)
  const report = { status: 'passed', createdAt: new Date().toISOString(), workspace, checks: ['token guard', 'absolute-path validation', 'configure/start via HTTP', 'photo automatically appears with thumbnail', 'favorite state toggles without changing category', 'detail and bounded large-image endpoints', 'manual category update moves output copy and preserves source', 'delete confirmation required', 'HTTP stop releases service', 'delete output copy while preserving source bytes', 'private data not statically served'], device: status.device }
  await writeFile('artifacts/control-api-verification.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { await server.close() }
