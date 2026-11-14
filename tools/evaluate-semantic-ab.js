import path from 'node:path'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createPhotoAnalyzer } from './local-photo-analyzer.js'

const root = process.argv[2] || 'data/eval/labeled'
const output = process.argv[3] || 'artifacts/semantic-ab-2026-11-12.json'
const classes = ['单人', '多人', '人物与风景', '风景', '动物', '植物', '其他']
const items = []
let manifest = null
try { manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
if (manifest?.images) {
  for (const image of manifest.images) items.push({ category: image.label, name: path.basename(image.file), file: path.join(root, image.file) })
} else {
  for (const category of classes) {
    const folder = path.join(root, category)
    let names = []
    try { names = await readdir(folder) } catch (error) { if (error.code !== 'ENOENT') throw error }
    for (const name of names.filter(name => /\.(jpg|jpeg|png|webp|tif|tiff|avif|heic|heif)$/i.test(name)).sort()) {
      items.push({ category, name, file: path.join(folder, name) })
    }
  }
}
const report = { createdAt: new Date().toISOString(), root, sampleCount: items.length, labelBoundary: manifest?.boundary ?? 'public dataset candidate folders, not independent project human adjudication', models: {} }
for (const semanticModel of ['clip', 'siglip2']) {
  const analyzer = await createPhotoAnalyzer(process.cwd(), 'cpu', 'off', { visionMode: 'off', semanticModel })
  const rows = []
  try {
    for (const item of items) {
      const started = performance.now()
      try {
        const result = await analyzer.analyze(await readFile(item.file))
        rows.push({ ...item, predicted: result.category, source: result.sceneSemantics?.source ?? null, top: result.sceneSemantics?.topLabel ?? null, ms: Math.round(performance.now() - started), error: null })
      } catch (error) {
        rows.push({ ...item, predicted: '失败', source: null, top: null, ms: Math.round(performance.now() - started), error: error.message })
      }
    }
  } finally { await analyzer.close() }
  const measured = rows.filter(row => row.predicted !== '失败')
  const correct = measured.filter(row => row.predicted === row.category).length
  const perClass = Object.fromEntries(classes.map(category => {
    const samples = measured.filter(row => row.category === category)
    const hit = samples.filter(row => row.predicted === category).length
    return [category, { support: samples.length, correct: hit, recall: samples.length ? Number((hit / samples.length).toFixed(4)) : null }]
  }))
  const macroRecall = Object.values(perClass).filter(item => item.recall !== null).reduce((sum, item) => sum + item.recall, 0) / Math.max(1, Object.values(perClass).filter(item => item.recall !== null).length)
  report.models[semanticModel] = { correct, considered: measured.length, failures: rows.length - measured.length, accuracy: measured.length ? Number((correct / measured.length).toFixed(4)) : null, macroRecall: Number(macroRecall.toFixed(4)), perClass, rows }
}
await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ status: 'passed', sampleCount: report.sampleCount, clip: { accuracy: report.models.clip.accuracy, macroRecall: report.models.clip.macroRecall }, siglip2: { accuracy: report.models.siglip2.accuracy, macroRecall: report.models.siglip2.macroRecall }, output }))
