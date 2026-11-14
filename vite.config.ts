import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { copyFile, cp, mkdir } from 'node:fs/promises'
import path from 'node:path'

const staticAssets = {
  name: 'lenssort-static-assets',
  async closeBundle() {
    const publicDir = path.resolve('public')
    const dist = path.resolve('dist')
    await mkdir(dist, { recursive: true })
    await copyFile(path.join(publicDir, 'favicon.svg'), path.join(dist, 'favicon.svg'))
    await copyFile(path.join(publicDir, 'icons.svg'), path.join(dist, 'icons.svg'))
    if (process.env.LENSSORT_STATIC_MODELS === '1') {
      await cp(path.join(publicDir, 'models'), path.join(dist, 'models'), { recursive: true })
    }
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), staticAssets],
  build: { copyPublicDir: false },
})
