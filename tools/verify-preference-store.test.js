import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { emptyPreferenceProfile, loadPreferenceProfile, preferenceFor, preferenceSummary, recordPreference, savePreferenceProfile } from './preference-store.js'

test('two consistent scene corrections become an explainable suggestion', () => {
  let profile = emptyPreferenceProfile()
  profile = recordPreference(profile, { sceneLabel: '海边日落', from: '待确认', to: '风景' })
  assert.equal(preferenceFor(profile, '海边日落'), null)
  profile = recordPreference(profile, { sceneLabel: '海边日落', from: '待确认', to: '风景' })
  const hint = preferenceFor(profile, '海边日落')
  assert.equal(hint.category, '风景')
  assert.equal(hint.count, 2)
  assert.equal(hint.total, 2)
  assert.equal(preferenceSummary(profile).learnedScenes, 1)
  assert.match(preferenceSummary(profile).boundary, /never automatic/)
})

test('conflicting corrections do not produce a confident scene suggestion', () => {
  let profile = emptyPreferenceProfile()
  profile = recordPreference(profile, { sceneLabel: '混合场景', from: '待确认', to: '风景' })
  profile = recordPreference(profile, { sceneLabel: '混合场景', from: '待确认', to: '风景' })
  profile = recordPreference(profile, { sceneLabel: '混合场景', from: '待确认', to: '动物' })
  profile = recordPreference(profile, { sceneLabel: '混合场景', from: '待确认', to: '动物' })
  assert.equal(preferenceFor(profile, '混合场景'), null)
})

test('preference profile persists atomically and reloads', async () => {
  const folder = await mkdtemp(path.resolve('artifacts/preference-store-'))
  const file = path.join(folder, 'preferences.json')
  let profile = emptyPreferenceProfile()
  profile = recordPreference(profile, { sceneLabel: '城市夜景', from: '待确认', to: '风景' })
  profile = recordPreference(profile, { sceneLabel: '城市夜景', from: '待确认', to: '风景' })
  await savePreferenceProfile(file, profile)
  const loaded = await loadPreferenceProfile(file)
  assert.equal(preferenceFor(loaded, '城市夜景').category, '风景')
  assert.equal(preferenceSummary(loaded).corrections, 2)
})
