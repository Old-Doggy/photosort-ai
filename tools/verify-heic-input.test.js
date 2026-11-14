import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { Transformer } from '@napi-rs/image'
import { isHeicBuffer, normalizeImageBytes } from './image-input.js'

test('HEIC/HEIF is detected by brand and normalized to JPEG for the analyzer', { skip: process.platform !== 'win32' }, async context => {
  const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#87a99a' } }).jpeg().toBuffer()
  let heic
  try { heic = Buffer.from(await new Transformer(jpeg).heic({ quality: 80 })) }
  catch (error) {
    if (/OS HEVC\/HEIF codec is not installed/i.test(error.message)) {
      context.skip('Optional Windows HEIF/HEVC system codecs are not installed')
      return
    }
    throw error
  }
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

test('HEIC brand detection and malformed input errors do not require system codecs', async () => {
  const invalid = Buffer.alloc(24)
  invalid.write('ftyp', 4)
  invalid.write('heic', 8)
  assert.equal(isHeicBuffer(invalid), true)
  assert.equal(isHeicBuffer(Buffer.alloc(8)), false)
  await assert.rejects(normalizeImageBytes(invalid), /HEIC\/HEIF 解码失败/)
})
