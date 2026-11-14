import path from 'node:path'
import { env, pipeline } from '@huggingface/transformers'

const labels = [
  'a natural landscape',
  'a cityscape',
  'a building or architectural scene',
  'a night scene',
  'a photo of the sky',
  'a photo of clouds or sunset',
  'a portrait of one person',
  'a group photo',
  'a person in an environment',
  'a photo of an animal',
  'a photo of a bird',
  'a photo of a dog or cat',
  'a close-up photo of flowers or plants',
  'a photo of leaves or fruit on a plant',
  'a photo of a statue or sculpture',
  'a statue or sculpture next to a person',
  'an indoor scene',
  'an ordinary object',
]

export const siglip2ModelId = 'onnx-community/siglip2-base-patch16-224-ONNX'

export async function createSiglip2SceneAnalyzer(root) {
  env.allowLocalModels = true
  env.allowRemoteModels = false
  env.localModelPath = path.join(root, 'public', 'models')
  let classifierPromise
  const load = async () => {
    classifierPromise ??= pipeline('zero-shot-image-classification', siglip2ModelId, { device: 'cpu', dtype: 'q8', local_files_only: true })
    return classifierPromise
  }
  return {
    async analyze(bytes) {
      try {
        const classifier = await load()
        const output = await classifier(new Blob([bytes]), labels)
        const total = output.reduce((sum, item) => sum + Number(item.score ?? 0), 0)
        const topK = output
          .map(item => ({ label: item.label, score: total > 0 ? Number(item.score) / total : 0, rawScore: Number(item.score ?? 0) }))
          .sort((left, right) => right.score - left.score)
        return { status: 'succeeded', source: 'SigLIP2 ViT-B/16-224', topLabel: topK[0]?.label ?? null, topScore: topK[0]?.score ?? null, candidates: topK }
      } catch (error) {
        classifierPromise = null
        return { status: 'unavailable', source: 'SigLIP2 ViT-B/16-224', topLabel: null, topScore: null, candidates: [], error: error instanceof Error ? error.message : String(error) }
      }
    },
    async close() {
      if (!classifierPromise) return
      try { const classifier = await classifierPromise; if (typeof classifier.dispose === 'function') await classifier.dispose() }
      finally { classifierPromise = null }
    },
  }
}
