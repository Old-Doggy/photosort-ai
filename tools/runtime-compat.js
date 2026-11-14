// Preserve existing launcher overrides when upgrading from the previous name
export function applyLegacyEnvironment(environment = process.env) {
  const legacyPrefix = 'LENSSORT_'
  for (const key of Object.keys(environment)) {
    if (key.startsWith(legacyPrefix)) {
      const currentKey = 'PHOTOSORT_' + key.slice(legacyPrefix.length)
      if (environment[currentKey] === undefined) environment[currentKey] = environment[key]
    }
  }
}
applyLegacyEnvironment()
