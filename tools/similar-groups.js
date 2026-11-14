import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { normalizeImageBytes } from './image-input.js'

const hashCache = new Map()
const bandCount = 19
const bandBits = 13

function bandKey(hash, band) {
  let value = 0
  for (let bit = 0; bit < bandBits; bit++) {
    const absolute = band * bandBits + bit
    if (absolute >= hash.length * 8) break
    value |= ((hash[absolute >> 3] >> (absolute & 7)) & 1) << bit
  }
  return band + ':' + value
}

function hamming(left, right) {
  let count = 0
  for (let index = 0; index < left.length; index++) {
    let value = left[index] ^ right[index]
    while (value) { count += value & 1; value >>>= 1 }
  }
  return count
}

export async function computeDifferenceHash(bytes) {
  const image = await sharp(bytes, { limitInputPixels: 80_000_000 }).rotate().resize(17, 16, { fit: 'fill' }).greyscale().raw().toBuffer()
  const bits = new Uint8Array(32)
  let deviation = 0
  let mean = 0
  for (const value of image) mean += value
  mean /= image.length
  for (let index = 0; index < image.length; index++) deviation += (image[index] - mean) ** 2
  let bit = 0
  for (let row = 0; row < 16; row++) for (let column = 0; column < 16; column++) {
    if (image[row * 17 + column] > image[row * 17 + column + 1]) bits[bit >> 3] |= 1 << (bit & 7)
    bit++
  }
  return { hash: bits, deviation: Math.sqrt(deviation / image.length) }
}

export async function buildSimilarGroups({ records, threshold = 18, maxGroups = 80 } = {}) {
  const candidates = records.filter(record => record.status === 'done' && typeof record.output === 'string').slice(0, 2000)
  const items = []
  const skipped = []
  for (const record of candidates) {
    try {
      let hash = null
      let deviation = null
      if (/^[a-f0-9]{64}$/i.test(record.dhash?.hash ?? '')) {
        hash = Buffer.from(record.dhash.hash, 'hex')
        deviation = Number(record.dhash.deviation)
      } else {
        const cacheKey = record.hash || record.id
        const cached = hashCache.get(cacheKey)
        if (cached) ({ hash, deviation } = cached)
        else {
          ({ hash, deviation } = await computeDifferenceHash(await normalizeImageBytes(await readFile(record.output), { fileName: record.name })))
          hashCache.set(cacheKey, { hash, deviation })
          if (hashCache.size > 2048) hashCache.delete(hashCache.keys().next().value)
        }
      }
      if (!hash || !Number.isFinite(deviation)) throw new Error('感知指纹不可用')
      if (deviation < 6) { skipped.push({ id: record.id, reason: '低信息/纯色图片不参与感知聚类' }); continue }
      items.push({ record, hash, deviation })
    } catch (error) { skipped.push({ id: record.id, reason: error.message }) }
  }
  const groups = []
  const bandIndex = new Map()
  const indexGroup = group => {
    for (let band = 0; band < bandCount; band++) {
      const key = bandKey(group.representative.hash, band)
      if (!bandIndex.has(key)) bandIndex.set(key, new Set())
      bandIndex.get(key).add(group)
    }
  }
  for (const item of items) {
    let best = null
    const candidatesInBand = new Set()
    if (threshold <= 18) {
      for (let band = 0; band < bandCount; band++) for (const group of bandIndex.get(bandKey(item.hash, band)) ?? []) candidatesInBand.add(group)
    } else {
      for (const group of groups) candidatesInBand.add(group)
    }
    for (const group of candidatesInBand) {
      const distance = hamming(item.hash, group.representative.hash)
      if (distance <= threshold && (!best || distance < best.distance)) best = { group, distance }
    }
    if (best) {
      best.group.members.push({ ...item, distance: best.distance })
      if ((item.record.qualityScore ?? -1) > (best.group.representative.record.qualityScore ?? -1) &&
        best.group.members.every(member => hamming(member.hash, item.hash) <= threshold)) {
        best.group.representative = item
        for (const member of best.group.members) member.distance = hamming(member.hash, item.hash)
        indexGroup(best.group)
      }
    } else {
      const group = { representative: item, members: [{ ...item, distance: 0 }] }
      groups.push(group)
      indexGroup(group)
    }
  }
  const output = groups
    .filter(group => group.members.length > 1)
    .sort((left, right) => right.members.length - left.members.length || (right.representative.record.qualityScore ?? -1) - (left.representative.record.qualityScore ?? -1))
    .slice(0, maxGroups)
    .map((group, index) => ({
      id: 'similar-' + (index + 1),
      representativeId: group.representative.record.id,
      reason: '按画面结构近似聚类；相似不等于同一张照片，也不会自动删除任何副本',
      photos: group.members
        .sort((left, right) => (right.record.qualityScore ?? -1) - (left.record.qualityScore ?? -1))
        .map(member => ({
          id: member.record.id,
          name: member.record.name,
          category: member.record.category ?? '待确认',
          qualityScore: member.record.qualityScore ?? null,
          favorite: member.record.favorite === true,
          distance: member.distance,
          imageUrl: '/api/thumbnail/' + member.record.id,
        })),
    }))
  return { groups: output, considered: candidates.length, groupedPhotos: output.reduce((total, group) => total + group.photos.length, 0), skipped, threshold, generatedAt: new Date().toISOString(), boundary: 'perceptual similarity candidate, not duplicate truth; no deletion or accuracy claim' }
}
