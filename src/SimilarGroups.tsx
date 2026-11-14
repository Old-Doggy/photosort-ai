import { useEffect, useRef, useState } from 'react'
import './SimilarGroups.css'

type SimilarPhoto = { id: string; name: string; category: string; qualityScore: number | null; favorite: boolean; distance: number; imageUrl: string }
type SimilarGroup = { id: string; representativeId: string; reason: string; photos: SimilarPhoto[] }
type Response = { groups: SimilarGroup[]; considered: number; skipped: Array<{ id: string; reason: string }>; boundary: string }
const categories = ['单人', '多人', '人物与风景', '风景', '动物', '植物', '其他', '待确认']

export default function SimilarGroups({ busy, onClose, onKeep, onApplyCategory }: { busy: boolean; onClose: () => void; onKeep: (photo: SimilarPhoto) => Promise<boolean>; onApplyCategory: (photos: SimilarPhoto[], category: string) => Promise<boolean> }) {
  const [data, setData] = useState<Response | null>(null)
  const [error, setError] = useState('')
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null)
  const [bulkCategory, setBulkCategory] = useState('')
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const [photoPage, setPhotoPage] = useState(1)
  const actionRef = useRef(false)
  useEffect(() => {
    closeRef.current?.focus()
    const controller = new AbortController()
    let timedOut = false
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort() }, 120000)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    fetch('/api/similar-groups', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? '无法读取相似组')
        const groups = ((body.groups ?? []) as SimilarGroup[]).filter(group => Array.isArray(group.photos) && group.photos.length > 0)
        setData({ ...body, groups })
        setActiveGroupId(groups[0]?.id ?? null)
        setActivePhotoId(groups[0]?.photos[0]?.id ?? null)
        setBulkCategory(groups[0]?.photos[0]?.category ?? '')
      })
      .catch(caught => {
        if (caught.name === 'AbortError' && !timedOut) return
        setError(timedOut ? '相似组读取超时，请稍后重试' : caught.message)
      })
      .finally(() => window.clearTimeout(timeout))
    return () => { window.clearTimeout(timeout); controller.abort(); document.body.style.overflow = previousOverflow }
  }, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key === 'Tab') {
        const focusables = [...document.querySelectorAll<HTMLElement>('.similar-overlay button:not(:disabled), .similar-overlay select:not(:disabled), .similar-overlay a[href]')].filter(element => element.getClientRects().length > 0)
        const first = focusables[0]
        const last = focusables.at(-1)
        if (!first || !last) return
        if (!document.querySelector('.similar-overlay')?.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  const group = data?.groups.find(item => item.id === activeGroupId) ?? null
  const active = group?.photos.find(photo => photo.id === activePhotoId) ?? group?.photos[0] ?? null
  const totalPages = Math.max(1, Math.ceil((group?.photos.length ?? 0) / 12))
  const activePage = Math.min(photoPage, totalPages)
  const displayed = group?.photos.slice((activePage - 1) * 12, activePage * 12) ?? []
  const keep = async (photo: SimilarPhoto) => {
    if (busy || actionRef.current) return
    actionRef.current = true
    let ok = false
    try { ok = await onKeep(photo) } finally { actionRef.current = false }
    if (!ok) return
    setData(current => current ? { ...current, groups: current.groups.map(item => item.id === group?.id ? { ...item, photos: item.photos.map(candidate => candidate.id === photo.id ? { ...candidate, favorite: true } : candidate) } : item) } : current)
  }
  const applyCategory = async () => {
    if (!group || !bulkCategory || busy || actionRef.current) return
    actionRef.current = true
    let ok = false
    try { ok = await onApplyCategory(group.photos, bulkCategory) } finally { actionRef.current = false }
    if (!ok) return
    setData(current => current ? { ...current, groups: current.groups.map(item => item.id === group.id ? { ...item, photos: item.photos.map(photo => ({ ...photo, category: bulkCategory })) } : item) } : current)
  }
  return <div className="similar-backdrop"><section className="similar-overlay" role="dialog" aria-modal="true" aria-labelledby="similar-title">
    <header className="similar-header"><div><span className="review-kicker">相似照片</span><h2 id="similar-title">并排比较相似照片</h2><span>只帮助你比较和保留，不会自动删除任何原图或分类副本。</span></div><button ref={closeRef} type="button" className="settings-close" onClick={onClose}>关闭 ×</button></header>
    {!data && !error && <div className="similar-state" role="status">正在计算画面相似度…</div>}
    {error && <div className="similar-state error" role="alert">{error}</div>}
    {data && data.groups.length === 0 && <div className="similar-state"><strong>没有发现明显的相似组</strong><span>低信息图片和纯色图片不参与感知聚类；这不代表相册里没有重复内容。</span></div>}
    {data && data.groups.length > 0 && <div className="similar-body">
    <nav className="similar-groups" aria-label="相似组列表">{data.groups.map(item => <button type="button" key={item.id} className={item.id === activeGroupId ? 'active' : ''} onClick={() => { setActiveGroupId(item.id); setPhotoPage(1); setActivePhotoId(item.photos[0].id); setBulkCategory(item.photos[0].category) }}><img src={item.photos[0].imageUrl} alt="" loading="lazy" /><span><strong>{item.photos[0].name}</strong><small>{item.photos.length} 张相似照片</small></span></button>)}</nav>
      {group && <div className="similar-compare">
        <div className="similar-compare-head"><strong>{group.photos.length} 张相似照片</strong><span>{group.reason}</span></div>
        <div className="similar-photos" style={{ gridTemplateColumns: `repeat(${Math.min(displayed.length, 4)}, minmax(0, 1fr))` }}>{displayed.map(photo => <button type="button" key={photo.id} className={photo.id === active?.id ? 'active' : ''} onClick={() => { setActivePhotoId(photo.id); setBulkCategory(photo.category) }}><img src={photo.imageUrl} alt={photo.name} loading="lazy" /><span><strong>{photo.name}</strong><small>{photo.category} · 质量 {photo.qualityScore ?? '暂无'} · 差异 {photo.distance}</small></span>{photo.favorite && <b className="similar-kept">已收藏</b>}</button>)}</div>
        {totalPages > 1 && <nav className="photo-pagination" aria-label="相似组分页"><button type="button" disabled={activePage <= 1} onClick={() => setPhotoPage(activePage - 1)}>上一组内页</button><span>第 {activePage} / {totalPages} 页 · 每页 12 张</span><button type="button" disabled={activePage >= totalPages} onClick={() => setPhotoPage(activePage + 1)}>下一组内页</button></nav>}
        {active && <a href={'/api/photo-image/' + active.id} target="_blank" rel="noreferrer">打开当前照片大图</a>}
        {active && <div className="similar-active"><div className="similar-active-info"><span className="control-category">{active.category}</span><strong>{active.name}</strong><span>本组中与代表图的感知差异 {active.distance} / 256</span></div><button type="button" className="settings-save" disabled={busy || active.favorite} onClick={() => void keep(active)}>{active.favorite ? '已收藏' : '收藏这张'}</button></div>}
        <div className="similar-bulk"><label>整组改为<select aria-label="整组分类" disabled={busy} value={bulkCategory} onChange={event => setBulkCategory(event.target.value)}>{categories.map(category => <option key={category} value={category}>{category}</option>)}</select></label><button type="button" className="settings-save" onClick={() => void applyCategory()} disabled={busy || !bulkCategory}>应用到本组</button><span>会移动本组所有分类副本；原图保留，可在页面底部撤销。</span></div>
        <p className="similar-boundary">{data.boundary} · 已检查 {data.considered} 张，跳过 {data.skipped.length} 张低信息/读取失败图片。</p>
      </div>}
    </div>}
  </section></div>
}
