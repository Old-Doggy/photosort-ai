import { Transformer } from '@napi-rs/image'
import { readFile } from 'node:fs/promises'
import { decodeRawBytes, isRawFileName } from './raw-input.js'

const heicBrands = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'])
const MAX_INPUT_BYTES = 128 * 1024 * 1024
const MAX_INPUT_PIXELS = 80_000_000

export function isHeicBuffer(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return false
  if (bytes.subarray(4, 8).toString('latin1') !== 'ftyp') return false
  return heicBrands.has(bytes.subarray(8, 12).toString('latin1').toLowerCase())
}

export async function normalizeImageBytes(bytes, { fileName } = {}) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error('图片内容为空')
  if (bytes.length > MAX_INPUT_BYTES) throw new Error('图片文件超过 128 MiB 限制')
  if (isRawFileName(fileName)) return await decodeRawBytes(bytes)
  if (!isHeicBuffer(bytes)) return bytes
  try {
    const transformer = new Transformer(bytes)
    const metadata = await transformer.metadata()
    if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height) || metadata.width < 1 || metadata.height < 1) throw new Error('HEIC/HEIF 尺寸不可用')
    if (metadata.width * metadata.height > MAX_INPUT_PIXELS) throw new Error(`图片尺寸 ${metadata.width}×${metadata.height} 超过 80MP 限制`)
    const jpeg = await transformer.rotate().jpeg(92)
    return Buffer.from(jpeg)
  } catch (error) {
    throw new Error(`HEIC/HEIF 解码失败：${error instanceof Error ? error.message : String(error)}；请确认 Windows HEIF/HEVC 扩展可用`)
  }
}

export async function imageBytesForDisplay(source) {
  return normalizeImageBytes(await readFile(source), { fileName: source })
}
