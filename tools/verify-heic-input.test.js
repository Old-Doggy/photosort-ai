import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { Transformer } from '@napi-rs/image'
import { isHeicBuffer, normalizeImageBytes } from './image-input.js'

test('HEIC/HEIF is detected by brand and normalized to JPEG for the analyzer', { skip: process.platform !== 'win32' }, async () => {
  const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#87a99a' } }).jpeg().toBuffer()
  const heic = Buffer.from(await new Transformer(jpeg).heic({ quality: 80 }))
  assert.equal(isHeicBuffer(heic), true)
  assert.equal(isHeicBuffer(jpeg), false)
  const normalized = await normalizeImageBytes(heic)
  const metadata = await sharp(normalized).metadata()
  assert.equal(metadata.width, 64)
  assert.equal(metadata.height, 48)
  assert.equal(metadata.format, 'jpeg')
})

test('non-HEIC buffers pass through unchanged', async () => {
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()
  assert.equal((await normalizeImageBytes(jpeg)).equals(jpeg), true)
})
