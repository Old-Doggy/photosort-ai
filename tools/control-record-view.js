import { createHash } from 'node:crypto'
import path from 'node:path'
import { preferenceFor } from './preference-store.js'

export const recordId = source => createHash('sha256').update(source).digest('hex')

export function projectRecord(source, record, { status, error, faceBoxes, curatedIds, preferenceProfile }) {
  const id = recordId(source)
  return {
    id,
    name: path.basename(source),
    status,
    favorite: record.favorite === true,
    favoriteAt: record.favoriteAt ?? null,
    manualAction: record.manualAction ?? null,
    manualCategory: record.manualCategory ?? null,
    manualCategoryAt: record.manualCategoryAt ?? null,
    deletedAt: record.deletedAt ?? null,
    category: record.result?.category,
    sceneLabel: record.result?.sceneLabel ?? null,
    preferenceSuggestion: preferenceFor(preferenceProfile, record.result?.sceneLabel),
    reason: record.result?.reason,
    explanation: record.result?.explanation ?? null,
    hash: record.hash,
    dhash: record.result?.dhash ?? null,
    qualityScore: record.result?.qualityScore,
    qualityReasons: record.result?.qualityReasons ?? [],
    clarityScore: record.result?.clarityScore,
    exposureStatus: record.result?.exposureStatus,
    faceCount: record.result?.faces?.faceCount ?? 0,
    faceAreaRatio: record.result?.faces?.faceAreaRatio ?? 0,
    faceBoxes,
    error,
    backend: record.result?.backend,
    device: record.result?.device,
    durationMs: record.result?.durationMs,
    npuVerified: record.result?.npuVerified ?? false,
    npuEvidence: record.result?.npuEvidence ?? null,
    modelEvidence: record.result?.modelEvidence ?? null,
    personDetection: record.result?.personDetection ?? null,
    sceneSemantics: record.result?.sceneSemantics ?? null,
    visionTriggered: record.result?.visionTriggered ?? false,
    visionTriggerReason: record.result?.visionTriggerReason ?? null,
    visionCategoryApplied: record.result?.visionCategoryApplied ?? false,
    visionExplanation: record.result?.visionExplanation ?? null,
    visionModelStatus: record.result?.visionModelStatus ?? null,
    aestheticScore: record.result?.aestheticScore ?? null,
    aestheticNormalizedScore: record.result?.aestheticNormalizedScore ?? null,
    completedAt: record.completedAt,
    output: record.output,
    curated: status === 'done' && curatedIds.has(id),
    source,
  }
}
