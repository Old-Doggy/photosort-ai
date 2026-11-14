import { readFile } from 'node:fs/promises'
import { writeAtomicJson } from './atomic-state.js'

const categories = new Set(['单人', '多人', '人物与风景', '风景', '动物', '植物', '其他', '待确认'])
export const emptyPreferenceProfile = () => ({ version: 1, scenes: {}, updatedAt: null })

const sceneKey = value => String(value ?? '').trim().toLowerCase().slice(0, 120)
const finiteCount = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0

export async function loadPreferenceProfile(file) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || !parsed.scenes || typeof parsed.scenes !== 'object') return emptyPreferenceProfile()
    return { version: 1, scenes: parsed.scenes, updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null }
  } catch (error) {
    if (error.code === 'ENOENT' || error.name === 'SyntaxError') return emptyPreferenceProfile()
    throw error
  }
}

export async function savePreferenceProfile(file, profile) {
  await writeAtomicJson(file, profile)
}

export function recordPreference(profile, { sceneLabel, from, to } = {}) {
  const key = sceneKey(sceneLabel)
  const target = String(to ?? '')
  if (!key || !categories.has(target) || from === target) return profile
  const scenes = { ...(profile?.scenes ?? {}) }
  const entry = { ...(scenes[key] ?? { from: {}, to: {}, updatedAt: null }) }
  const fromCounts = { ...(entry.from ?? {}) }
  const toCounts = { ...(entry.to ?? {}) }
  if (from) fromCounts[String(from)] = (finiteCount(fromCounts[String(from)]) + 1)
  toCounts[target] = (finiteCount(toCounts[target]) + 1)
  scenes[key] = { from: fromCounts, to: toCounts, updatedAt: new Date().toISOString() }
  const keys = Object.keys(scenes)
  if (keys.length > 500) {
    keys.sort((left, right) => String(scenes[left].updatedAt ?? '').localeCompare(String(scenes[right].updatedAt ?? '')))
    for (const old of keys.slice(0, keys.length - 500)) delete scenes[old]
  }
  return { version: 1, scenes, updatedAt: new Date().toISOString() }
}

export function preferenceFor(profile, sceneLabel) {
  const key = sceneKey(sceneLabel)
  const entry = profile?.scenes?.[key]
  if (!key || !entry?.to) return null
  const ranked = Object.entries(entry.to)
    .map(([category, count]) => ({ category, count: finiteCount(count) }))
    .filter(item => categories.has(item.category) && item.count > 0)
    .sort((left, right) => right.count - left.count)
  const best = ranked[0]
  const total = ranked.reduce((sum, item) => sum + item.count, 0)
  if (!best || best.count < 2 || best.count / total < 0.6) return null
  return { category: best.category, count: best.count, total, sceneLabel: String(sceneLabel).slice(0, 120) }
}

export function preferenceSummary(profile) {
  const scenes = Object.entries(profile?.scenes ?? {}).map(([key, entry]) => {
    const total = Object.values(entry?.to ?? {}).reduce((sum, value) => sum + finiteCount(value), 0)
    return { scene: key, corrections: total, updatedAt: entry?.updatedAt ?? null }
  }).filter(item => item.corrections > 0).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
  return { version: 1, learnedScenes: scenes.length, corrections: scenes.reduce((sum, item) => sum + item.corrections, 0), recentScenes: scenes.slice(0, 8), updatedAt: profile?.updatedAt ?? null, boundary: 'local correction memory; suggestion only, never automatic reclassification' }
}
