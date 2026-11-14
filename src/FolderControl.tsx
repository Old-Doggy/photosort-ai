import { useEffect, useMemo, useRef, useState } from 'react'
import './FolderControl.css'
import './folder-control-v13.css'
import ModelSettings from './ModelSettings'
import CurationResults, { type CurationRecord } from './CurationResults'
import ReviewOverlay from './ReviewOverlay'
import SimilarGroups from './SimilarGroups'

type Config = { input: string; output: string; backend: string; model: string; visionMode?: string; semanticModel?: string; forceModel?: boolean }
type VisionExplanation = { summary?: string; explanation?: string; subjects?: string[]; scene?: string; compositionComment?: string; qualityComment?: string; recommendation?: string; confidence?: number | null; categoryCandidate?: string | null; categoryApplied?: boolean; categoryDecision?: string; triggerReason?: string; cautions?: string[]; model?: string | null; generated?: boolean; error?: string; mediaType?: string; subjectFocus?: string; realPersonPresent?: boolean; personCount?: number; primaryPersonCount?: number; landscapePresent?: boolean; statuePresent?: boolean; animalPresent?: boolean; plantPresent?: boolean; bodyPartOnly?: boolean; subjectSharpness?: string; reviewCalls?: number }
type RecordItem = { id: string; name: string; status: string; favorite?: boolean; favoriteAt?: string | null; manualAction?: string | null; manualCategory?: string | null; manualCategoryAt?: string | null; category?: string; sceneLabel?: string | null; reason?: string; explanation?: string | null; qualityScore?: number; qualityReasons?: string[]; clarityScore?: number; exposureStatus?: string; faceCount?: number; faceBoxes?: Array<{ score?: number; x: number; y: number; width: number; height: number }>; preferenceSuggestion?: { category: string; count: number; total: number; sceneLabel?: string } | null; curated?: boolean; error?: string; durationMs?: number; completedAt?: string | null; device?: { name: string }; npuVerified?: boolean; npuEvidence?: { npuKernelCount?: number | null; npuKernelMs?: number | null; profileScope?: string | null; cpuKernelCount?: number | null; cpuKernelMs?: number | null; mixedCpuAuxiliary?: boolean } | null; imageUrl?: string; visionTriggered?: boolean; visionTriggerReason?: string; visionCategoryApplied?: boolean; visionExplanation?: VisionExplanation | null; visionModelStatus?: { status?: string; model?: string | null; message?: string; device?: string | null } | null }
type Progress = { phase: string; completed: number; total: number; pending: number; currentFile?: string | null; message: string }
type CurationStatus = { phase: string; sources: string[]; warnings: string[]; considered: number; selected: number }
type Status = { config: Config; configWarning?: string | null; phase: string; error?: string; device?: { id?: string; name: string; provider?: string }; devices: Array<{ id: string; name: string }>; records: RecordItem[]; npuVerified: boolean; progress: Progress; curation?: CurationStatus; visionModelStatus?: { status: string; model?: string; message?: string; device?: string | null } | null }
const categories = ['全部', '收藏', '辅助推荐', '单人', '多人', '人物与风景', '风景', '动物', '植物', '其他', '待确认', '失败']
const categoryOrder = new Map(categories.map((category, index) => [category, index]))
type UndoItem = { id: string; category: string; manualCategory?: string | null; manualAction?: string | null; manualCategoryAt?: string | null }
type UndoState = { label: string; items: UndoItem[] } | null
type SortMode = 'recent' | 'name' | 'category' | 'quality'

