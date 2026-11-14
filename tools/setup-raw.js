import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const python = process.env.LENSSORT_RAW_PYTHON || 'python'
const result = spawnSync(python, ['-m', 'pip', 'install', '-r', path.join(root, 'requirements-raw.txt')], { stdio: 'inherit', windowsHide: true })
if (result.error) console.error(result.error.message)
if (result.status !== 0) process.exitCode = result.status || 1
