import { useEffect, useRef, useState } from 'react'
import './ReviewOverlay.css'
import EyeRisk from './EyeRisk'

export type ReviewPhoto = {
  id: string
  name: string
  category?: string
  status: string
  favorite?: boolean
  qualityScore?: number
  faceCount?: number
  faceBoxes?: Array<{ score?: number; x: number; y: number; width: number; height: number }>
  preferenceSuggestion?: { category: string; count: number; total: number; sceneLabel?: string } | null
  reason?: string
  explanation?: string | null
  sceneLabel?: string | null
  manualCategory?: string | null
}

const choices = ['单人', '多人', '人物与风景', '风景', '动物', '植物', '其他', '待确认']

export default function ReviewOverlay({ photos, startId, busy, onClose, onCategory, onFavorite }: {
  photos: ReviewPhoto[]
  startId?: string | null
  busy: boolean
  onClose: () => void
  onCategory: (photo: ReviewPhoto, category: string) => Promise<boolean>
  onFavorite: (photo: ReviewPhoto) => Promise<boolean>
}) {
  const initial = Math.max(0, photos.findIndex(photo => photo.id === startId))
  const [index, setIndex] = useState(initial)
  const [error, setError] = useState('')
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const overlayRef = useRef<HTMLElement | null>(null)
  const current = photos[Math.min(index, Math.max(0, photos.length - 1))]
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- clamp after the parent removes the current pending photo
    setIndex(value => Math.min(value, Math.max(0, photos.length - 1)))
  }, [photos.length])
  useEffect(() => { closeRef.current?.focus() }, [])
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])
  useEffect(() => {
    if (!current) onClose()
  }, [current, onClose])
  const choose = async (category: string) => {
    if (!current || busy || category === current.category) return
    setError('')
    const ok = await onCategory(current, category)
    if (!ok) { setError('修改没有完成，请重试或检查本地服务'); return }
    setError('')
  }
  const favorite = async () => {
    if (!current || busy) return
    const ok = await onFavorite(current)
    if (!ok) setError('收藏状态更新失败')
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key === 'Tab' && overlayRef.current) {
        const controls = [...overlayRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), [tabindex="0"]')].filter(element => element.getClientRects().length > 0)
        const first = controls[0]
        const last = controls.at(-1)
        if (!first || !last) return
        if (!overlayRef.current.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus()
        }
        return
      }
      if (event.key === 'ArrowRight') { event.preventDefault(); setIndex(value => Math.min(photos.length - 1, value + 1)); return }
      if (event.key === 'ArrowLeft') { event.preventDefault(); setIndex(value => Math.max(0, value - 1)); return }
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); void favorite(); return }
      if (/^[1-8]$/.test(event.key)) {
        const category = choices[Number(event.key) - 1]
        if (category) { event.preventDefault(); void choose(category) }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })
  if (!current) return null
  const imageUrl = '/api/photo-image/' + current.id
  return <div className="review-backdrop" role="presentation">
    <section ref={overlayRef} className="review-overlay" role="dialog" aria-modal="true" aria-labelledby="review-title">
      <header className="review-overlay-header">
        <div><span className="review-kicker">待确认复核</span><h2 id="review-title">{current.name}</h2><span>{index + 1} / {photos.length} · 快捷键 1–8 改类，←/→ 切换，F 收藏，Esc 关闭</span></div>
        <button ref={closeRef} type="button" className="review-close" onClick={onClose}>关闭 ×</button>
      </header>
      <div className="review-overlay-body">
        <div className="review-image"><img src={imageUrl} alt={'照片：' + current.name} /></div>
        <aside className="review-side">
          <div className="review-current-category"><span>当前分类</span><strong>{current.category ?? '未分类'}</strong></div>
          <div className="review-category-grid" aria-label="修改分类">{choices.map((category, choiceIndex) => <button type="button" key={category} disabled={busy} aria-pressed={current.category === category} className={current.category === category ? 'active' : ''} onClick={() => void choose(category)}><b>{choiceIndex + 1}</b>{category}</button>)}</div>
          <div className="review-side-actions"><button type="button" disabled={busy} onClick={() => void favorite()}>{current.favorite ? '★ 已收藏' : '☆ 收藏'}</button><button type="button" onClick={onClose}>稍后处理</button></div>
          <p className="review-safe-note">只移动分类结果副本，来源文件夹中的原图始终保留。修改后可在页面底部撤销。</p>
          <div className="review-facts"><span>质量 {current.qualityScore ?? '暂无'}/100</span><span>人脸候选 {current.faceCount ?? 0}</span><span>{current.sceneLabel ?? '综合判断'}</span></div>
          {current.preferenceSuggestion && <div className="review-preference"><span>本地偏好提示</span><strong>类似场景你曾 {current.preferenceSuggestion.count}/{current.preferenceSuggestion.total} 次改为“{current.preferenceSuggestion.category}”</strong><button type="button" disabled={busy} onClick={() => void choose(current.preferenceSuggestion!.category)}>采用建议</button><small>来自你过去的本地修正，不会自动改类。</small></div>}
          {current.faceBoxes && current.faceBoxes.length > 0 && <div className="review-faces"><span>人脸特写</span><div>{current.faceBoxes.slice(0, 4).map((_, faceIndex) => <img key={faceIndex} src={`/api/face-image/${current.id}/${faceIndex}`} alt={`${current.name} 的第 ${faceIndex + 1} 个人脸候选`} loading="lazy" />)}</div><small>只展示检测框内的局部，不代表身份确认或闭眼结论。</small></div>}
          <EyeRisk key={current.id} photoId={current.id} faceCount={current.faceCount ?? 0} />
          <p className="review-reason">{current.explanation || current.reason || '暂时没有足够依据，建议结合原图人工判断。'}</p>
          {error && <p className="review-error" role="alert">{error}</p>}
          <div className="review-nav"><button type="button" disabled={index <= 0} onClick={() => setIndex(value => Math.max(0, value - 1))}>← 上一张</button><button type="button" disabled={index >= photos.length - 1} onClick={() => setIndex(value => Math.min(photos.length - 1, value + 1))}>下一张 →</button></div>
        </aside>
      </div>
    </section>
  </div>
}