export default function FolderControl() {
  const [status, setStatus] = useState<Status | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('全部')
  const [notice, setNotice] = useState('')
  const [selectedPhoto, setSelectedPhoto] = useState<RecordItem | null>(null)
  const [galleryMode, setGalleryMode] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [imageLoadError, setImageLoadError] = useState(false)
  const [imageRetryKey, setImageRetryKey] = useState(0)
  const [rescanBusy, setRescanBusy] = useState(false)
  const [pageSize, setPageSize] = useState(60)
  const [currentPage, setCurrentPage] = useState(1)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [guideDismissed, setGuideDismissed] = useState(() => { try { return localStorage.getItem('lenssort-guide-dismissed') === '1' } catch { return false } })
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortMode>('recent')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchCategory, setBatchCategory] = useState('单人')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewStartId, setReviewStartId] = useState<string | null>(null)
  const [similarOpen, setSimilarOpen] = useState(false)
  const [undo, setUndo] = useState<UndoState>(null)
  const undoTimerRef = useRef<number | null>(null)
  const statusRequestRef = useRef(0)
  const statusAbortRef = useRef<AbortController | null>(null)
  const detailRequestRef = useRef(0)
  const selectedPhotoRef = useRef<RecordItem | null>(null)
  const photoOpenerRef = useRef<HTMLElement | null>(null)
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null)
  const settingsDrawerRef = useRef<HTMLElement | null>(null)
  const configDirtyRef = useRef(false)
  const committedConfigRef = useRef<Config | null>(null)
  const folderScopeRef = useRef('')
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !document.querySelector('[aria-modal="true"]')) {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('.v13-top-search input')?.focus()
      }
    }
    document.addEventListener('keydown', focusSearch)
    return () => document.removeEventListener('keydown', focusSearch)
  }, [])
  const markConfigDirty = (patch: Partial<Config>) => {
    configDirtyRef.current = true
    setConfig(current => current ? { ...current, ...patch } : current)
  }
  const selectedPhotoId = selectedPhoto?.id
  useEffect(() => {
    if (!selectedPhotoId) return
    const modal = document.querySelector<HTMLElement>('.photo-modal')
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    modal?.querySelector<HTMLElement>('.photo-modal-close')?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setSelectedPhoto(null); return }
      if (event.key !== 'Tab' || !modal) return
      const controls = [...modal.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), summary, a[href], [tabindex="0"]')].filter(element => element.getClientRects().length > 0)
      const first = controls[0]
      const last = controls.at(-1)
      if (!first || !last) return
      if (!modal.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      if (photoOpenerRef.current?.isConnected) photoOpenerRef.current.focus({ preventScroll: true })
    }
  }, [selectedPhotoId])
  useEffect(() => { selectedPhotoRef.current = selectedPhoto }, [selectedPhoto])
  useEffect(() => () => { if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current) }, [])
  useEffect(() => {
    if (!settingsOpen) return
    const previousOverflow = document.body.style.overflow
    const opener = settingsButtonRef.current
    document.body.style.overflow = 'hidden'
    const drawer = settingsDrawerRef.current
    drawer?.querySelector<HTMLElement>('.settings-close')?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setSettingsOpen(false); return }
      if (event.key !== 'Tab' || !drawer) return
      const controls = [...drawer.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href], [tabindex="0"]')].filter(element => element.getClientRects().length > 0)
      const first = controls[0]
      const last = controls.at(-1)
      if (!first || !last) return
      if (!drawer.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); document.body.style.overflow = previousOverflow; if (opener?.isConnected) opener.focus({ preventScroll: true }) }
  }, [settingsOpen])
  const refreshStatus = async () => {
    const requestId = statusRequestRef.current + 1
    statusRequestRef.current = requestId
    statusAbortRef.current?.abort()
    const controller = new AbortController()
    statusAbortRef.current = controller
    let timedOut = false
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort() }, 15000)
    try {
      const response = await fetch('/api/status', { cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error('本地服务尚未启动：请使用“启动网页控制.cmd”')
      const next: Status = await response.json()
      if (requestId !== statusRequestRef.current) return null
      const scope = JSON.stringify([next.config.input, next.config.output])
      if (folderScopeRef.current && folderScopeRef.current !== scope) {
        setSelectedIds(new Set()); setUndo(null); setCurrentPage(1)
        setSelectedPhoto(null); selectedPhotoRef.current = null
        setReviewOpen(false); setSimilarOpen(false)
        if (undoTimerRef.current) { window.clearTimeout(undoTimerRef.current); undoTimerRef.current = null }
      }
      folderScopeRef.current = scope
      const available = new Set(next.records.filter(record => record.status === 'done').map(record => record.id))
      setSelectedIds(current => {
        const kept = [...current].filter(id => available.has(id))
        return kept.length === current.size ? current : new Set(kept)
      })
      if (selectedPhotoRef.current && !next.records.some(record => record.id === selectedPhotoRef.current?.id)) {
        selectedPhotoRef.current = null
        setSelectedPhoto(null)
        setNotice('当前照片已不在磁盘记录中，页面已按最新文件夹状态更新')
      }
      setStatus(next)
      committedConfigRef.current = next.config
      if (!configDirtyRef.current) setConfig(current => current ?? next.config)
      setError('')
      return next
    } catch (caught) {
      if (timedOut) { setError('本地服务响应超时；正在重试，请检查服务是否仍运行'); return null }
      if (controller.signal.aborted || requestId !== statusRequestRef.current) return null
      setError(caught instanceof Error ? caught.message : '无法连接本地服务')
      return null
    } finally { window.clearTimeout(timeout) }
  }
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = async () => {
      if (!active) return
      const next = await refreshStatus()
      if (!active) return
      const phase = next?.phase
      const progressPhase = next?.progress?.phase
      const curationPhase = next?.curation?.phase
      const activeTask = phase === 'starting' || phase === 'running' || phase === 'stopping' || ['scanning', 'analyzing', 'waiting', 'scoring', 'aesthetic-laion', 'aesthetic-musiq', 'ranking'].includes(progressPhase ?? '') || ['scoring', 'aesthetic-laion', 'aesthetic-musiq', 'ranking'].includes(curationPhase ?? '')
      const interval = activeTask ? (phase === 'starting' || phase === 'stopping' ? 500 : 1000) : 5000
      timer = setTimeout(() => void refresh(), interval)
    }
    void refresh()
    return () => { active = false; if (timer) clearTimeout(timer); statusAbortRef.current?.abort() }
  }, [])
  const control = async (route: string, body = {}) => {
    if (!status) throw new Error('服务未连接')
    const options = {
      method: 'POST',
      credentials: 'same-origin' as const,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300000),
    }
    let response = await fetch(route, options)
    if (response.status === 401) {
      await refreshStatus()
      response = await fetch(route, options)
    }
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? '操作失败')
    return result
  }
  const offerUndo = (next: Exclude<UndoState, null>) => {
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current)
    setUndo(next)
    undoTimerRef.current = window.setTimeout(() => { setUndo(null); undoTimerRef.current = null }, 10000)
  }
  const operate = async (start: boolean) => {
    if (!config || busy || curating) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (start) { await control('/api/config', config); committedConfigRef.current = config; configDirtyRef.current = false; await control('/api/start') }
      else await control('/api/stop')
      await refreshStatus()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '操作失败') }
    finally { setBusy(false) }
  }
  const changeModel = async (model: string) => {
    if (!config || !status || busy) return
    setBusy(true); setError('')
    try {
      const next = { ...(committedConfigRef.current ?? status.config), model, forceModel: false }
      await control('/api/config', next)
      committedConfigRef.current = next
      setConfig(current => current ? { ...current, model, forceModel: false } : next)
      setNotice('模型选择已保存 · 下一次筛选生效')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '模型设置保存失败') }
    finally { setBusy(false) }
  }
  const forceModel = async () => {
    if (!config || !status || busy || config.model === 'auto' || config.model === 'off') return
    if (!config.forceModel && !window.confirm('强制使用会跳过模型资源建议，不会自动换小模型；显存不足时可能混合使用系统内存，速度变慢或运行失败 · 空闲内存低于3GiB仍会停止整批 · 确认继续？')) return
    setBusy(true); setError('')
    try {
      const next = { ...(committedConfigRef.current ?? status.config), model: config.model, forceModel: !config.forceModel }
      await control('/api/config', next)
      committedConfigRef.current = next
      setConfig(current => current ? { ...current, forceModel: next.forceModel } : next)
      setNotice(next.forceModel ? '已开启强制使用 · 不会自动换小模型 · 运行失败会明确停止本批' : '已关闭强制使用 · 恢复自动资源保护')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '强制模型设置保存失败') }
    finally { setBusy(false) }
  }
  const changeVisionMode = async (visionMode: string) => {
    if (!config || !status || busy || !['off', 'balanced', 'precision'].includes(visionMode)) return
    setBusy(true); setError('')
    try {
      const next = { ...(committedConfigRef.current ?? status.config), model: config.model, visionMode, forceModel: visionMode === 'off' ? false : config.forceModel }
      await control('/api/config', next)
      committedConfigRef.current = next
      setConfig(current => current ? { ...current, visionMode, forceModel: next.forceModel } : next)
      setNotice(visionMode === 'off' ? '已关闭视觉复核 · 只使用本地快速分类' : visionMode === 'balanced' ? '已启用平衡模式 · 只复核疑难照片' : '已启用精细模式 · 将复核全部照片，耗时明显增加')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '视觉复核策略保存失败') }
    finally { setBusy(false) }
  }
  const changeSemanticModel = async (semanticModel: string) => {
    if (!config || !status || busy || !['auto', 'siglip2', 'clip'].includes(semanticModel)) return
    setBusy(true); setError('')
    try {
      const next = { ...(committedConfigRef.current ?? status.config), model: config.model, semanticModel }
      await control('/api/config', next)
      committedConfigRef.current = next
      setConfig(current => current ? { ...current, semanticModel } : next)
      setNotice(semanticModel === 'auto' ? '语义模型已保存：优先 SigLIP2，未安装时回退 CLIP' : semanticModel === 'siglip2' ? '语义模型已保存：SigLIP2（未安装时会明确报错）' : '语义模型已保存：CLIP 兼容基线')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '语义模型设置保存失败') }
    finally { setBusy(false) }
  }
  const saveSettings = async () => {
    if (!config || busy || !status) return
    setBusy(true); setError('')
    try {
      await control('/api/config', config)
      committedConfigRef.current = config
      configDirtyRef.current = false
      setNotice('文件夹、设备和模型设置已保存')
      setSettingsOpen(false)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '设置保存失败') }
    finally { setBusy(false) }
  }
  const curate = async () => {
    if (busy || disabled) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await control('/api/curate')
      const sourceText = result.curation?.sources?.length ? `评分来源：${result.curation.sources.join(' + ')}` : '审美评分器不可用，已使用技术质量回退'
      setNotice(result.selected.length ? `已生成辅助推荐 ${result.selected.length} 张（评估 ${result.considered} 张）· ${sourceText} · 原图未改动` : `没有生成辅助推荐 · ${sourceText} · 原图未改动`)
      await refreshStatus(); setFilter('辅助推荐')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '辅助推荐失败') }
    finally { setBusy(false) }
  }
  const pickFolder = async (kind: 'input' | 'output') => {
    if (!config || busy || !status || running) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await control('/api/pick-folder', { kind, current: kind === 'input' ? config.input : config.output }) as { selected: string | null }
      if (result.selected) {
        const next = { ...config, [kind]: result.selected }
        await control('/api/config', next)
        committedConfigRef.current = next
        setConfig(next)
        setNotice(result.selected ? '文件夹已保存 · 原图不会被移动' : '')
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : '无法选择文件夹') }
    finally { setBusy(false) }
  }
  const openPhoto = async (record: RecordItem) => {
    if (selectedPhotoRef.current?.id !== record.id) photoOpenerRef.current = document.activeElement as HTMLElement | null
    const requestId = detailRequestRef.current + 1
    detailRequestRef.current = requestId
    selectedPhotoRef.current = record
    setSelectedPhoto(record); setDetailLoading(true); setDetailError(''); setImageLoadError(false); setImageRetryKey(0); setError('')
    try {
      const response = await fetch('/api/photo/' + record.id, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
      const details: RecordItem & { error?: string } = await response.json()
      if (!response.ok) throw new Error(details.error ?? '无法读取照片详情')
      if (requestId === detailRequestRef.current) setSelectedPhoto(current => current?.id === record.id ? details : current)
    } catch (caught) {
      if (requestId === detailRequestRef.current) setDetailError(caught instanceof Error ? caught.message : '无法读取照片详情')
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false)
    }
  }
  const retryPhotoDetail = () => { if (selectedPhoto) void openPhoto(selectedPhoto) }
  const deleteOutput = async (record: RecordItem) => {
    if (busy || record.status !== 'done') return
    if (!window.confirm(`只删除“${record.name}”的分类副本？输入文件夹中的原图不会删除`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      await control('/api/delete-output', { id: record.id, confirm: true })
      setSelectedPhoto(null)
      setNotice(`已删除 ${record.name} 的分类副本 · 原图仍保留`)
      await refreshStatus()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '删除分类副本失败') }
    finally { setBusy(false) }
  }
  const applyCategory = async (record: RecordItem, category: string, options: { confirm?: boolean } = {}) => {
    if (busy || record.status !== 'done' || !category || category === record.category) return false
    if (options.confirm !== false && !window.confirm(`确认把“${record.name}”的分类改为“${category}”？只移动分类结果副本，输入文件夹中的原图不会移动或删除`)) return false
    detailRequestRef.current += 1
    setDetailLoading(false)
    const previousCategory = record.category
    const hadOpenDetail = Boolean(selectedPhotoRef.current)
    if (hadOpenDetail) {
      selectedPhotoRef.current = { ...record, category, manualCategory: category, manualAction: 'category-corrected' }
      setSelectedPhoto(current => current?.id === record.id ? { ...current, category, manualCategory: category, manualAction: 'category-corrected' } : current)
    }
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await control('/api/update-category', { id: record.id, category, confirm: true }) as { category?: string }
      const appliedCategory = result.category ?? category
      if (hadOpenDetail) setSelectedPhoto(current => current?.id === record.id ? { ...current, category: appliedCategory, manualCategory: appliedCategory, manualAction: 'category-corrected' } : current)
      const next = await refreshStatus()
      const updated = next?.records.find(item => item.id === record.id)
      if (hadOpenDetail && updated) { selectedPhotoRef.current = updated; setSelectedPhoto(updated) }
      setNotice(`已将 ${record.name} 改到“${appliedCategory}” · 原图仍保留`)
      if (previousCategory) offerUndo({ label: `已将 ${record.name} 改到“${appliedCategory}”`, items: [{ id: record.id, category: previousCategory, manualCategory: record.manualCategory, manualAction: record.manualAction, manualCategoryAt: record.manualCategoryAt }] })
      return true
    } catch (caught) {
      if (hadOpenDetail) {
        selectedPhotoRef.current = { ...record, category: previousCategory }
        setSelectedPhoto(current => current?.id === record.id ? { ...current, category: previousCategory, manualCategory: record.manualCategory, manualAction: record.manualAction } : current)
      }
      setError(caught instanceof Error ? caught.message : '修改分类失败')
      return false
    }
    finally { setBusy(false) }
  }
  const updateCategory = (record: RecordItem, category: string) => applyCategory(record, category)
  const rescan = async () => {
    if (busy || rescanBusy || !status) return
    setRescanBusy(true); setError(''); setNotice('')
    try {
      const result = await control('/api/rescan') as { summary: { scannedFiles: number; newFiles: number; sourceMissing: number; outputMissing: number; outputDeleted: number } }
      await refreshStatus()
      const summary = result.summary
      setNotice(`已按当前磁盘重新扫描 ${summary.scannedFiles} 张照片：新增 ${summary.newFiles} 张 · 源文件移除 ${summary.sourceMissing} 张 · 输出缺失 ${summary.outputMissing} 张 · 手动删除 ${summary.outputDeleted} 张`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '重新扫描失败') }
    finally { setRescanBusy(false) }
  }
  const toggleFavorite = async (record: RecordItem) => {
    if (busy || record.status !== 'done' || !status) return false
    setBusy(true); setError(''); setNotice('')
    try {
      const nextFavorite = !record.favorite
      await control('/api/toggle-favorite', { id: record.id, favorite: nextFavorite })
      const next = await refreshStatus()
      const updated = next?.records.find(item => item.id === record.id)
      if (updated && selectedPhotoRef.current?.id === record.id) { selectedPhotoRef.current = updated; setSelectedPhoto(updated) }
      setNotice(nextFavorite ? `已收藏 ${record.name} · 可在“收藏”中集中查看` : `已取消收藏 ${record.name}`)
      return true
    } catch (caught) { setError(caught instanceof Error ? caught.message : '收藏状态更新失败'); return false }
    finally { setBusy(false) }
  }
  const running = status?.phase === 'running'
  const curating = !!status?.curation && ['scoring', 'aesthetic-laion', 'aesthetic-musiq', 'ranking'].includes(status.curation.phase)
  const disabled = busy || curating || running || status?.phase === 'starting' || status?.phase === 'stopping'
  const records = useMemo<(RecordItem & CurationRecord)[]>(() => status?.records ?? [], [status])
  const verifiedNpuRecord = records.find(record => record.npuVerified === true && record.npuEvidence)
  const npuEvidence = verifiedNpuRecord?.npuEvidence
  const npuStatusText = status?.npuVerified && npuEvidence
    ? `NPU 主分类内核已验证 · ${npuEvidence.npuKernelCount ?? 0} 个融合内核 · ${npuEvidence.npuKernelMs ?? 0} ms`
    : config?.backend === 'npu'
      ? '本批选择了 NPU，照片推理后才会显示验证结果；未验证前不代表已使用 NPU'
      : '当前没有 NPU 验证证据；设备选择不等于实际推理已使用该设备'
  const visionDeviceText = status?.visionModelStatus?.device
    ? `视觉模型最近设备：${status.visionModelStatus.device}`
    : status?.visionModelStatus?.status === 'unavailable'
      ? '视觉模型服务不可用，当前只使用基础分析'
      : '视觉模型设备由本地服务报告，基础分类设备不会代表视觉模型设备'
  const progress = status?.progress
  const progressPercent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0
  const progressFile = progress?.currentFile ? progress.currentFile.split(/[\\/]/).pop() : ''
  const hasBrokenPath = [config?.input, config?.output].some(value => value?.includes('�'))
  const activityTitle = curating ? '正在生成辅助推荐' : status?.curation?.phase === 'finished' && progress?.phase === 'finished' ? '辅助推荐已完成，已停止' : status?.phase === 'starting' ? '正在启动识别组件' : status?.phase === 'stopping' ? '正在释放识别组件' : progress?.phase === 'finished' ? '分类完成，已自动停止' : progress?.phase === 'error' ? '本批处理异常，已停止' : progress?.phase === 'analyzing' ? '正在分析照片' : progress?.phase === 'waiting' ? '正在等待照片写入完成' : progress?.phase === 'scanning' ? '正在扫描照片' : running ? '正在自动筛选' : progress?.phase === 'cancelled' ? '已手动停止' : '准备就绪'
  const activityMessage = status?.phase === 'starting' ? progress?.message ?? '正在加载本地模型与识别组件…' : progress?.message ?? (running ? '把照片放入来源文件夹，系统会自动分类' : '准备好后，点击开始分类')
  const searchTerm = search.trim().toLowerCase()
  const visible = useMemo(() => records.filter(record => {
    const matchesFilter = filter === '全部' || (filter === '收藏' ? record.favorite === true : filter === '辅助推荐' ? record.curated : filter === '失败' ? record.status === 'failed' : record.category === filter)
    const matchesSearch = !searchTerm || [record.name, record.category, record.sceneLabel, record.reason, record.explanation].some(value => String(value ?? '').toLowerCase().includes(searchTerm))
    return matchesFilter && matchesSearch
  }).sort((left, right) => {
    if (sort === 'name') return left.name.localeCompare(right.name, 'zh-CN')
    if (sort === 'category') return (categoryOrder.get(left.category ?? '') ?? 99) - (categoryOrder.get(right.category ?? '') ?? 99) || left.name.localeCompare(right.name, 'zh-CN')
    if (sort === 'quality') return (right.qualityScore ?? -1) - (left.qualityScore ?? -1)
    const rightTime = right.completedAt ? Date.parse(right.completedAt) : 0
    const leftTime = left.completedAt ? Date.parse(left.completedAt) : 0
    return Number(right.favorite === true) - Number(left.favorite === true) || rightTime - leftTime || left.name.localeCompare(right.name, 'zh-CN')
  }), [records, filter, searchTerm, sort])
  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize))
  const activePage = Math.min(currentPage, totalPages)
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- keep navigation valid after disk refresh removes pages
    setCurrentPage(page => Math.min(page, totalPages))
  }, [totalPages])
  const displayed = useMemo(() => visible.slice((activePage - 1) * pageSize, activePage * pageSize), [visible, activePage, pageSize])
  const doneCount = useMemo(() => records.filter(record => record.status === 'done').length, [records])
  const curatedCount = useMemo(() => records.filter(record => record.curated).length, [records])
  const pendingRecords = useMemo(() => records.filter(record => record.status === 'done' && record.category === '待确认'), [records])
  const pendingCount = pendingRecords.length
  const selectedCount = selectedIds.size
  const categoryCounts = useMemo(() => {
    const counts = records.reduce<Record<string, number>>((result, record) => {
      if (record.status === 'failed') result['失败'] = (result['失败'] ?? 0) + 1
      if (record.category) result[record.category] = (result[record.category] ?? 0) + 1
      return result
    }, {})
    counts['全部'] = records.length
    counts['辅助推荐'] = curatedCount
    counts['收藏'] = records.filter(record => record.favorite === true).length
    return counts
  }, [records, curatedCount])
  const failedCount = categoryCounts['失败'] ?? 0
  const removedCount = progress?.phase === 'finished' ? Math.max(0, (progress.total ?? 0) - doneCount - failedCount) : 0
  const toggleSelect = (id: string) => setSelectedIds(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const selectAllVisible = () => {
    const ids = displayed.filter(record => record.status === 'done').map(record => record.id)
    setSelectedIds(current => current.size === ids.length && ids.every(id => current.has(id)) ? new Set() : new Set(ids))
  }
  const openReview = (id?: string) => {
    const target = id ? records.find(record => record.id === id && record.status === 'done') : pendingRecords[0]
    if (!target) { setFilter('待确认'); setNotice('当前没有待确认照片，可以先检查其他分类'); return }
    setReviewStartId(target.id)
    setReviewOpen(true)
  }
  const batchUpdateCategory = async () => {
    if (busy || !selectedCount) return
    const targets = records.filter(record => selectedIds.has(record.id) && record.status === 'done' && record.category !== batchCategory)
    if (!targets.length) { setNotice('所选照片已经是这个分类'); return }
    if (!window.confirm(`确认把 ${targets.length} 张照片的分类改为“${batchCategory}”？只移动分类结果副本，原图始终保留`)) return
    setBusy(true); setError(''); setNotice('')
    const updated: Array<{ id: string; category: string }> = []
    const failed: Array<{ id: string; error: string }> = []
    let failure: unknown = null
    const undoItems: UndoItem[] = []
    try {
      for (let index = 0; index < targets.length; index += 100) {
        try {
          const result = await control('/api/batch-update-category', { confirm: true, updates: targets.slice(index, index + 100).map(record => ({ id: record.id, category: batchCategory })) }) as { updated?: Array<{ id: string; category: string }>; failed?: Array<{ id: string; error: string }> }
          updated.push(...(result.updated ?? []))
          failed.push(...(result.failed ?? []))
        } catch (caught) {
          failure = caught
          break
        }
      }
      for (const target of targets) if (updated.some(item => item.id === target.id) && target.category) undoItems.push({ id: target.id, category: target.category, manualCategory: target.manualCategory, manualAction: target.manualAction, manualCategoryAt: target.manualCategoryAt })
      await refreshStatus()
      setSelectedIds(new Set())
      if (undoItems.length) offerUndo({ label: `已修改 ${undoItems.length} 张照片的分类`, items: undoItems })
      if (failure) setError(`批量修改中途失败：${failure instanceof Error ? failure.message : '未知错误'}；已完成 ${undoItems.length} 张，可撤销`)
      else setNotice(`已修改 ${undoItems.length} 张照片的分类${failed.length ? ` · ${failed.length} 张失败，可查看失败照片` : ''} · 原图仍保留`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '批量修改分类失败') }
    finally { setBusy(false) }
  }
  const undoLast = async () => {
    if (!undo || busy) return
    setBusy(true); setError(''); setNotice('')
    if (undoTimerRef.current) { window.clearTimeout(undoTimerRef.current); undoTimerRef.current = null }
    const restored = new Set<string>()
    try {
      for (let index = 0; index < undo.items.length; index += 100) {
        const result = await control('/api/batch-update-category', { confirm: true, updates: undo.items.slice(index, index + 100).map(item => ({ id: item.id, category: item.category, manual: false, previous: { manualCategory: item.manualCategory, manualAction: item.manualAction, manualCategoryAt: item.manualCategoryAt } })) }) as { updated?: Array<{ id: string }>; failed?: Array<{ error: string }> }
        for (const item of result.updated ?? []) restored.add(item.id)
        if (result.failed?.length) throw new Error(result.failed[0].error)
      }
      if (restored.size !== undo.items.length) throw new Error('部分照片尚未恢复，请重试')
      setNotice('已撤销上一次分类修改 · 原图仍保留')
    } catch (caught) { setError(`撤销未完成：${caught instanceof Error ? caught.message : '未知错误'} · 已恢复 ${restored.size} 张，剩余项可重试`) }
    finally {
      const remaining = undo.items.filter(item => !restored.has(item.id))
      setUndo(remaining.length ? { ...undo, items: remaining } : null)
      await refreshStatus()
      setBusy(false)
    }
  }
  const applySimilarCategory = async (photos: Array<{ id: string }>, category: string) => {
    if (busy || !status) return false
    const targets = records.filter(record => photos.some(photo => photo.id === record.id) && record.status === 'done' && record.category !== category)
    if (!targets.length) { setNotice('这组照片已经是这个分类'); return false }
    if (!window.confirm(`确认把相似组中的 ${targets.length} 张照片改为“${category}”？只移动分类副本，原图保留`)) return false
    setBusy(true); setError(''); setNotice('')
    const updated: Array<{ id: string; category: string }> = []
    const failed: Array<{ id: string; error: string }> = []
    const undoItems: UndoItem[] = []
    let completed = false
    try {
      for (let index = 0; index < targets.length; index += 100) {
        const result = await control('/api/batch-update-category', { confirm: true, updates: targets.slice(index, index + 100).map(record => ({ id: record.id, category })) }) as { updated?: Array<{ id: string; category: string }>; failed?: Array<{ id: string; error: string }> }
        updated.push(...(result.updated ?? []))
        failed.push(...(result.failed ?? []))
      }
      completed = failed.length === 0
      setNotice(`相似组已改为“${category}”${failed.length ? ` · ${failed.length} 张失败` : ''} · 原图仍保留`)
      return completed
    } catch (caught) { setError(caught instanceof Error ? caught.message : '相似组分类修改失败'); return false }
    finally {
      for (const target of targets) if (updated.some(item => item.id === target.id) && target.category) undoItems.push({ id: target.id, category: target.category, manualCategory: target.manualCategory, manualAction: target.manualAction, manualCategoryAt: target.manualCategoryAt })
      await refreshStatus()
      if (undoItems.length) offerUndo({ label: `已修改相似组 ${undoItems.length} 张照片的分类`, items: undoItems })
      setBusy(false)
    }
  }
  const exportRecords = () => {
    if (!records.length) return
    const cell = (value: unknown) => {
      const text = String(value ?? '')
      const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
      return `"${safe.replaceAll('"', '""')}"`
    }
    const lines = [['文件名', '分类', '人工修正', '收藏', '质量分', '场景', '完成时间', '状态'].map(cell).join(',')]
    for (const record of records) lines.push([record.name, record.category, record.manualCategory, record.favorite ? '是' : '否', record.qualityScore, record.sceneLabel, record.completedAt, record.status].map(cell).join(','))
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `LensSort-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice(`已导出 ${records.length} 条分类清单 · 原图仍在来源文件夹`)
  }
  const dismissGuide = () => { setGuideDismissed(true); try { localStorage.setItem('lenssort-guide-dismissed', '1') } catch {} }
  const emptyState = filter === '收藏'
    ? { title: '还没有收藏照片', lines: ['在照片卡片或详情页点击收藏', '收藏照片会集中出现在这里'] }
    : filter === '辅助推荐'
    ? { title: '还没有辅助推荐', lines: doneCount > 0 ? ['点击上方“辅助推荐”生成参考结果', '它不会移动或删除原图'] : ['先完成照片分类，再生成辅助推荐', '辅助推荐只供人工挑片参考'] }
    : filter === '失败'
      ? { title: failedCount > 0 ? '暂时没有可显示的失败项' : '当前没有读取失败的照片', lines: ['刷新当前文件夹可以重新核对磁盘内容', '原图不会被删除或移动'] }
      : filter === '全部'
? { title: status ? (removedCount > 0 ? '当前没有可显示的照片' : '来源文件夹还没有照片') : '等待本地服务连接', lines: status ? (removedCount > 0 ? ['本批已完成，部分分类副本已被删除或移除', '点击“刷新”重新核对磁盘内容'] : ['把照片放入来源文件夹后点击开始分类', '原图不会被删除或移动']) : ['请先打开本地服务，再刷新此页面', '连接后会读取当前文件夹内容'] }
        : { title: `“${filter}”暂时没有照片`, lines: ['可以切换其他分类查看', '分类结果始终以当前磁盘扫描为准'] }
  const selectedVision = selectedPhoto?.visionExplanation
  const selectedImageSource = selectedPhoto ? selectedPhoto.imageUrl ?? '/api/photo-image/' + selectedPhoto.id : ''
  const selectedNaturalExplanation = (selectedVision?.generated
    ? selectedVision.explanation ?? [selectedVision.summary, selectedVision.compositionComment, selectedVision.qualityComment].filter(Boolean).join(' ')
    : selectedPhoto?.explanation ?? selectedPhoto?.reason ?? selectedPhoto?.error) || '暂时没有足够依据生成普通语言说明，建议打开原图人工确认'
  const selectedPersonNote = selectedVision?.generated
    ? selectedVision.realPersonPresent && (selectedVision.personCount ?? 0) > 0
      ? `视觉模型估计画面中约有 ${selectedVision.personCount} 位真人，建议结合原图确认`
      : '视觉模型当前未确认真人；这不等于绝对无人，遮挡、角度和画面大小都可能影响判断'
    : (selectedPhoto?.faceCount ?? 0) > 0
      ? `基础检测发现 ${selectedPhoto?.faceCount} 个脸部候选区域；候选区域不等于已确认真人`
      : '当前没有检测到脸部候选区域；这不能单独证明画面没有人'
  const selectedVisionStatus = selectedVision?.generated ? `视觉模型说明${selectedVision.model ? ` · ${selectedVision.model}` : ''}` : '基础分析说明'
  const folderLabel = config?.input ? config.input.split(/[\\/]/).filter(Boolean).pop() : '未选择文件夹'
  const outputLabel = config?.output ? config.output.split(/[\\/]/).filter(Boolean).pop() : '未选择输出文件夹'
  const modelLabel = config?.model === 'off' ? '基础分析' : config?.model && config.model !== 'auto' ? config.model : '自动选择'
  const settingsReady = Boolean(config?.input?.trim() && config?.output?.trim() && config?.model)
  return <main className={`folder-control${galleryMode ? ' v13-gallery' : ''}`}>
    <header className="control-header"><div className="control-brand"><span className="control-brand-mark" aria-hidden="true">L</span><span className="control-brand-copy"><b>LensSort</b><small>LOCAL PHOTO AI</small></span></div><div className="control-header-actions"><label className="v13-top-search"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={event => { setSearch(event.target.value); setCurrentPage(1) }} placeholder="搜索文件名、分类或说明" /><kbd>⌘K</kbd></label><span className="control-folder-chip" title={config?.input ?? ''}>{folderLabel}</span></div></header>
    <section className="v13-hero">
      <div className="v13-hero-title"><h1>照片分类</h1><p><span className={`v13-meta-dot${settingsReady ? ' ready' : ''}`} aria-hidden="true" />{records.length} 张照片 · {doneCount} 张已整理 · {settingsReady ? '运行配置已就绪' : '运行配置未完成'}</p></div>
      <div className="v13-hero-actions">
        <button type="button" className="quick-action primary toolbar-action" disabled={busy || curating || !status || !settingsReady || status.phase === 'starting' || status.phase === 'stopping'} onClick={() => void operate(!running)}><strong>{busy ? '正在处理…' : running ? '停止分类' : '开始分类'}</strong><span>{running ? '本批结束后自动停止' : settingsReady ? '处理当前文件夹并归类' : '先完成运行配置'}</span></button>
        <button type="button" className="quick-action secondary toolbar-action" disabled={disabled || !status || doneCount === 0} onClick={() => void curate()}><strong>辅助推荐</strong><span>质量与相似照片参考</span></button>
      </div>
      <aside className={`v13-run-card${settingsReady ? '' : ' needs'}`} aria-label="运行配置">
        <div className="v13-run-head"><div className="v13-run-title"><span className="v13-run-gear" aria-hidden="true">⚙</span><b>运行配置</b><span className="v13-run-state"><i aria-hidden="true" />{settingsReady ? '已就绪' : '未完成'}</span></div><button ref={settingsButtonRef} type="button" className="v13-run-edit" aria-label="设置" title="输入/输出文件夹与模型" onClick={() => setSettingsOpen(true)}>编辑设置 →</button></div>
        <div className="v13-run-grid"><div className="v13-run-slot"><span>输入文件夹</span><b>{folderLabel}</b><small>{status?.progress?.total ? `${status.progress.total} 张照片` : '读取当前文件夹'}</small></div><div className="v13-run-slot"><span>输出文件夹</span><b>{outputLabel}</b><small>副本输出 · 原图保留</small></div><div className="v13-run-slot"><span>分类模型</span><b>{modelLabel}</b><small>本地运行 · 不上传</small></div></div>
      </aside>
    </section>

    <section className="v13-filterbar">
      <nav className="control-filters" aria-label="分类筛选">{categories.map(category => <button type="button" key={category} className={filter === category ? 'active' : ''} aria-pressed={filter === category} onClick={() => { setFilter(category); setCurrentPage(1) }}><span>{category}</span><b>{categoryCounts[category] ?? 0}</b></button>)}</nav>
      <div className="v13-filter-actions">
        <div className="v13-mode-switch" role="group" aria-label="视图模式"><button type="button" className={!galleryMode ? 'active' : ''} aria-pressed={!galleryMode} onClick={() => setGalleryMode(false)}>照片</button><button type="button" className={galleryMode ? 'active' : ''} aria-pressed={galleryMode} onClick={() => setGalleryMode(true)}>画廊</button></div>
        <button type="button" className="toolbar-secondary" disabled={busy || rescanBusy || !status} onClick={() => void rescan()}>{rescanBusy ? '正在刷新…' : '刷新'}</button>
        <button type="button" className="toolbar-secondary" disabled={doneCount < 2} onClick={() => setSimilarOpen(true)}>相似组</button>
        <button type="button" className="toolbar-review" disabled={!status} onClick={() => openReview()}>待确认 {pendingCount > 0 ? `(${pendingCount})` : ''}</button>
      </div>
    </section>
    <section className="control-quick-status" data-phase={rescanBusy ? 'rescan' : curating ? 'curating' : status?.phase ?? 'offline'} aria-busy={running || curating}>
      <div className="quick-status-main"><div className="quick-status-title"><span className="quick-status-dot" aria-hidden="true" /><strong role="status" aria-live="polite">{rescanBusy ? '正在刷新当前文件夹' : busy && !curating && status?.phase === 'stopped' && progress?.phase !== 'finished' ? '正在处理操作…' : activityTitle}</strong></div><span>{rescanBusy ? '重新读取电脑磁盘内容，旧状态会按实际文件更新' : activityMessage}{progressFile ? ` · ${progressFile}` : ''}</span>{(curating || status?.phase === 'starting' || progress?.phase === 'scanning' || progress?.phase === 'analyzing' || progress?.phase === 'waiting') && <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent} aria-label="照片处理进度"><i style={{ width: `${progress?.total ? progressPercent : 28}%` }} /></div>}{progress?.total ? <small>{progress.completed}/{progress.total} 张 · {progressPercent}%</small> : null}</div>
      <div className="quick-status-counts"><span>可查看 {doneCount} 张</span><span>已推荐 {curatedCount} 张</span><span>{failedCount} 张失败</span>{removedCount > 0 && <span>本批移除 {removedCount} 张</span>}</div>
    </section>
    {pendingCount > 0 && <section className="review-banner"><div><strong>{pendingCount} 张需要确认</strong><span>先复核这些照片，避免把不确定结果当成已完成。</span></div><button type="button" onClick={() => openReview()}>开始复核</button></section>}
    {status && records.length === 0 && !guideDismissed && <section className="first-run-guide" aria-label="首次使用步骤"><div><strong>第一次使用，按三步开始</strong><ol><li>选择照片来源文件夹</li><li>选择独立的结果文件夹</li><li>点击“开始分类”，处理完自动停止</li></ol></div><div className="first-run-actions"><button type="button" className="settings-save" onClick={() => setSettingsOpen(true)}>设置文件夹</button><button type="button" className="first-run-dismiss" onClick={dismissGuide}>知道了</button></div></section>}
    {(hasBrokenPath || status?.configWarning) && <p className="control-warning two-line-copy" role="alert"><span>{status?.configWarning ?? '检测到路径文字显示异常，请停止筛选后重新点击“选择文件夹”'}</span><span>选择后会按 UTF-8 正确保存中文路径</span></p>}
    {(error || status?.error) && <p className="control-error" role="alert">{error || status?.error}</p>}
    {notice && <p className="control-notice" role="status">{notice}</p>}
    {status?.curation?.warnings?.length ? <details className="control-warning"><summary>辅助推荐有 {status.curation.warnings.length} 项提示（点击查看）</summary><p>{status.curation.warnings.join('；')}</p></details> : null}
    <section className="control-results"><div className="control-heading"><div><h2>{filter === '辅助推荐' ? '辅助推荐' : '照片结果'}</h2><p className="control-results-subtitle">{filter === '辅助推荐' ? '只展示系统认为值得优先查看的照片' : '先看照片，再处理待确认和失败项'}</p></div><span className="control-results-count">当前显示 {visible.length} 张 · 已分类 {doneCount} 张 · 推荐 {curatedCount} 张 · 失败 {failedCount} 张</span></div>
      <div className="results-controls"><label className="sort-control">排序<select value={sort} onChange={event => setSort(event.target.value as SortMode)}><option value="recent">最近完成</option><option value="name">文件名</option><option value="category">分类</option><option value="quality">质量分</option></select></label><button type="button" className="select-all-button" onClick={selectAllVisible} disabled={!visible.some(record => record.status === 'done')}>{selectedCount ? `已选 ${selectedCount} 张` : '选择当前页'}</button><button type="button" className="select-all-button" onClick={exportRecords} disabled={!records.length}>导出清单</button></div>
        {visible.length === 0 && <div className="control-empty"><span className="control-empty-icon" aria-hidden="true">○</span><strong>{running ? '正在读取本批照片' : emptyState.title}</strong><p className="two-line-copy"><span>{emptyState.lines[0]}</span><span>{emptyState.lines[1]}</span></p>{filter === '失败' && <button type="button" className="control-empty-action" disabled={busy || rescanBusy || !status} onClick={() => void rescan()}>{rescanBusy ? '正在刷新…' : '刷新当前文件夹'}</button>}</div>}<div className="control-grid" hidden={visible.length === 0}>{displayed.map(record => <article key={record.id} className={`control-photo${record.category === '待确认' ? ' needs-review' : ''}${record.status !== 'done' ? ' is-unavailable' : ''}${selectedIds.has(record.id) ? ' is-selected' : ''}`}><label className="photo-select" onClick={event => event.stopPropagation()}><input type="checkbox" checked={selectedIds.has(record.id)} onChange={() => toggleSelect(record.id)} aria-label={'选择照片 ' + record.name} /></label><button type="button" className="control-photo-open" onClick={() => void openPhoto(record)} aria-label={'查看照片 ' + record.name} disabled={record.status !== 'done'}>{record.status === 'done' ? <img src={'/api/thumbnail/' + record.id} alt={"照片：" + record.name} loading="lazy" /> : <span className="control-photo-failed">{record.manualAction === 'deleted-output' ? '分类副本已删除' : record.status === 'source-missing' ? '输入原图已移除' : record.status === 'output-missing' ? '分类副本已缺失' : '无法读取照片'}</span>}</button><div className="control-photo-body"><div className="control-photo-heading">{record.favorite && <span className="favorite-badge">收藏</span>}<span className="control-category">{record.category ?? '失败'}</span>{record.curated && <span className="curated-badge">推荐</span>}{record.manualCategory && <span className="manual-category-badge">人工修正</span>}</div><h3>{record.name}</h3><p className="photo-explanation">{record.status !== 'done' ? (record.manualAction === 'deleted-output' ? '分类副本已删除，可刷新当前文件夹' : record.status === 'source-missing' ? '输入原图已从来源文件夹移除' : record.status === 'output-missing' ? '分类副本已缺失，可重新扫描核对' : record.error ?? '这张照片暂时无法读取') : record.manualCategory ? `已人工调整为“${record.category}”` : record.curated ? '已加入辅助推荐，可打开详情查看依据' : '已完成分类，可打开详情查看说明'}</p><div className="photo-card-footer">{record.status !== 'done' ? <small className="photo-status-secondary">需要处理</small> : <small className="photo-status-secondary">{record.category === '待确认' ? '建议人工查看' : '已完成'}</small>}{record.status === 'done' && <><button type="button" className={`favorite-card-action${record.favorite ? ' active' : ''}`} aria-label={record.favorite ? '取消收藏' : '收藏照片'} aria-pressed={record.favorite === true} onClick={() => void toggleFavorite(record)}>{record.favorite ? '★' : '☆'}</button><button type="button" className="photo-detail-link" onClick={() => void openPhoto(record)}>查看详情</button></>}</div></div></article>)}</div><div className="photo-pagination" aria-label="照片分页"><label>每页显示<select aria-label="每页显示" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setCurrentPage(1) }}><option value={30}>30 张</option><option value={60}>60 张</option><option value={120}>120 张</option></select></label><span className="photo-pagination-current">第 {activePage} / {totalPages} 页</span><span className="photo-pagination-total">共 {visible.length} 张</span><div className="photo-pagination-buttons"><button type="button" disabled={activePage <= 1} onClick={() => setCurrentPage(page => Math.max(1, page - 1))}>上一页</button><button type="button" disabled={activePage >= totalPages} onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))}>下一页</button></div></div>
    </section>
      {selectedPhoto && <div className="photo-modal-backdrop" onClick={() => setSelectedPhoto(null)}><section className="photo-modal" role="dialog" aria-modal="true" aria-label={'照片详情 ' + selectedPhoto.name} onClick={event => event.stopPropagation()}><button type="button" className="photo-modal-close" autoFocus onClick={() => setSelectedPhoto(null)}>关闭 ×</button><div className="photo-modal-image">{selectedPhoto.status === 'done' && !imageLoadError ? <img key={`${selectedPhoto.id}-${imageRetryKey}`} src={selectedImageSource} alt={selectedPhoto.name} onError={() => setImageLoadError(true)} /> : <div className="photo-modal-image-state" role="status"><strong>{imageLoadError ? '大图暂时无法读取' : '这张照片暂时无法预览'}</strong><span>{imageLoadError ? '可以重试读取，或关闭详情后刷新当前文件夹' : selectedPhoto.error ?? '当前记录没有可用的输出副本'}</span>{imageLoadError && <button type="button" onClick={() => { setImageLoadError(false); setImageRetryKey(value => value + 1) }}>重试读取大图</button>}</div>}</div><div className="photo-modal-info"><div className="photo-modal-kicker">照片分析说明</div><div className="photo-modal-heading"><div className="control-photo-heading"><span className="control-category" data-category={selectedPhoto.category ?? '未分类'}>{selectedPhoto.category ?? '未分类'}</span>{selectedPhoto.favorite && <span className="favorite-badge">收藏</span>}{selectedPhoto.manualCategory && <span className="manual-category-badge">人工修正</span>}{selectedPhoto.curated && <span className="curated-badge">辅助推荐</span>}</div><span className="photo-explanation-source">{selectedVisionStatus}</span></div><h2>{selectedPhoto.name}</h2><button type="button" className={`favorite-action${selectedPhoto.favorite ? ' active' : ''}`} disabled={busy || selectedPhoto.status !== 'done'} onClick={() => void toggleFavorite(selectedPhoto)}>{selectedPhoto.favorite ? '★ 已收藏' : '☆ 收藏照片'}</button>{detailLoading && <p className="photo-detail-loading" role="status">正在读取最新照片说明…</p>}{detailError && <div className="photo-detail-error" role="alert"><strong>照片说明读取失败</strong><span>{detailError}</span><button type="button" onClick={retryPhotoDetail}>重试读取说明</button></div>}<section className="photo-natural-explanation" aria-label="普通语言说明"><strong>画面解读</strong><p>{selectedNaturalExplanation}</p><p className="photo-person-note">{selectedPersonNote}</p>{selectedVision?.generated && (selectedVision.compositionComment || selectedVision.qualityComment) && <div className="photo-vision-observations"><span>{selectedVision.compositionComment ?? '暂时没有构图说明'}</span><span>{selectedVision.qualityComment ?? '暂时没有质量说明'}</span></div>}</section><CurationResults record={selectedPhoto} /><div className="photo-detail-summary"><span>场景：{selectedPhoto.sceneLabel ?? selectedVision?.scene ?? '综合判断'}</span><span>{selectedVision?.generated ? `视觉模型人数：${selectedVision.personCount ?? '未确定'}` : `脸部候选：${selectedPhoto.faceCount ?? 0}`}</span><span>质量：{selectedPhoto.qualityScore !== undefined ? selectedPhoto.qualityScore + '/100' : '暂无'}</span></div><details className="photo-technical"><summary>查看技术依据</summary><dl><dt>分类依据</dt><dd>{selectedPhoto.reason ?? '暂无文字依据'}{selectedPhoto.visionCategoryApplied ? ' · 已采用视觉模型类别' : ''}</dd><dt>清晰度 / 曝光</dt><dd>{selectedPhoto.clarityScore ?? '暂无'} / {selectedPhoto.exposureStatus ?? '暂无'}</dd><dt>推理设备 / 耗时</dt><dd>{selectedPhoto.device?.name ?? '暂无'} / {selectedPhoto.durationMs ?? '暂无'} ms</dd><dt>视觉模型</dt><dd>{selectedVision?.generated ? `${selectedVision.model ?? '本地视觉模型'} · ${selectedVision.reviewCalls ? `复核 ${selectedVision.reviewCalls} 次` : '单次观察'}` : selectedPhoto.visionModelStatus?.message ?? '本批未启用视觉模型'}</dd><dt>加速验证</dt><dd>{selectedPhoto.npuVerified ? `NPU 已验证 · ${selectedPhoto.npuEvidence?.npuKernelCount ?? 0} 个融合内核 · ${selectedPhoto.npuEvidence?.npuKernelMs ?? 0} ms` : '本地基础推理已完成，未提供 NPU 验证证据'}</dd></dl></details><div className="photo-modal-actions"><div className="photo-action-heading"><strong>人工修正</strong><span>只移动分类结果副本，输入文件夹中的原图始终保留</span></div><label className="category-editor">将照片移到<select aria-label="修改照片分类" value={selectedPhoto.category ?? ''} disabled={busy || selectedPhoto.status !== 'done'} onChange={event => void updateCategory(selectedPhoto, event.target.value)}><option value="" disabled>选择新分类</option>{categories.filter(category => !['全部', '收藏', '辅助推荐', '失败'].includes(category)).map(category => <option key={category} value={category}>{category}</option>)}</select></label><button type="button" className="danger-action" onClick={() => void deleteOutput(selectedPhoto)} disabled={busy || selectedPhoto.status !== 'done'}>删除分类副本</button><p className="control-note two-line-copy"><span>只删除分类副本，来源文件夹中的原图始终保留</span><span>刷新当前文件夹可核对最新磁盘内容</span></p></div></div></section></div>}
      {selectedCount > 0 && <div className="batch-bar" role="region" aria-label="批量操作"><strong>已选 {selectedCount} 张</strong><label>改到<select value={batchCategory} onChange={event => setBatchCategory(event.target.value)}>{categories.filter(category => !['全部', '收藏', '辅助推荐', '失败'].includes(category)).map(category => <option key={category} value={category}>{category}</option>)}</select></label><button type="button" onClick={() => void batchUpdateCategory()} disabled={busy}>应用分类</button><button type="button" className="batch-cancel" onClick={() => setSelectedIds(new Set())}>取消选择</button></div>}
      {reviewOpen && <ReviewOverlay photos={pendingRecords} startId={reviewStartId} busy={busy} onClose={() => setReviewOpen(false)} onCategory={(photo, category) => applyCategory(photo as RecordItem, category, { confirm: false })} onFavorite={toggleFavorite} />}
      {similarOpen && <SimilarGroups busy={disabled} onClose={() => setSimilarOpen(false)} onKeep={async photo => { const record = records.find(item => item.id === photo.id); return record ? toggleFavorite(record) : false }} onApplyCategory={applySimilarCategory} />}
      {settingsOpen && <div className="settings-backdrop" onMouseDown={() => setSettingsOpen(false)}><aside ref={settingsDrawerRef} className="settings-drawer" role="dialog" aria-modal="true" aria-label="设置文件夹与设备" onMouseDown={event => event.stopPropagation()}>
        <header className="settings-drawer-header"><div><span className="source-folder-kicker">工作目录与性能</span><h2 id="source-folder-title">设置</h2><p>目录只读取一次；原图始终保留</p></div><button type="button" className="settings-close" onClick={() => setSettingsOpen(false)}>关闭 ×</button></header>
        <div className="settings-scroll">
        <section className="settings-section" aria-label="文件夹">
          <div className="folder-setting-grid">
            <div className="folder-setting"><label>照片来源文件夹<input aria-label="照片来源文件夹" value={config?.input ?? ''} disabled={disabled} onChange={event => markConfigDirty({ input: event.target.value })} placeholder="可输入路径，也可点击右侧选择" /></label><button type="button" className="folder-picker" disabled={disabled} onClick={() => void pickFolder('input')}>选择文件夹</button></div>
            <div className="folder-setting"><label>分类结果文件夹<input aria-label="分类结果文件夹" value={config?.output ?? ''} disabled={disabled} onChange={event => markConfigDirty({ output: event.target.value })} placeholder="可输入路径，也可点击右侧选择" /></label><button type="button" className="folder-picker" disabled={disabled} onClick={() => void pickFolder('output')}>选择文件夹</button></div>
          </div>
          <div className="workspace-settings-actions"><label>推理设备<select aria-label="推理设备" value={config?.backend ?? 'auto'} disabled={disabled} onChange={event => markConfigDirty({ backend: event.target.value })}>{status?.devices.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label><span className="settings-saved-state">{status ? '本地服务已连接' : '等待连接'}</span></div>
        </section>
        <section className="settings-section" aria-label="加速与视觉模型状态">
          <div className="device-status-summary"><div className="device-status-item"><span className="device-status-label">基础分类设备</span><strong>{status?.device?.name ?? '尚未启动'}</strong><span>{status?.device ? '本批实际报告设备' : `当前选择：${status?.config.backend ?? config?.backend ?? '自动选择'}`}</span></div><div className="device-status-item"><span className="device-status-label">NPU 证据</span><strong className={status?.npuVerified && npuEvidence ? 'verified' : 'pending'}>{status?.npuVerified && npuEvidence ? '已验证' : '尚未验证'}</strong><span>{npuStatusText}</span></div><div className="device-status-item"><span className="device-status-label">视觉模型服务</span><strong>{status?.visionModelStatus?.model ?? '未加载'}</strong><span>{status?.visionModelStatus?.message ?? visionDeviceText}</span></div></div>
        </section>
        <ModelSettings value={config?.model ?? 'auto'} visionMode={config?.visionMode ?? 'balanced'} semanticModel={config?.semanticModel ?? 'auto'} force={Boolean(config?.forceModel)} disabled={disabled || !status} onChange={model => void changeModel(model)} onVisionMode={mode => void changeVisionMode(mode)} onSemanticModel={model => void changeSemanticModel(model)} onForce={() => void forceModel()} />
        </div>
        <footer className="settings-drawer-footer"><button type="button" className="settings-save" disabled={busy || !status} onClick={() => void saveSettings()}>保存并关闭</button><span>修改在下一批分类生效</span></footer>
      </aside></div>}
      {undo && <div className="undo-toast" role="status"><span>{undo.label}</span><button type="button" onClick={() => void undoLast()} disabled={busy}>撤销</button><button type="button" className="undo-close" aria-label="关闭撤销提示" onClick={() => setUndo(null)}>×</button></div>}
      <footer>照片只在本机处理 · 自动复制，不删除原图 · 本批完成自动停止</footer>
  </main>
}
