import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { createControlServer } from './control-server.js'

const workspace = await mkdtemp(path.resolve('artifacts/photo-navigation-'))
const server = await createControlServer({ root: process.cwd(), controlDir: path.join(workspace, 'control'), port: 0 })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { passed: false, checks: [], errors: [] }
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, hasTouch: true })
  page.on('pageerror', error => report.errors.push(error.message))
  const status = await (await fetch(server.origin + '/api/status')).json()
  const records = Array.from({ length: 65 }, (_, i) => ({ id: String(i), name: `photo-${String(i).padStart(2, '0')}.jpg`, status: 'done', category: i % 2 ? '动物' : '风景', favorite: i < 2, explanation: `说明 ${i}` }))
  records.splice(3, 0, { id: 'failed', name: 'unreadable.jpg', status: 'failed', category: '风景', favorite: false })
  const image = await sharp({ create: { width: 160, height: 120, channels: 3, background: '#77aa88' } }).jpeg().toBuffer()
  await page.route('**/api/status', route => route.fulfill({ json: { ...status, records } }))
  await page.route('**/api/photo/*', async route => {
    const record = records.find(item => item.id === route.request().url().split('/').pop())
    if (record?.id === '1') await new Promise(resolve => setTimeout(resolve, 350))
    await route.fulfill({ json: record }).catch(() => {})
  })
  for (const endpoint of ['thumbnail', 'photo-image']) await page.route(`**/api/${endpoint}/*`, route => route.fulfill({ body: image, contentType: 'image/jpeg' }))
  await page.goto(server.origin)
  const cards = page.locator('.control-photo-open')
  await cards.first().click()
  const modal = page.getByRole('dialog')
  await modal.getByRole('button', { name: '下一张照片', exact: true }).waitFor({ timeout: 3000 })
  assert.equal(await modal.getByRole('button', { name: '上一张照片', exact: true }).isDisabled(), true)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await modal.getByRole('heading', { name: records[2].name, exact: true }).waitFor()
  await page.waitForTimeout(450)
  assert.equal(await modal.getByRole('heading', { name: records[2].name, exact: true }).count(), 1)
  await page.keyboard.press('ArrowRight')
  await modal.getByRole('heading', { name: 'photo-03.jpg', exact: true }).waitFor()
  await page.keyboard.press('ArrowLeft')
  await modal.getByRole('heading', { name: records[2].name, exact: true }).waitFor()
  await modal.getByLabel('修改照片分类').focus()
  await page.keyboard.press('ArrowLeft')
  assert.equal(await modal.getByRole('heading', { name: records[2].name, exact: true }).count(), 1)
  await modal.getByRole('button', { name: '上一张照片', exact: true }).click()
  await modal.getByRole('heading', { name: records[1].name, exact: true }).waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await cards.first().evaluate(element => element === document.activeElement), true)
  report.checks.push('buttons and keyboard navigate; select arrows are preserved; late responses cannot replace current photo; Escape restores focus')
  await cards.last().click()
  await modal.getByRole('button', { name: '下一张照片', exact: true }).click()
  await modal.getByRole('heading', { name: 'photo-59.jpg', exact: true }).waitFor()
  assert.match(await page.locator('.photo-pagination-current').textContent(), /第 2/)
  await page.keyboard.press('Escape')
  await page.getByRole('navigation', { name: '分类筛选' }).getByRole('button', { name: /^收藏/ }).click()
  await cards.first().click()
  await modal.getByRole('button', { name: '下一张照片', exact: true }).click()
  assert.equal(await modal.getByRole('button', { name: '下一张照片', exact: true }).isDisabled(), true)
  report.checks.push('navigation crosses page boundaries and stays within the active favorite filter')
  await page.setViewportSize({ width: 390, height: 844 })
  const stage = modal.locator('.photo-modal-image')
  await stage.evaluate(element => {
    const start = new Touch({ identifier: 1, target: element, clientX: 80, clientY: 150 })
    const end = new Touch({ identifier: 1, target: element, clientX: 220, clientY: 152 })
    element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start] }))
    element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [end] }))
  })
  await modal.getByRole('heading', { name: records[0].name, exact: true }).waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: path.join(workspace, 'mobile.png') })
  report.checks.push('horizontal touch swipe navigates and mobile has no horizontal overflow')
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) { report.error = error.stack; process.exitCode = 1 }
finally {
  await browser.close()
  await server.close()
  await writeFile(path.join(workspace, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ workspace, ...report }, null, 2))
}
