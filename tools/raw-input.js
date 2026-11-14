import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const rawExtensions = new Set(['.cr2', '.cr3', '.nef', '.arw', '.dng', '.orf', '.rw2', '.raf', '.pef'])
const decoder = path.join(path.dirname(fileURLToPath(import.meta.url)), 'raw-decoder.py')

export function isRawFileName(fileName) {
  return rawExtensions.has(path.extname(String(fileName ?? '')).toLowerCase())
}

export async function decodeRawBytes(bytes, { python = process.env.LENSSORT_RAW_PYTHON || 'python', timeoutMs = 120000 } = {}) {
  return await new Promise((resolve, reject) => {
    let settled = false
    let total = 0
    let timer
    const fail = error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }
    const child = spawn(python, [decoder], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks = []
    const errors = []
    timer = setTimeout(() => { child.kill(); fail(new Error('RAW 解码超时；可在设置中避开 RAW 或检查 rawpy')) }, timeoutMs)
    child.stdout.on('data', chunk => {
      total += chunk.length
      if (total > 64 * 1024 * 1024) { child.kill(); fail(new Error('RAW 解码输出超过 64 MiB，已拒绝')) }
      else chunks.push(chunk)
    })
    child.stderr.on('data', chunk => errors.push(chunk))
    child.stdin.on('error', error => fail(new Error(`RAW 解码器写入失败：${error.message}`)))
    child.on('error', error => fail(new Error(`RAW 解码器启动失败：${error.message}`)))
    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0 && chunks.length) resolve(Buffer.concat(chunks))
      else reject(new Error(Buffer.concat(errors).toString('utf8').trim() || `RAW 解码失败（退出码 ${code}）`))
    })
    try { child.stdin.end(bytes) } catch (error) { fail(new Error(`RAW 解码器写入失败：${error.message}`)) }
  })
}
