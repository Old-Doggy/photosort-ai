import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import { randomBytes, createHash } from 'node:crypto'
import { readFile, mkdir, stat, lstat, unlink, rename } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { analyzePhotoQuality, createPhotoAnalyzer } from './local-photo-analyzer.js'
import { createFolderSorter, deleteFolderOutput, rescanFolderState, toggleFolderFavorite, updateFolderCategory } from './folder-sorter.js'
import { listInferenceDevices } from './inference-devices.js'
import { curatePhotos, validatePhotoSource } from './photo-curator.js'
import { applyPublicReviewLabel, readPublicReview, resolveReviewSource, reviewStatus } from './public-review.js'
import { createLaionAestheticScorer } from './laion-aesthetic-scorer.js'
import { createMusiqAestheticScorer } from './musiq-aesthetic-scorer.js'
import { modelProfiles } from './model-resource-policy.js'
import { inspectModelOptions } from './model-resources.js'
import { scoreCurationBatch } from './curation-scoring.js'
import { buildSimilarGroups } from './similar-groups.js'
import { imageBytesForDisplay, normalizeImageBytes } from './image-input.js'
import { writeAtomicJson } from './atomic-state.js'
import { mapLimit } from './async-utils.js'
import { createThumbnailer } from './control-thumbnails.js'
import { projectRecord } from './control-record-view.js'
import { loadPreferenceProfile, recordPreference, savePreferenceProfile } from './preference-store.js'
import { reviewCategorySet } from './review-categories.js'

const execute = promisify(execFile)
const publicCurationDetail = detail => detail ? Object.fromEntries(Object.entries(detail).filter(([key]) => key !== 'output')) : null

async function chooseFolder(current) {
  if (process.platform !== 'win32') throw Object.assign(new Error('系统文件夹选择器目前仅支持 Windows；请直接输入绝对路径'), { status: 400 })
  const selectedFile = path.join(os.tmpdir(), 'lenssort-folder-' + randomBytes(12).toString('hex') + '.txt')
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = '选择 LensSort 照片文件夹'",
    '$dialog.ShowNewFolderButton = $true',
    '$dialog.SelectedPath = $env:LENSORT_INITIAL_PATH',
    `if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [System.IO.File]::WriteAllText($env:LENSORT_SELECTED_FILE, $dialog.SelectedPath, [System.Text.UTF8Encoding]::new($false)) }`,
  ].join('; ')
  try {
    await execute('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: false, timeout: 300000, maxBuffer: 16384, env: { ...process.env, LENSORT_INITIAL_PATH: String(current || ''), LENSORT_SELECTED_FILE: selectedFile } })
    const selected = (await readFile(selectedFile, 'utf8')).trim()
    return selected ? path.resolve(selected) : null
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  } finally { await unlink(selectedFile).catch(() => {}) }
}

