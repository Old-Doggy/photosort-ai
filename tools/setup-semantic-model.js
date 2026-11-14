import { readFile, writeFile } from 'node:fs/promises'
import { installAsset } from './asset-install.js'
import { semanticAssets } from './semantic-assets.js'
import { projectRoot } from './runtime-paths.js'

const repair = process.argv.includes('--repair')
const tokenizerConfig = JSON.parse(await readFile(new URL('./siglip2-tokenizer-config.json', import.meta.url), 'utf8'))
for (const asset of semanticAssets) {
  try { console.log(JSON.stringify(await installAsset(projectRoot, asset, { repair, timeoutMs: 900000 }))) }
  catch (error) { console.error(JSON.stringify({ id: asset.id, path: asset.path, status: 'failed', error: error.message })); process.exitCode = 1; break }
}
if (!process.exitCode) {
  const target = 'public/models/onnx-community/siglip2-base-patch16-224-ONNX/tokenizer_config.json'
  await writeFile(new URL('../' + target, import.meta.url), JSON.stringify(tokenizerConfig, null, 2) + '\n')
  console.log(JSON.stringify({ status: 'passed', tokenizerConfig: target, note: 'SigLIP2 is optional; without it the app falls back to CLIP scene signals.' }))
}
