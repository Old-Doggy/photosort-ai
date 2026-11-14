import sharp from 'sharp'
import { imageBytesForDisplay } from './image-input.js'

export function createThumbnailer({ limit = 2, max = 64 } = {}) {
  const cache = new Map()
  const queue = []
  let active = 0
  const withSlot = task => new Promise((resolve, reject) => {
    const run = async () => {
      active++
      try { resolve(await task()) }
      catch (error) { reject(error) }
      finally { active--; queue.shift()?.() }
    }
    if (active < limit) void run()
    else queue.push(run)
  })
  return async record => {
    const key = record.id + ':' + (record.hash ?? '')
    if (cache.has(key)) return cache.get(key)
    return await withSlot(async () => {
      if (cache.has(key)) return cache.get(key)
      const thumbnail = await sharp(await imageBytesForDisplay(record.output), { limitInputPixels: 80_000_000 })
        .rotate().resize(640, 480, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()
      if (cache.size >= max) cache.delete(cache.keys().next().value)
      cache.set(key, thumbnail)
      return thumbnail
    })
  }
}