export async function createControlServer({ root, controlDir = path.join(root, 'data/control'), port = 4317, analyzerFactory = createPhotoAnalyzer }) {
  await mkdir(controlDir, { recursive: true })
  const token = randomBytes(24).toString('hex')
  const devices = await listInferenceDevices(root)
  const defaultBackend = devices.find(device => device.id === 'igpu')?.id ?? devices.find(device => device.id === 'dgpu')?.id ?? 'cpu'
  let config = { input: path.join(root, 'data/inbox'), output: path.join(root, 'data/sorted'), backend: defaultBackend, model: 'auto', visionMode: 'balanced', semanticModel: 'auto' }
  let configWarning = null
  const configFile = path.join(controlDir, 'config.json')
  const preferenceFile = path.join(controlDir, 'preferences.json')
  let preferenceProfile = await loadPreferenceProfile(preferenceFile)
  let preferenceSave = Promise.resolve()
  const persistPreferences = () => {
    const snapshot = preferenceProfile
    preferenceSave = preferenceSave
      .then(() => savePreferenceProfile(preferenceFile, snapshot))
      .catch(() => {})
    return preferenceSave
  }
  try {
    const saved = JSON.parse(await readFile(configFile, 'utf8'))
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new SyntaxError('Invalid config object')
    const backend = devices.some(device => device.id === saved.backend) ? saved.backend : defaultBackend
    const inputBroken = typeof saved.input !== 'string' || saved.input.includes('\ufffd')
    const outputBroken = typeof saved.output !== 'string' || saved.output.includes('\ufffd')
    const model = saved.model === 'auto' || modelProfiles().some(item => item.id === saved.model) ? saved.model : 'auto'
    const visionMode = ['off', 'balanced', 'precision'].includes(saved.visionMode) ? saved.visionMode : 'balanced'
    const semanticModel = ['auto', 'siglip2', 'clip'].includes(saved.semanticModel) ? saved.semanticModel : 'auto'
    config = { input: inputBroken ? config.input : path.resolve(saved.input), output: outputBroken ? config.output : path.resolve(saved.output), backend, model, visionMode, semanticModel, forceModel: saved.forceModel === true }
    if (inputBroken || outputBroken) configWarning = '检测到旧配置中的路径编码损坏，已恢复默认目录；请重新选择文件夹。'
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    if (error instanceof SyntaxError) {
      await rename(configFile, configFile + '.corrupt-' + Date.now()).catch(() => {})
      configWarning = '配置文件损坏，已保留备份并使用默认目录；请重新选择文件夹。'
    }
  }
  const stateDir = () => path.join(controlDir, createHash('sha256').update(config.input + '\n' + config.output).digest('hex').slice(0, 24))
  let phase = 'stopped'
  let errorMessage = null
  let analyzer
  let lastDevice = null
  let lastNpuVerified = false
  let lastVisionModelStatus = null
  let stopping
  let sorter
  let curating = false
  let configuring = false
  let mutating = false
  let aestheticScorer
  let musiqScorer
  const thumbnailJpeg = createThumbnailer()
  let curation = { phase: 'idle', sources: [], warnings: [], considered: 0, selected: 0 }
  let progress = { phase: 'idle', completed: 0, total: 0, pending: 0, currentFile: null, message: '准备好后，点击开始分类。' }
  const events = []
  const curatedManifest = () => path.join(config.output, '精选', 'selection.json')
  let curatedIds = new Set()
  let curatedDetails = new Map()
  let recordsCache = { at: 0, value: null }
  let recordsRevision = 0
  const invalidateRecords = () => { recordsRevision++; recordsCache.value = null }
  const loadCuratedIds = async () => {
    try {
      const selected = JSON.parse(await readFile(curatedManifest(), 'utf8')).selected ?? []
      curatedIds = new Set(selected.map(item => item.id))
      curatedDetails = new Map(selected.map(item => [item.id, item]))
    } catch (error) { if (error.code !== 'ENOENT') throw error; curatedIds = new Set(); curatedDetails = new Map() }
  }
  await loadCuratedIds()
  const records = async () => {
    try {
      if (recordsCache.value && Date.now() - recordsCache.at < 500) return recordsCache.value
      const revision = recordsRevision
      const state = sorter?.snapshot?.() ?? JSON.parse(await readFile(path.join(stateDir(), 'records.json'), 'utf8'))
      const projected = await mapLimit(Object.entries(state.sources), 16, async ([source, record]) => {
        try {
          const sourceInfo = await lstat(source)
          if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) return null
        } catch (caught) {
          if (caught.code === 'ENOENT') return null
          throw caught
        }
        let status = record.status
        let error = record.error
        if (status === 'output-deleted') error = '已删除输出副本，原图仍保留；不会自动恢复'
        if (status === 'source-missing') error = '输入文件夹中暂时找不到原图；重新放回后可继续处理'
        if (status === 'output-missing') error = '分类结果副本已缺失；点击开始分类后会按原图状态恢复'
        if (status === 'done') {
          try {
            const info = await lstat(record.output)
            if (!info.isFile() || info.isSymbolicLink()) throw new Error('输出副本不可用')
          } catch (caught) {
            if (caught.code !== 'ENOENT') error = caught.message
            else error = '输出副本缺失，启动筛选后会自动恢复'
            status = 'repairing'
          }
        }
        if (status !== 'done' && status !== 'failed') return null
        const faceData = record.result?.faces
        const faceWidth = Number(faceData?.imageWidth)
        const faceHeight = Number(faceData?.imageHeight)
        const faceBoxes = (faceData?.detections ?? []).slice(0, 8).flatMap(detection => {
          const box = detection?.box
          if (!(faceWidth > 0 && faceHeight > 0 && box)) return []
          const x = Number(box.originX) / faceWidth
          const y = Number(box.originY) / faceHeight
          const width = Number(box.width) / faceWidth
          const height = Number(box.height) / faceHeight
          if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return []
          return [{ score: Number(detection.score) || 0, x: Math.max(0, x), y: Math.max(0, y), width: Math.min(1, width), height: Math.min(1, height) }]
        })
        return projectRecord(source, record, { status, error, faceBoxes, curatedIds, preferenceProfile })
      })
      const value = projected.filter(Boolean).map(record => ({ ...record, subjectQuality: state.sources[record.source]?.result?.subjectQuality ?? null, curationDetails: record.curated ? publicCurationDetail(curatedDetails.get(record.id)) : null }))
      if (revision === recordsRevision && !mutating) recordsCache = { at: Date.now(), value }
      return value
    } catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }
  const stop = async (completed = false) => {
    if (phase === 'starting') throw Object.assign(new Error('Service busy'), { status: 409 })
    if (stopping) return stopping
    if (phase === 'stopped') return
    phase = 'stopping'
    stopping = (async () => {
      try { if (sorter) await sorter.close() }
      finally {
        sorter = null
        lastDevice = analyzer?.device ?? lastDevice
        lastNpuVerified = analyzer?.npuVerified ?? lastNpuVerified
        lastVisionModelStatus = analyzer?.visionModelStatus ?? lastVisionModelStatus
        try { if (analyzer) await analyzer.close(); if (aestheticScorer) await aestheticScorer.close(); if (musiqScorer) await musiqScorer.close() }
        finally {
          lastVisionModelStatus = analyzer?.visionModelStatus ?? lastVisionModelStatus
          analyzer = null
          aestheticScorer = null
          musiqScorer = null
          if (!completed) progress = { ...progress, phase: 'cancelled', currentFile: null, message: '本批分类已手动停止；点击开始分类可继续。' }
          phase = 'stopped'
          invalidateRecords()
        }
      }
    })()
    try { await stopping } finally { stopping = null }
  }
  const start = async () => {
    if (phase !== 'stopped' || curating || configuring) throw Object.assign(new Error('正在处理照片或保存设置，请稍候'), { status: 409 })
    phase = 'starting'
    curation = { phase: 'idle', sources: [], warnings: [], considered: 0, selected: 0 }
    errorMessage = null
    progress = { phase: 'starting', completed: 0, total: 0, pending: 0, currentFile: null, message: '正在加载本地模型与识别组件…' }
    try {
      analyzer = await analyzerFactory(root, config.backend, config.model, { forceModel: config.forceModel === true, visionMode: config.visionMode, semanticModel: config.semanticModel, onProgress: event => { progress = { ...progress, message: event.message }; events.push({ type: 'vision-progress', ...event, at: new Date().toISOString() }); if (events.length > 50) events.shift() } })
      progress = { phase: 'starting', completed: 0, total: 0, pending: 0, currentFile: null, message: '模型已就绪，正在扫描本批照片…' }
      const vision = analyzer.visionModelStatus
      const analysisVersion = `global-v9:${analyzer.sceneModel ?? config.semanticModel}:person-tiles:${vision?.status ?? 'none'}:${vision?.model ?? 'none'}:${config.visionMode}:${config.forceModel ? 'forced' : 'safe'}`
      sorter = await createFolderSorter({ ...config, batch: true, stateDir: stateDir(), analysisVersion, pollMs: 300, stableMs: 800, analyze: (bytes, meta) => analyzer.analyze(bytes, meta), onEvent: event => { if (event.type === 'progress') progress = event; else { events.push({ ...event, at: new Date().toISOString() }); if (events.length > 50) events.shift() } } })
      phase = 'running'
      invalidateRecords()
      const activeSorter = sorter
      void activeSorter.finished.then(async result => {
        if (sorter !== activeSorter || phase !== 'running') return
        progress = result
        if (result.error) errorMessage = result.error
        await stop(true)
      }).catch(error => { errorMessage = error.message })
    } catch (error) {
      let closeError = null
      try { if (analyzer) await analyzer.close() } catch (caught) { closeError = caught }
      finally {
        analyzer = null
        phase = 'stopped'
        progress = { ...progress, phase: 'error', currentFile: null, message: '启动失败：' + error.message }
        errorMessage = closeError ? `${error.message}；释放失败：${closeError.message}` : error.message
      }
      throw error
    }
  }
  const server = http.createServer()
  let origin
  const json = (response, status, body) => { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)) }
  const cookieName = 'lenssort_session'
  const controlToken = request => {
    const header = request.headers['x-lenssort-token']
    if (typeof header === 'string' && header) return header
    const cookie = String(request.headers.cookie ?? '')
    const item = cookie.split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))
    return item ? decodeURIComponent(item.slice(cookieName.length + 1)) : ''
  }
  const authenticate = request => {
    if (controlToken(request) !== token) return { status: 401, error: 'Invalid control token' }
    const mediaType = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    if (mediaType !== 'application/json') return { status: 415, error: 'Content-Type must be application/json' }
    return null
  }
  server.on('request', async (request, response) => {
    let ownsMutation = false
    try {
      response.setHeader('x-content-type-options', 'nosniff')
      response.setHeader('referrer-policy', 'no-referrer')
      response.setHeader('x-frame-options', 'DENY')
      response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()')
      response.setHeader('content-security-policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
      const route = new URL(request.url, origin).pathname
      if (request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin)) { json(response, 403, { error: 'Local same-origin requests only' }); return }
      if (request.method === 'GET' && route === '/api/status') {
        response.setHeader('set-cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`)
        json(response, 200, {
          config, configWarning, phase, error: errorMessage, device: analyzer?.device ?? lastDevice, devices,
          events: events.map(event => ({ ...event, currentFile: event.currentFile ? path.basename(event.currentFile) : event.currentFile })),
          progress: { ...progress, currentFile: progress.currentFile ? path.basename(progress.currentFile) : null },
          curation,
          records: (await records()).map(({ source: _source, output: _output, dhash: _dhash, curationDetails: _curation, sceneSemantics: _scene, modelEvidence: _model, personDetection: _person, visionExplanation: _vision, ...record }) => record),
          npuVerified: analyzer?.npuVerified ?? lastNpuVerified, visionModelStatus: analyzer?.visionModelStatus ?? lastVisionModelStatus,
        }); return
      }
      if (request.method === 'GET' && route === '/api/models') {
        json(response, 200, await inspectModelOptions(config.model)); return
      }
      if (request.method === 'GET' && route === '/api/similar-groups') {
        json(response, 200, await buildSimilarGroups({ records: await records() })); return
      }
      if (request.method === 'GET' && route === '/api/review') {
        json(response, 200, reviewStatus(await readPublicReview(root))); return
      }
      if (request.method === 'POST' && route.startsWith('/api/')) {
        const authError = authenticate(request)
        if (authError) { json(response, authError.status, { error: authError.error }); return }
        if (mutating) { json(response, 409, { error: '另一项操作正在保存，请稍后重试' }); return }
        mutating = true
        ownsMutation = true
        invalidateRecords()
        const chunks = []
        let bytes = 0
        for await (const chunk of request) {
          bytes += chunk.length
          if (bytes > 65536) throw Object.assign(new Error('Request too large'), { status: 413 })
          chunks.push(chunk)
        }
        let payload
        try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }) }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Object.assign(new Error('Invalid JSON body'), { status: 400 })
        if (route === '/api/pick-folder') {
          if (phase !== 'stopped' || curating) throw Object.assign(new Error('停止筛选后才能选择文件夹'), { status: 409 })
          if (payload.kind !== 'input' && payload.kind !== 'output') throw Object.assign(new Error('Folder kind must be input or output'), { status: 400 })
          const selected = await chooseFolder(payload.current)
          json(response, 200, { selected }); return
        } else if (route === '/api/config') {
          if (phase !== 'stopped' || curating || configuring) throw Object.assign(new Error('Stop monitoring before changing settings'), { status: 409 })
          if (typeof payload.input !== 'string' || typeof payload.output !== 'string' || !path.isAbsolute(payload.input) || !path.isAbsolute(payload.output) || !devices.some(device => device.id === payload.backend)) throw Object.assign(new Error('请选择有效的文件夹，并选择当前电脑可用的设备'), { status: 400 })
          const model = payload.model ?? config.model ?? 'auto'
          if (model !== 'auto' && !modelProfiles().some(item => item.id === model)) throw Object.assign(new Error('请选择受支持的视觉模型'), { status: 400 })
          const visionMode = payload.visionMode ?? config.visionMode ?? 'balanced'
          if (!['off', 'balanced', 'precision'].includes(visionMode)) throw Object.assign(new Error('请选择受支持的视觉复核策略'), { status: 400 })
          const semanticModel = payload.semanticModel ?? config.semanticModel ?? 'auto'
          if (!['auto', 'siglip2', 'clip'].includes(semanticModel)) throw Object.assign(new Error('请选择受支持的语义模型'), { status: 400 })
          const next = { input: path.resolve(payload.input), output: path.resolve(payload.output), backend: payload.backend, model, visionMode, semanticModel, forceModel: payload.forceModel === true && model !== 'auto' && model !== 'off' }
          const relative = path.relative(next.input, next.output)
          const reverse = path.relative(next.output, next.input)
          const nested = value => !value || (!value.startsWith('..' + path.sep) && value !== '..' && !path.isAbsolute(value))
          if (nested(relative) || nested(reverse)) throw Object.assign(new Error('Input and output folders must not overlap'), { status: 400 })
          configuring = true
          try {
            await writeAtomicJson(configFile, next)
            config = next
            configWarning = null
            await loadCuratedIds()
            invalidateRecords()
          } finally {
            configuring = false
          }
        } else if (route === '/api/start') await start()
        else if (route === '/api/stop') await stop()
        else if (route === '/api/delete-output') {
          if (curating) throw Object.assign(new Error('正在精选，请稍候再修改照片'), { status: 409 })
          if (payload.confirm !== true || typeof payload.id !== 'string') throw Object.assign(new Error('请确认删除输出副本'), { status: 400 })
          const record = (await records()).find(item => item.id === payload.id)
          if (!record?.source) throw Object.assign(new Error('找不到可删除的输出副本'), { status: 404 })
          if (sorter) await sorter.deleteOutput(record.source)
          else await deleteFolderOutput({ stateDir: stateDir(), output: config.output, source: record.source })
          invalidateRecords()
          json(response, 200, { phase, config, deleted: true, originalPreserved: true }); return
        } else if (route === '/api/update-category') {
          if (curating) throw Object.assign(new Error('正在精选，请稍候再修改照片'), { status: 409 })
          if (payload.confirm !== true || typeof payload.id !== 'string' || typeof payload.category !== 'string') throw Object.assign(new Error('请确认新的分类标签'), { status: 400 })
          if (!reviewCategorySet.has(payload.category)) throw Object.assign(new Error('请选择受支持的分类'), { status: 400 })
          const record = (await records()).find(item => item.id === payload.id)
          if (!record?.source) throw Object.assign(new Error('找不到可修改分类的照片'), { status: 404 })
          const manual = payload.manual !== false
          const previous = manual ? null : payload.previous && typeof payload.previous === 'object' ? { manualCategory: typeof payload.previous.manualCategory === 'string' ? payload.previous.manualCategory : undefined, manualAction: typeof payload.previous.manualAction === 'string' ? payload.previous.manualAction : undefined, manualCategoryAt: typeof payload.previous.manualCategoryAt === 'string' ? payload.previous.manualCategoryAt : undefined } : null
          const updated = sorter
            ? await sorter.updateCategory(record.source, payload.category, { manual, previous })
            : await updateFolderCategory({ stateDir: stateDir(), output: config.output, source: record.source, category: payload.category, manual, previous })
          if (manual) {
            preferenceProfile = recordPreference(preferenceProfile, { sceneLabel: record.sceneLabel, from: record.category, to: updated.result.category })
            await persistPreferences()
            invalidateRecords()
          }
          json(response, 200, { phase, config, updated: true, originalPreserved: true, category: updated.result.category }); return
        } else if (route === '/api/batch-update-category') {
          if (curating) throw Object.assign(new Error('正在精选，请稍候再修改照片'), { status: 409 })
          if (payload.confirm !== true || !Array.isArray(payload.updates) || payload.updates.length < 1 || payload.updates.length > 100) throw Object.assign(new Error('批量修改需要 1–100 张照片和明确确认'), { status: 400 })
          const allowed = reviewCategorySet
          const requested = new Map()
          for (const update of payload.updates) {
            if (!update || typeof update.id !== 'string' || typeof update.category !== 'string' || !allowed.has(update.category)) throw Object.assign(new Error('批量修改包含无效照片或分类'), { status: 400 })
            const manual = update.manual !== false
            const previous = manual ? null : update.previous && typeof update.previous === 'object' ? { manualCategory: typeof update.previous.manualCategory === 'string' ? update.previous.manualCategory : undefined, manualAction: typeof update.previous.manualAction === 'string' ? update.previous.manualAction : undefined, manualCategoryAt: typeof update.previous.manualCategoryAt === 'string' ? update.previous.manualCategoryAt : undefined } : null
            requested.set(update.id, { category: update.category, manual, previous })
          }
          const current = await records()
          const updated = []
          const failed = []
          let preferenceChanged = false
          for (const [id, change] of requested) {
            const category = change.category
            const record = current.find(item => item.id === id && item.status === 'done')
            if (!record?.source) { failed.push({ id, error: '找不到可修改的照片' }); continue }
            if (record.category === category && change.manual) { updated.push({ id, category }); continue }
            try {
              const result = sorter
                ? await sorter.updateCategory(record.source, category, { manual: change.manual, previous: change.previous })
                : await updateFolderCategory({ stateDir: stateDir(), output: config.output, source: record.source, category, manual: change.manual, previous: change.previous })
              if (change.manual) {
                preferenceProfile = recordPreference(preferenceProfile, { sceneLabel: record.sceneLabel, from: record.category, to: result.result.category })
                preferenceChanged = true
              }
              updated.push({ id, category: result.result.category })
            } catch (error) { failed.push({ id, error: error.message }) }
          }
          if (preferenceChanged) await persistPreferences()
          invalidateRecords()
          json(response, 200, { phase, config, originalPreserved: true, updated, failed, total: requested.size }); return
        } else if (route === '/api/toggle-favorite') {
          if (phase !== 'stopped' || curating) throw Object.assign(new Error('请等待本批处理结束后再收藏照片'), { status: 409 })
          if (typeof payload.id !== 'string' || typeof payload.favorite !== 'boolean') throw Object.assign(new Error('请提供有效的收藏状态'), { status: 400 })
          const record = (await records()).find(item => item.id === payload.id)
          if (!record?.source) throw Object.assign(new Error('找不到可收藏的照片'), { status: 404 })
          const updated = await toggleFolderFavorite({ stateDir: stateDir(), source: record.source, favorite: payload.favorite })
          invalidateRecords()
          json(response, 200, { phase, config, updated: true, favorite: updated.favorite === true }); return
        } else if (route === '/api/rescan') {
          if (curating) throw Object.assign(new Error('正在精选，请稍候再重新扫描'), { status: 409 })
          const summary = sorter
            ? await sorter.rescan()
            : await rescanFolderState({ stateDir: stateDir(), input: config.input, output: config.output })
          invalidateRecords()
          json(response, 200, { phase, config, rescanned: true, summary }); return
        } else if (route === '/api/curate') {
          if (curating || phase !== 'stopped') throw Object.assign(new Error('请等待当前照片处理结束后再生成精选'), { status: 409 })
          curating = true
          curation = { phase: 'scoring', sources: [], warnings: [], considered: 0, selected: 0 }
          try {
            const current = await records()
            for (const record of current) {
              if (record.status !== 'done' || Number.isFinite(record.qualityScore)) continue
              const { bytes } = await validatePhotoSource(record, config.output)
              const prepared = await normalizeImageBytes(bytes, { fileName: record.name })
              Object.assign(record, await analyzePhotoQuality(prepared))
            }
            const scoring = await scoreCurationBatch({
              records: current,
              validate: record => validatePhotoSource(record, config.output),
              onProgress: next => {
                curation = { ...curation, ...next }
                progress = { ...progress, ...next, pending: Math.max(0, next.total - next.completed), currentFile: null }
              },
              laionFactory: async () => {
                const scorer = await createLaionAestheticScorer(root)
                aestheticScorer = scorer
                return { score: bytes => scorer.score(bytes), close: async () => { await scorer.close(); aestheticScorer = null } }
              },
              musiqFactory: async () => {
                const scorer = await createMusiqAestheticScorer(root)
                musiqScorer = scorer
                return scorer ? { scoreBatch: (...args) => scorer.scoreBatch(...args), close: async () => { await scorer.close(); musiqScorer = null } } : null
              },
            })
            curation = { ...curation, phase: 'ranking', sources: scoring.sources, warnings: scoring.warnings }
            const result = await curatePhotos({ records: current, output: config.output, manifestFile: curatedManifest() })
            await loadCuratedIds()
            invalidateRecords()
            curation = { ...curation, phase: 'finished', considered: result.considered, selected: result.selected.length }
            progress = { phase: 'finished', completed: result.considered, total: result.considered, pending: 0, currentFile: null, message: result.message }
            json(response, 200, { phase, config, curation, ...result }); return
          } catch (error) {
            curation = { ...curation, phase: 'error' }
            progress = { ...progress, phase: 'error', message: '精选失败，原图未改动：' + error.message }
            throw error
          } finally {
            try { if (aestheticScorer) await aestheticScorer.close(); if (musiqScorer) await musiqScorer.close() }
            finally { aestheticScorer = null; musiqScorer = null; curating = false }
          }
        } else if (route === '/api/review') {
          if (phase !== 'stopped') throw Object.assign(new Error('请先停止自动筛选，再进行样本审核'), { status: 409 })
          if (typeof payload.imageId !== 'string' || typeof payload.label !== 'string') throw Object.assign(new Error('审核图片和标签不能为空'), { status: 400 })
          json(response, 200, await applyPublicReviewLabel(root, payload.imageId, payload.label)); return
        }
        else { json(response, 404, { error: 'Unknown control operation' }); return }
        json(response, 200, { phase, config }); return
      }
      if (request.method === 'GET' && route.startsWith('/api/review/thumbnail/')) {
        const imageId = route.split('/').pop()
        const bundle = await readPublicReview(root)
        const record = bundle.records.find(item => item.imageId === imageId)
        if (!record) { json(response, 404, { error: 'Unknown review image' }); return }
        const source = resolveReviewSource(root, record)
        const thumbnail = await sharp(source, { limitInputPixels: 80_000_000 }).rotate().resize(1000, 760, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer()
        response.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }); response.end(thumbnail); return
      }
      if (request.method === 'GET' && route.startsWith('/api/thumbnail/')) {
        const id = route.split('/').pop()
        const record = (await records()).find(item => item.id === id && item.status === 'done')
        if (!record) { json(response, 404, { error: 'Unknown photo' }); return }
        const thumbnail = await thumbnailJpeg(record)
        response.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }); response.end(thumbnail); return
      }
      if (request.method === 'GET' && route.startsWith('/api/face-image/')) {
        const [, , , id, rawIndex] = route.split('/')
        const index = Number(rawIndex)
        const record = (await records()).find(item => item.id === id && item.status === 'done')
        const box = Number.isInteger(index) ? record?.faceBoxes?.[index] : null
        if (!record || !box) { json(response, 404, { error: 'Unknown face crop' }); return }
        const source = await imageBytesForDisplay(record.output)
        const metadata = await sharp(source, { limitInputPixels: 80_000_000 }).rotate().metadata()
        const width = metadata.autoOrient?.width ?? metadata.width
        const height = metadata.autoOrient?.height ?? metadata.height
        if (!width || !height) { json(response, 422, { error: 'Image dimensions are unavailable' }); return }
        const padding = 0.22
        const left = Math.max(0, Math.floor((box.x - box.width * padding) * width))
        const top = Math.max(0, Math.floor((box.y - box.height * padding) * height))
        const right = Math.min(width, Math.ceil((box.x + box.width * (1 + padding)) * width))
        const bottom = Math.min(height, Math.ceil((box.y + box.height * (1 + padding)) * height))
        if (right - left < 16 || bottom - top < 16) { json(response, 422, { error: 'Face crop too small' }); return }
        const crop = await sharp(source, { limitInputPixels: 80_000_000 }).rotate().extract({ left, top, width: right - left, height: bottom - top }).resize(240, 240, { fit: 'cover' }).jpeg({ quality: 86 }).toBuffer()
        response.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }); response.end(crop); return
      }
      if (request.method === 'GET' && route.startsWith('/api/photo-image/')) {
        const id = route.split('/').pop()
        const record = (await records()).find(item => item.id === id && item.status === 'done')
        if (!record) { json(response, 404, { error: 'Unknown photo' }); return }
        const image = await sharp(await imageBytesForDisplay(record.output), { limitInputPixels: 80_000_000 }).rotate().resize(1800, 1400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()
        response.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }); response.end(image); return
      }
      if (request.method === 'GET' && route.startsWith('/api/photo/')) {
        const id = route.split('/').pop()
        const record = (await records()).find(item => item.id === id)
        if (!record) { json(response, 404, { error: 'Unknown photo' }); return }
        const { source: _source, output: _output, ...details } = record
        json(response, 200, { ...details, imageUrl: `/api/photo-image/${id}` })
        return
      }
      if (request.method === 'GET' && route.startsWith('/models/')) {
        const publicRoot = path.resolve(root, 'public')
        const file = path.resolve(publicRoot, '.' + route)
        if (!file.startsWith(path.join(publicRoot, 'models') + path.sep)) { json(response, 403, { error: 'Invalid model path' }); return }
        try {
          if (!(await stat(file)).isFile()) throw new Error('Not a file')
          const types = { '.task': 'application/octet-stream', '.tflite': 'application/octet-stream', '.wasm': 'application/wasm', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' }
          const bytes = await readFile(file)
          response.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'private, max-age=3600' }); response.end(bytes); return
        } catch { json(response, 404, { error: 'Model asset not installed' }); return }
      }
      if (request.method === 'GET' && (route === '/' || route === '/index.html' || route === '/favicon.svg' || route.startsWith('/assets/'))) {
        const dist = path.join(root, 'dist')
        const file = path.resolve(dist, route === '/' ? 'index.html' : '.' + route)
        if (!file.startsWith(dist + path.sep)) { json(response, 403, { error: 'Invalid path' }); return }
        try {
          if (!(await stat(file)).isFile()) throw new Error('Not a file')
          const bytes = await readFile(file)
          const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' }
          response.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }); response.end(bytes); return
        } catch {
          if (route === '/favicon.svg') {
            try {
              const bytes = await readFile(path.join(root, 'public', 'favicon.svg'))
              response.writeHead(200, { 'content-type': 'image/svg+xml' }); response.end(bytes); return
            } catch {}
          }
          json(response, 404, { error: 'Build webpage with npm run build first' }); return
        }
      }
      json(response, 404, { error: 'Not found' })
    } catch (error) { json(response, error.status ?? 500, { error: error.message }) }
    finally { if (ownsMutation) { invalidateRecords(); mutating = false } }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  origin = 'http://127.0.0.1:' + server.address().port
  return { origin, close: async () => { await stop(); await new Promise(resolve => server.close(resolve)) } }
}
