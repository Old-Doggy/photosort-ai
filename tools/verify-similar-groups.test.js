import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { buildSimilarGroups } from './similar-groups.js'

const render = async (markup) => sharp(Buffer.from(`<svg width="320" height="240" xmlns="http://www.w3.org/2000/svg">${markup}</svg>`)).jpeg().toBuffer()

test('perceptual grouping finds shifted near-duplicates without merging a different scene', async () => {
  const folder = await mkdtemp(path.resolve('artifacts/similar-groups-'))
  const base = '<rect width="320" height="240" fill="#d9e7df"/><rect x="60" y="40" width="140" height="150" fill="#2f7d61"/><circle cx="245" cy="70" r="28" fill="#e7c27e"/>'
  const files = [
    ['a.jpg', await render(base)],
    ['b.jpg', await render(base.replace('x="60"', 'x="63"'))],
    ['c.jpg', await render('<rect width="320" height="240" fill="#314b78"/><circle cx="160" cy="120" r="72" fill="#dce7ff"/>')],
  ]
  const records = []
  for (const [name, bytes] of files) {
    const output = path.join(folder, name)
    await writeFile(output, bytes)
    records.push({ id: name, name, status: 'done', output, qualityScore: name === 'a.jpg' ? 80 : 70, category: '风景' })
  }
  const result = await buildSimilarGroups({ records, threshold: 20 })
  assert.equal(result.groups.length, 1)
  assert.deepEqual(result.groups[0].photos.map(photo => photo.name).sort(), ['a.jpg', 'b.jpg'])
  assert.equal(result.groups[0].representativeId, 'a.jpg')
  assert.equal(result.groups[0].photos.some(photo => photo.name === 'c.jpg'), false)
  assert.equal(result.considered, 3)
  assert.match(result.boundary, /not duplicate truth/)
})

test('flat images are skipped instead of becoming one giant similarity group', async () => {
  const folder = await mkdtemp(path.resolve('artifacts/similar-groups-flat-'))
  const records = []
  for (const name of ['one.jpg', 'two.jpg']) {
    const output = path.join(folder, name)
    await writeFile(output, await sharp({ create: { width: 320, height: 240, channels: 3, background: '#7ea995' } }).jpeg().toBuffer())
    records.push({ id: name, name, status: 'done', output, qualityScore: 80 })
  }
  const result = await buildSimilarGroups({ records })
  assert.equal(result.groups.length, 0)
  assert.equal(result.skipped.length, 2)
})

test('persisted dhash groups without reopening the output files', async () => {
  const dhash = { hash: '00'.repeat(32), deviation: 20 }
  const records = ['a.jpg', 'b.jpg'].map((name, index) => ({ id: name, name, status: 'done', output: path.join('missing', name), hash: 'hash-' + index, dhash, qualityScore: 80 }))
  const result = await buildSimilarGroups({ records })
  assert.equal(result.groups.length, 1)
  assert.equal(result.groups[0].photos.length, 2)
  assert.equal(result.skipped.length, 0)
})

test('banded search still respects the Hamming threshold', async () => {
  const zero = Buffer.alloc(32)
  const oneBit = Buffer.from(zero); oneBit[0] = 1
  const everyBand = Buffer.from(zero)
  for (let band = 0; band < 19; band++) {
    const bit = band * 13
    everyBand[bit >> 3] |= 1 << (bit & 7)
  }
  const record = (name, hash) => ({ id: name, name, status: 'done', output: 'missing/' + name, hash: name, dhash: { hash: hash.toString('hex'), deviation: 20 }, qualityScore: 80 })
  const result = await buildSimilarGroups({ records: [record('a', zero), record('b', oneBit), record('c', everyBand)], threshold: 18 })
  assert.deepEqual(result.groups[0].photos.map(photo => photo.name).sort(), ['a', 'b'])
  assert.equal(result.groups.some(group => group.photos.some(photo => photo.name === 'c')), false)
})
