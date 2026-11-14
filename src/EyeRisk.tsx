import { useEffect, useState } from 'react'
import { detectFaceLandmarks } from './face-landmarker'

type EyeStatus = { status: 'loading' | 'ready' | 'unavailable' | 'no-face'; label: string }

export default function EyeRisk({ photoId, faceCount }: { photoId: string; faceCount: number }) {
  const [state, setState] = useState<EyeStatus>(() => faceCount > 0
    ? { status: 'loading', label: '正在检查人脸关键点…' }
    : { status: 'no-face', label: '没有可靠人脸候选，无法判断闭眼' })
  useEffect(() => {
    if (faceCount < 1) return
    let active = true
    fetch('/api/photo-image/' + photoId, { cache: 'no-store', signal: AbortSignal.timeout(30000) })
      .then(response => { if (!response.ok) throw new Error('无法读取大图'); return response.blob() })
      .then(blob => detectFaceLandmarks(blob))
      .then(result => {
        if (!active) return
        if (result.closedEyeStatus === 'review') setState({ status: 'ready', label: '检测到闭眼风险，建议查看大图确认' })
        else if (result.closedEyeStatus === 'low') setState({ status: 'ready', label: '未发现明显闭眼风险' })
        else setState({ status: 'unavailable', label: '人脸关键点不足，闭眼风险未测' })
      })
      .catch(() => { if (active) setState({ status: 'unavailable', label: '闭眼风险未测（关键点模型不可用）' }) })
    return () => { active = false }
  }, [photoId, faceCount])
  return <div className={`review-eye ${state.status}`} role="status"><span>闭眼风险</span><strong>{state.label}</strong><small>只根据人脸关键点的瞬时分数，不等于真实表情或拍摄质量结论。</small></div>
}
