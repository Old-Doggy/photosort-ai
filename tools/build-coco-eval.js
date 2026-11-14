import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const annotationRoot = process.env.COCO_ANNOTATIONS || path.join(process.env.TEMP, 'coco-ann')
const output = path.resolve(process.argv[2] || 'data/eval/public-coco')
const quotas = { 单人: 12, 多人: 12, 人物与风景: 12, 动物: 12, 植物: 12, 风景: 12, 其他: 12 }
const landscapeWords = /\b(beach|ocean|sea|mountain|lake|forest|field|sunset|sunrise|sky|river|waterfall|desert|valley|coast|snow|landscape|countryside|park|island|harbor|cliff)\b/i
const plantWords = /\b(flower|flowers|plant|plants|tree|trees|garden|leaf|leaves|grass|potted plant|orchid|rose)\b/i
const animalIds = new Set([16, 17, 18, 19, 20, 21, 22, 23, 24, 25])
const personId = 1
const instances = JSON.parse(await readFile(path.join(annotationRoot, 'instances_val2017.json'), 'utf8'))
const captions = JSON.parse(await readFile(path.join(annotationRoot, 'captions_val2017.json'), 'utf8'))
const captionByImage = new Map()
for (const caption of captions.annotations) {
  const list = captionByImage.get(caption.image_id) ?? []
  list.push(caption.caption)
  captionByImage.set(caption.image_id, list)
}
const byImage = new Map()
for (const annotation of instances.annotations) {
  const entry = byImage.get(annotation.image_id) ?? { person: 0, animals: 0, plant: 0 }
  if (annotation.category_id === personId) entry.person++
  if (animalIds.has(annotation.category_id)) entry.animals++
  if (annotation.category_id === 64) entry.plant++
  byImage.set(annotation.image_id, entry)
}
const candidates = []
for (const image of instances.images) {
  const evidence = byImage.get(image.id) ?? { person: 0, animals: 0, plant: 0 }
  const text = (captionByImage.get(image.id) ?? []).join(' ')
  const landscape = landscapeWords.test(text)
  const plant = evidence.plant > 0 || plantWords.test(text)
  let label = null
  if (evidence.person >= 2) label = '多人'
  else if (evidence.person >= 1 && landscape) label = '人物与风景'
  else if (evidence.person === 1) label = '单人'
  else if (evidence.animals > 0) label = '动物'
  else if (plant) label = '植物'
  else if (landscape) label = '风景'
  else if (text) label = '其他'
  if (label) candidates.push({ image, label, evidence, text, landscape, plant })
}
const selected = []
for (const [label, quota] of Object.entries(quotas)) {
  const rows = candidates.filter(item => item.label === label).slice(0, quota)
  selected.push(...rows)
}
if (selected.length < 60) throw new Error(`Not enough COCO samples: ${selected.length}`)
await mkdir(path.join(output, 'images'), { recursive: true })
const manifest = { createdAt: new Date().toISOString(), source: 'COCO val2017 instances + captions (human annotations)', boundary: 'public dataset annotations/captions; not independent project human adjudication', images: [] }
for (const item of selected) {
  const filename = item.image.id + '.jpg'
  const response = await fetch(item.image.coco_url || `http://images.cocodataset.org/val2017/${item.image.file_name}`, { signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error(`image ${item.image.id}: HTTP ${response.status}`)
  await writeFile(path.join(output, 'images', filename), Buffer.from(await response.arrayBuffer()))
  manifest.images.push({ file: 'images/' + filename, label: item.label, cocoId: item.image.id, cocoUrl: item.image.coco_url, flickrUrl: item.image.flickr_url, licenseId: item.image.license, captions: item.text.slice(0, 400), evidence: item.evidence })
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(JSON.stringify({ status: 'passed', output, count: manifest.images.length, byLabel: Object.fromEntries(Object.keys(quotas).map(label => [label, manifest.images.filter(image => image.label === label).length])) }))
