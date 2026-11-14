import { useEffect, useMemo, useState } from 'react'

type Item = { imageId: string; candidateLabel: string; candidateScore: number; sourceLabelNames: string[]; personBoxCount: number; personGroupBox: boolean; mappingReason: string; sourcePageUrl: string | null; humanLabel: string | null }
type State = { categories: string[]; total: number; reviewed: number; pending: number; records: Item[] }

export default function ReviewPanel() {
  const [state, setState] = useState<State | null>(null)
  const [index, setIndex] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    const load = async () => {
      const statusResponse = await fetch('/api/status', { cache: 'no-store', credentials: 'same-origin' })
      if (!statusResponse.ok) throw new Error('本地服务尚未启动')
      const response = await fetch('/api/review', { cache: 'no-store', credentials: 'same-origin' })
      const next = await response.json()
      if (!response.ok) throw new Error(next.error ?? '无法读取审核清单')
      if (active) setState(next)
    }
    void load().catch(caught => { if (active) setError(caught instanceof Error ? caught.message : '无法读取审核清单') })
    return () => { active = false }
  }, [])
  const current = state?.records[index]
  const nextPending = useMemo(() => state?.records.findIndex((item, itemIndex) => itemIndex > index && !item.humanLabel) ?? -1, [state, index])
  const save = async (label: string) => {
    if (!current || busy) return
    setBusy(true); setError('')
    try {
      const options = { method: 'POST', credentials: 'same-origin' as const, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ imageId: current.imageId, label }) }
      let response = await fetch('/api/review', options)
      if (response.status === 401) {
        await fetch('/api/status', { cache: 'no-store', credentials: 'same-origin' })
        response = await fetch('/api/review', options)
      }
      const next = await response.json()
      if (!response.ok) throw new Error(next.error ?? '保存失败')
      setState(next)
      const target = next.records.findIndex((item: Item) => !item.humanLabel)
      setIndex(target >= 0 ? target : Math.min(index, next.records.length - 1))
    } catch (caught) { setError(caught instanceof Error ? caught.message : '保存失败') }
    finally { setBusy(false) }
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const labelIndex = Number(event.key) - 1
      if (Number.isInteger(labelIndex) && labelIndex >= 0 && labelIndex < (state?.categories.length ?? 0)) {
        event.preventDefault()
        if (state) void save(state.categories[labelIndex])
      }
      if (event.key === 'ArrowLeft') setIndex(value => Math.max(0, value - 1))
      if (event.key === 'ArrowRight') setIndex(value => Math.min((state?.records.length ?? 1) - 1, value + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  if (!state) return <main className="review-page"><a href="/">返回自动分类</a><p>{error || '正在读取审核清单…'}</p></main>
  return <main className="review-page">
    <header className="review-header"><div><p>LOCAL LABEL REVIEW</p><h1>快速确认照片类别</h1><span>AI 只给建议，按 1–8 键或点击按钮确认，每次选择自动保存。</span></div><a href="/">返回自动分类</a></header>
    <section className="review-progress"><strong>{state.reviewed}/{state.total} 已确认</strong><span>剩余 {state.pending} 张 · 当前第 {state.total ? index + 1 : 0} 张</span><progress max={Math.max(1, state.total)} value={state.reviewed} /></section>
    {error && <p className="review-error" role="alert">{error}</p>}
    {current ? <section className="review-card"><div className="review-image-wrap"><img src={'/api/review/thumbnail/' + current.imageId} alt={current.imageId} /><span>{current.humanLabel ? `已确认：${current.humanLabel}` : '待确认'}</span></div><div className="review-info"><p className="review-kicker">AI 建议：{current.candidateLabel} · {Math.round(current.candidateScore * 100)}%</p><h2>{current.sourceLabelNames.slice(0, 6).join('、') || '暂无原始标签'}</h2><p>{current.mappingReason}</p><p>人框证据：{current.personBoxCount} 个{current.personGroupBox ? '（含群组框）' : ''}</p><a href={current.sourcePageUrl ?? '#'} target="_blank" rel="noreferrer">查看来源页面</a><div className="review-labels" aria-label="选择人工类别">{state.categories.map((label, labelIndex) => <button key={label} type="button" className={current.humanLabel === label ? 'selected' : ''} disabled={busy} onClick={() => void save(label)}><b>{labelIndex + 1}</b>{label}</button>)}</div><div className="review-nav"><button type="button" disabled={index === 0} onClick={() => setIndex(value => Math.max(0, value - 1))}>上一张</button><button type="button" disabled={nextPending < 0} onClick={() => setIndex(nextPending)}>下一张待确认</button><button type="button" disabled={index >= state.records.length - 1} onClick={() => setIndex(value => Math.min(state.records.length - 1, value + 1))}>下一张</button></div></div></section> : <section className="review-empty"><strong>审核清单为空</strong><p>请先生成并下载公开候选样本。</p></section>}
    <footer>审核结果写入 data/eval/labeled；不会修改原始候选，也不会启动自动筛选。</footer>
  </main>
}
