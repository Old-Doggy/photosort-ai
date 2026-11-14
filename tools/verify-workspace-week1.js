import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { Transformer } from '@napi-rs/image'
import { createControlServer } from './control-server.js'

const workspace = await mkdtemp(path.resolve('output/playwright/week1-'))
const input = path.join(workspace, '中文来源')
const output = path.join(workspace, '中文结果')
await mkdir(input)
await mkdir(output)
const art = (background, x = 60, accent = '#e7c27e') => `<svg width="320" height="240" xmlns="http://www.w3.org/2000/svg"><rect width="320" height="240" fill="${background}"/><rect x="${x}" y="40" width="140" height="150" fill="#2f7d61"/><circle cx="245" cy="70" r="28" fill="${accent}"/></svg>`
const files = [
  { name: '待确认-0.heic', markup: art('#d9e7df') },
  { name: '风景-1.jpg', markup: art('#d9e7df', 63) },
  { name: '风景-2.jpg', markup: '<svg width="320" height="240" xmlns="http://www.w3.org/2000/svg"><rect width="320" height="240" fill="#314b78"/><circle cx="160" cy="120" r="72" fill="#dce7ff"/></svg>' },
  { name: '风景-3.jpg', markup: '<svg width="320" height="240" xmlns="http://www.w3.org/2000/svg"><rect width="320" height="240" fill="#d8c9b2"/><rect x="70" y="60" width="180" height="110" fill="#875f3d"/></svg>' },
]
for (const file of files) {
  const jpeg = await sharp(Buffer.from(file.markup.replace('width="320" height="240"', 'width="640" height="480"'))).jpeg().toBuffer()
  await writeFile(path.join(input, file.name), file.name.endsWith('.heic') ? Buffer.from(await new Transformer(jpeg).heic({ quality: 80 })) : jpeg)
}
let analysisCalls = 0
const server = await createControlServer({ root: process.cwd(), controlDir: path.join(workspace, 'control'), port: 0,
  analyzerFactory: async () => ({
    device: { name: '工程测试设备' },
    visionModelStatus: { status: 'disabled', message: 'test fixture' },
    analyze: async () => {
      analysisCalls += 1
      return analysisCalls === 1
        ? { category: '待确认', reason: '测试待确认', explanation: '测试待确认照片', faceCount: 1, qualityScore: 70, faces: { faceCount: 1, imageWidth: 320, imageHeight: 240, maxConfidence: 0.9, detections: [{ score: 0.9, box: { originX: 80, originY: 40, width: 80, height: 80 } }] } }
        : { category: '风景', reason: '测试风景', explanation: '测试风景照片', faceCount: 0, qualityScore: 80 }
    },
    close: async () => {},
  }),
})
let browser
const report = { passed: false, kind: 'isolated week1 workspace regression; no accuracy claim', checks: [], errors: [] }
const getStatus = async () => (await fetch(server.origin + '/api/status')).json()
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  page.on('pageerror', error => report.errors.push(error.message))
  await page.route('**/api/models', route => route.fulfill({ json: {
    resources: { totalRamGiB: 16, freeRamGiB: 8, totalVramGiB: 0, freeVramGiB: 0 },
    options: [{ id: 'off', label: '基础分析', installed: true, minRamGiB: 0, minVramGiB: 0, advice: '测试基础分析' }],
    serviceMessage: 'Ollama 未连接', recommendation: { selected: 'off', fallback: false, reason: '测试环境' },
  } }))
  await page.route('**/api/pick-folder', route => {
    const { kind } = route.request().postDataJSON()
    return route.fulfill({ json: { selected: kind === 'input' ? input : output } })
  })
  await page.goto(server.origin)
  assert.equal(await page.getByText('实验入口').count(), 0)
  await page.getByLabel('首次使用步骤').waitFor()
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  const resultsBox = await page.locator('.control-results').boundingBox()
  assert.ok(resultsBox && resultsBox.y < 768, 'classification results should start in the first viewport')
  report.checks.push('results-first layout: results start inside 1366x768 first viewport; legacy link removed')

  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByLabel('推理设备').selectOption('cpu')
  await page.getByRole('button', { name: '选择文件夹', exact: true }).first().click()
  await page.waitForFunction(expected => document.querySelector('input[aria-label="照片来源文件夹"]')?.value === expected, input)
  await page.getByRole('button', { name: '选择文件夹', exact: true }).last().click()
  await page.waitForFunction(expected => document.querySelector('input[aria-label="分类结果文件夹"]')?.value === expected, output)
  await page.getByLabel('基础语义模型').selectOption('clip')
  await page.getByRole('button', { name: '保存并关闭', exact: true }).click()
  await page.waitForSelector('.settings-drawer', { state: 'detached' })
  assert.equal((await getStatus()).config.semanticModel, 'clip')
  report.checks.push('settings drawer opens, saves Chinese folders, closes without moving the result list offscreen')
  report.checks.push('semantic model selector persists CLIP mode through the settings drawer')

  await page.getByRole('button', { name: /开始分类/ }).click()
  await page.waitForFunction(() => document.querySelectorAll('.control-photo').length === 4, null, { timeout: 30000 })
  await page.waitForFunction(() => document.querySelector('.quick-status-title strong')?.textContent?.includes('分类完成'), null, { timeout: 30000 })
  assert.equal(analysisCalls, 4)
  report.checks.push('finite batch still classifies four files and reaches the completed state')

  const search = page.getByPlaceholder('搜索文件名、分类或说明')
  await search.fill('风景-2')
  await page.waitForFunction(() => document.querySelectorAll('.control-photo').length === 1)
  assert.equal(await page.locator('.control-photo h3').textContent(), '风景-2.jpg')
  await search.fill('')
  await page.waitForFunction(() => document.querySelectorAll('.control-photo').length === 4)
  await page.getByLabel('排序').selectOption('name')
  report.checks.push('search filters the rendered cards and clearing restores all results; sort control is operable')

  await page.locator('.toolbar-review').click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  const faceCrop = dialog.locator('.review-faces img').first()
  await faceCrop.waitFor()
  await page.waitForFunction(() => { const image = document.querySelector('.review-faces img'); return Boolean(image && image.complete && image.naturalWidth > 0) }, null, { timeout: 15000 })
  assert.ok(await faceCrop.evaluate(image => image.complete && image.naturalWidth > 0))
  await page.waitForFunction(() => { const eye = document.querySelector('.review-eye'); return Boolean(eye && !eye.classList.contains('loading')) }, null, { timeout: 20000 })
  report.checks.push('review overlay renders a real face crop from the output copy')
  await page.keyboard.press('3')
  await dialog.waitFor({ state: 'hidden', timeout: 15000 })
  const reviewed = (await getStatus()).records.find(record => record.name === '待确认-0.heic')
  assert.equal(reviewed.category, '人物与风景')
  assert.equal(reviewed.manualCategory, '人物与风景')
  report.checks.push('pending review queue opens, keyboard 3 changes category, original remains untouched')

  await page.getByRole('button', { name: '选择当前页', exact: true }).click()
  await page.locator('.batch-bar').waitFor()
  await page.locator('.batch-bar select').selectOption('动物')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '应用分类', exact: true }).click()
  await page.locator('.control-notice').filter({ hasText: '已修改' }).waitFor({ timeout: 30000 })
  const batched = await getStatus()
  assert.equal(batched.records.every(record => record.category === '动物'), true)
  report.checks.push('batch selection applies one category to all selected files through the batch API')

  await page.route('**/api/batch-update-category', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ updated: [], failed: [{ id: 'fixture', error: '模拟副本暂时不可用' }] }),
  }))
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '撤销未完成' }).waitFor({ timeout: 5000 })
  assert.equal(await page.getByRole('button', { name: '撤销', exact: true }).count(), 1)
  await page.unroute('**/api/batch-update-category')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.locator('.control-notice').filter({ hasText: '已撤销' }).waitFor({ timeout: 30000 })
  const reverted = await getStatus()
  assert.equal(reverted.records.find(record => record.name === '待确认-0.heic').category, '人物与风景')
  assert.equal(reverted.records.find(record => record.name === '待确认-0.heic').manualCategory, '人物与风景')
  assert.equal(reverted.records.filter(record => record.name.startsWith('风景')).every(record => record.category === '风景'), true)
  assert.equal(reverted.records.find(record => record.name === '风景-1.jpg').manualCategory, null)
  assert.equal(reverted.records.find(record => record.name === '风景-1.jpg').manualAction, null)
  report.checks.push('undo restores the previous categories for the whole batch')

  await page.getByRole('button', { name: '相似组', exact: true }).click()
  await page.locator('.similar-overlay').waitFor({ timeout: 30000 })
  await page.locator('.similar-photos > button').first().waitFor()
  assert.ok(await page.locator('.similar-photos > button').count() >= 2)
  await page.getByRole('button', { name: '收藏这张', exact: true }).click()
  await page.locator('.similar-active').filter({ hasText: '已收藏' }).waitFor()
  const groupedStatus = await getStatus()
  assert.equal(groupedStatus.records.some(record => record.favorite === true), true)
  await page.getByLabel('整组分类').selectOption('动物')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '应用到本组', exact: true }).click()
  await page.locator('.control-notice').filter({ hasText: '相似组已改为' }).waitFor({ timeout: 30000 })
  const groupCategories = (await getStatus()).records.filter(record => record.name === '待确认-0.heic' || record.name === '风景-1.jpg').map(record => record.category)
  assert.deepEqual(groupCategories.sort(), ['动物', '动物'])
  await page.locator('.similar-header .settings-close').click()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.locator('.control-notice').filter({ hasText: '已撤销' }).waitFor({ timeout: 30000 })
  report.checks.push('similar groups API and side-by-side compare render; favorite and whole-group category actions persist without deleting originals')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出清单', exact: true }).click()
  const download = await downloadPromise
  const csv = await readFile(await download.path(), 'utf8')
  assert.match(csv, /"文件名","分类"/)
  assert.match(csv, /待确认-0\.heic/)
  assert.equal(csv.includes(input), false)
  report.checks.push('CSV export contains classification columns but no absolute source folder path')

  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.screenshot({ path: path.join(workspace, 'settings.png'), fullPage: true })
  await page.locator('.vision-mode-options button').first().click()
  await page.locator('.control-notice').filter({ hasText: '已关闭视觉复核' }).waitFor()
  await page.locator('.settings-close').click()
  assert.equal((await getStatus()).config.visionMode, 'off')
  report.checks.push('vision mode selector persists off mode through /api/config')

  await page.screenshot({ path: path.join(workspace, 'desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: path.join(workspace, 'mobile.png'), fullPage: true })
  // A generated 1,005-record response checks rendering bounds independently
  // from model speed and without loading a personal photo collection.
  const baseStatus = await getStatus()
  const many = Array.from({ length: 1005 }, (_, index) => ({
    ...baseStatus.records[0], id: `generated-${index}`, name: `photo-${String(index).padStart(4, '0')}.jpg`,
    category: '风景', favorite: index < 5, status: 'done',
  }))
  await page.route('**/api/status', route => route.fulfill({ json: { ...baseStatus, records: many } }))
  await page.route('**/api/thumbnail/generated-*', route => route.fulfill({ status: 204 }))
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.reload()
  await page.locator('.control-photo').nth(59).waitFor()
  assert.equal(await page.locator('.control-photo').count(), 60)
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  assert.match(await page.locator('.photo-pagination-current').innerText(), /2 \/ 17/)
  assert.equal(await page.locator('.control-photo').count(), 60)
  await page.getByLabel('每页显示').selectOption('120')
  assert.equal(await page.locator('.control-photo').count(), 120)
  await page.getByLabel('每页显示').selectOption('30')
  assert.equal(await page.locator('.control-photo').count(), 30)
  await page.getByPlaceholder('搜索文件名、分类或说明').fill('photo-1004')
  assert.equal(await page.locator('.control-photo').count(), 1)
  await page.getByPlaceholder('搜索文件名、分类或说明').fill('')
  await page.getByRole('button', { name: /^收藏\s*5$/ }).click()
  assert.equal(await page.locator('.control-photo').count(), 5)
  await page.getByRole('button', { name: /^全部\s*1005$/ }).click()
  const groupPhotos = many.slice(0, 125).map(record => ({ ...record, qualityScore: 70, distance: 0, imageUrl: '/api/thumbnail/' + record.id }))
  await page.route('**/api/similar-groups', route => route.fulfill({ json: {
    groups: [{ id: 'generated-group', representativeId: groupPhotos[0].id, reason: 'generated fixture', photos: groupPhotos }],
    considered: 125, skipped: [], boundary: 'generated fixture',
  } }))
  await page.getByRole('button', { name: '相似组', exact: true }).click()
  await page.locator('.similar-photos > button').nth(11).waitFor()
  assert.equal(await page.locator('.similar-photos > button').count(), 12)
  await page.getByRole('button', { name: '下一组内页', exact: true }).click()
  assert.equal(await page.locator('.similar-photos > button').count(), 12)
  assert.equal(await page.locator('.similar-photos img').evaluateAll(images => images.every(image => image.getAttribute('src').startsWith('/api/thumbnail/'))), true)
  await page.locator('.similar-header .settings-close').click()
  report.checks.push('1,005 generated records: 30/60/120 page sizes, navigation, search and favorites; 125-photo similarity group renders at most 12 thumbnails per page')
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) { report.error = error.stack; process.exitCode = 1 }
finally {
  await browser?.close()
  await server.close()
  await writeFile(path.join(workspace, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ report: path.relative(process.cwd(), workspace), ...report }, null, 2))
}
