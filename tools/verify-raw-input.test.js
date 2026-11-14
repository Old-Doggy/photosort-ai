import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { access, readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { normalizeImageBytes } from './image-input.js'

const sample = path.resolve('data/eval/raw/sample.orf')
let hasSample = true
try { await access(sample) } catch { hasSample = false }

test('RAW sample decodes through rawpy before image analysis', { skip: !hasSample }, async () => {
  const bytes = await readFile(sample)
  const jpeg = await normalizeImageBytes(bytes, { fileName: 'sample.orf' })
  const metadata = await sharp(jpeg).metadata()
  assert.equal(metadata.format, 'jpeg')
  assert.equal(metadata.width, 1600)
  assert.equal(metadata.height, 1199)
  assert.ok(jpeg.length > 100_000)
})

test('non-RAW name does not invoke the RAW decoder', async () => {
  const jpeg = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#88aa99' } }).jpeg().toBuffer()
  const output = await normalizeImageBytes(jpeg, { fileName: 'ordinary.jpg' })
  assert.equal(output.equals(jpeg), true)
})
