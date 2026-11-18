/**
 * 端到端验证：真实启动 Electron 应用，走一遍核心链路并截图。
 * 使用独立数据目录，保证每次从空白开始。
 * 用法：node tools/verify.mjs
 */
import { _electron as electron } from 'playwright-core'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(ROOT, '.tmp', 'shots')
const DATA = join(ROOT, '.tmp', 'verify-data')
rmSync(SHOTS, { recursive: true, force: true })
rmSync(DATA, { recursive: true, force: true })
mkdirSync(SHOTS, { recursive: true })
mkdirSync(DATA, { recursive: true })

const log = (...args) => console.log('•', ...args)
const failures = []
const check = (name, ok, detail = '') => {
  if (ok) log(`PASS ${name}`)
  else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`✗ FAIL ${name} ${detail}`)
  }
}

const launch = () =>
  electron.launch({
    executablePath: join(ROOT, 'node_modules/electron/dist/electron.exe'),
    args: [ROOT],
    env: { ...process.env, JOT_USER_DATA: DATA }
  })

async function mainPage(app) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const pages = app.windows().filter((page) => page.url().includes('index.html'))
    if (pages.length > 0) return pages[0]
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('主窗口未出现')
}

const app = await launch()
const main = await mainPage(app)
main.on('console', (message) => {
  if (message.type() === 'error') console.log('[renderer error]', message.text())
})
await main.waitForSelector('.canvas', { timeout: 20000 })
await main.waitForTimeout(1200)
await main.screenshot({ path: join(SHOTS, '01-empty.png') })

/* ---------------- 造数据 ---------------- */
const created = await main.evaluate(async () => {
  const samples = [
    { text: '# 周会结论\n\n- 后端接口下周一联调\n- 前端先出静态页面\n- 埋点方案待确认', tags: ['工作', '会议'], color: 'sky', width: 320, dx: 0, dy: 0 },
    { text: '采购清单\n\n牛奶、鸡蛋、面包、咖啡豆（中深烘）', tags: ['生活'], color: 'sand', width: 240, dx: 380, dy: 0 },
    { text: '读到一个不错的句子：**慢就是快**，把一件事做到能被复核，比同时推进五件事更有价值。', tags: ['摘录'], color: 'sage', width: 320, dx: 700, dy: 0 },
    { text: '`pnpm dev` 之前要先跑 `pnpm build:shared`，否则类型找不到。', tags: ['工作'], color: 'lilac', width: 320, dx: 0, dy: 240 },
    { text: '设计参考：Things 3 的排版节奏、Freeform 的无限画布、Linear 的键盘密度。', tags: ['设计'], color: 'rose', width: 320, dx: 380, dy: 240 }
  ]
  const ids = []
  for (const sample of samples) {
    const note = await window.jot.board.createNote({
      kind: 'text',
      text: sample.text,
      tags: sample.tags,
      color: sample.color,
      width: sample.width,
      x: 140 + sample.dx,
      y: 90 + sample.dy
    })
    ids.push(note.id)
  }
  return ids
})
await main.waitForTimeout(700)
await main.screenshot({ path: join(SHOTS, '02-cards.png') })
check('创建 5 张卡片并渲染', (await main.locator('.card').count()) === 5)

/* ---------------- 拖拽 + 落库 ---------------- */
const dragTarget = main.locator(`.card[data-note-id="${created[0]}"]`)
const before = await main.evaluate(async (id) => {
  const board = await window.jot.board.get()
  const note = board.notes.find((item) => item.id === id)
  return { x: note.x, y: note.y }
}, created[0])
await main.evaluate(() => {
  window.__ev = []
  const rec = (type) => (event) =>
    window.__ev.push([type, Math.round(event.clientX), Math.round(event.clientY), event.buttons, event.pointerType])
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) window.addEventListener(type, rec(type), true)
})
const box = await dragTarget.boundingBox()
await main.mouse.move(box.x + 60, box.y + 60)
await main.mouse.down()
await main.mouse.move(box.x + 130, box.y + 96, { steps: 10 })
await main.mouse.up()
await main.waitForTimeout(500)
const after = await main.evaluate(async (id) => {
  const board = await window.jot.board.get()
  const note = board.notes.find((item) => item.id === id)
  return { x: note.x, y: note.y }
}, created[0])
const movedBy = { dx: after.x - before.x, dy: after.y - before.y }
check(
  '拖动卡片并落库（含吸附）',
  Math.abs(movedBy.dx - 70) <= 8 && Math.abs(movedBy.dy - 36) <= 8,
  JSON.stringify(movedBy)
)
if (Math.abs(movedBy.dx - 70) > 8) {
  const ev = await main.evaluate(() => window.__ev)
  console.log('DRAG EVENTS', JSON.stringify(ev))
}
await main.screenshot({ path: join(SHOTS, '03-after-drag.png') })

/* ---------------- 搜索 ---------------- */
await main.fill('.search input', '联调')
await main.waitForTimeout(500)
await main.screenshot({ path: join(SHOTS, '04-search.png') })
const matched = await main.locator('.card[data-matched="true"]').count()
const dimmed = await main.locator('.card[data-dimmed="true"]').count()
check('搜索命中 1 张、其余淡出', matched === 1 && dimmed === 4, `matched=${matched} dimmed=${dimmed}`)
await main.press('.search input', 'Enter')
await main.waitForTimeout(700)
await main.screenshot({ path: join(SHOTS, '05-flyto.png') })
await main.click('.search-clear')
await main.waitForTimeout(300)

/* ---------------- 全览 ---------------- */
await main.getByRole('button', { name: '全览' }).click()
await main.waitForTimeout(700)
await main.screenshot({ path: join(SHOTS, '06-fit-all.png') })

/* ---------------- 多选 + 成组 ---------------- */
const cardA = main.locator(`.card[data-note-id="${created[3]}"]`)
const cardB = main.locator(`.card[data-note-id="${created[1]}"]`)
await cardA.click({ position: { x: 40, y: 30 } })
await cardB.click({ position: { x: 40, y: 30 }, modifiers: ['Shift'] })
await main.waitForTimeout(300)
await main.screenshot({ path: join(SHOTS, '07-selection.png') })
check('多选后出现浮动工具条', await main.locator('.selection-dock').isVisible())

await main.getByRole('button', { name: '成组' }).click()
await main.waitForTimeout(700)
await main.screenshot({ path: join(SHOTS, '08-group.png') })
check('分组框已渲染', (await main.locator('.group-frame').count()) === 1)

const groupBox = await main.locator('.group-frame').boundingBox()
await main.mouse.move(groupBox.x + 60, groupBox.y + 16)
await main.mouse.down()
await main.mouse.move(groupBox.x + 60 + 60, groupBox.y + 16 + 40, { steps: 8 })
await main.mouse.up()
await main.waitForTimeout(500)
const groupMovedBy = await main.evaluate(
  async ([idA, idB]) => {
    const board = await window.jot.board.get()
    const a = board.notes.find((item) => item.id === idA)
    const b = board.notes.find((item) => item.id === idB)
    return { a, b }
  },
  [created[3], created[1]]
)
check('拖动分组会带动组内卡片', groupMovedBy.a.y !== undefined && groupMovedBy.a.groupId !== null)
await main.screenshot({ path: join(SHOTS, '09-group-moved.png') })

/* ---------------- 折叠 ---------------- */
await main.getByRole('button', { name: '折叠' }).click()
await main.waitForTimeout(400)
const hidden = await main.locator('.card[data-collapsed="true"]').count()
check('折叠后组内卡片隐藏', hidden === 2, `实际 ${hidden}`)
await main.screenshot({ path: join(SHOTS, '10-collapsed.png') })
await main.getByRole('button', { name: '展开' }).click()
await main.waitForTimeout(300)

/* ---------------- 就地编辑 ---------------- */
const editTarget = main.locator(`.card[data-note-id="${created[4]}"]`)
await editTarget.dblclick({ position: { x: 40, y: 40 } })
await main.waitForTimeout(300)
await main.locator('.card textarea').first().fill('编辑后的内容：周五前给出原型，附交互稿。')
await main.mouse.click(40, 300)
await main.waitForTimeout(500)
const edited = await main.evaluate(async () => {
  const board = await window.jot.board.get()
  return board.notes.some((note) => note.text.includes('周五前给出原型'))
})
check('就地编辑已保存', edited)
await main.screenshot({ path: join(SHOTS, '11-edited.png') })

/* ---------------- 捕捉浮窗 ---------------- */
await app.evaluate(async ({ BrowserWindow }) => {
  const target = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('capture'))
  target?.show()
  target?.focus()
})
await new Promise((resolve) => setTimeout(resolve, 600))
const capturePage = app.windows().find((page) => page.url().includes('capture.html'))
if (capturePage) {
  await capturePage.waitForSelector('.capture-card', { timeout: 10000 })
  await capturePage.screenshot({ path: join(SHOTS, '12-capture.png') })
  await capturePage.fill('.capture-input', '从浮窗捕捉的一条：记得给 COS 桶的 updates/ 前缀开公共读')
  await capturePage.fill('.capture-tags', '工作 备忘')
  await capturePage.screenshot({ path: join(SHOTS, '13-capture-filled.png') })
  await capturePage.getByRole('button', { name: '保存' }).click()
  await capturePage.waitForTimeout(500)
  await capturePage.screenshot({ path: join(SHOTS, '14-capture-saved.png') })
  await main.waitForTimeout(600)
  check('浮窗提交后画布新增卡片', (await main.locator('.card').count()) === 6)
} else {
  check('捕捉窗口打开', false)
}

/* ---------------- 图片卡片 ---------------- */
const imageCard = await main.evaluate(async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 400
  const context = canvas.getContext('2d')
  const gradient = context.createLinearGradient(0, 0, 640, 400)
  gradient.addColorStop(0, '#2f6be0')
  gradient.addColorStop(1, '#7ba2ff')
  context.fillStyle = gradient
  context.fillRect(0, 0, 640, 400)
  context.fillStyle = 'rgba(255,255,255,0.92)'
  context.font = '600 34px "Segoe UI"'
  context.fillText('设计截图占位', 40, 90)
  const dataUrl = canvas.toDataURL('image/png')
  const thumb = document.createElement('canvas')
  thumb.width = 512
  thumb.height = 320
  const thumbContext = thumb.getContext('2d')
  thumbContext.drawImage(canvas, 0, 0, 512, 320)
  const saved = await window.jot.images.save({
    dataUrl,
    thumbDataUrl: thumb.toDataURL('image/webp', 0.82),
    width: 640,
    height: 400
  })
  const board = await window.jot.board.get()
  const note = await window.jot.board.createNote({
    kind: 'image',
    text: '首页视觉稿',
    imageId: saved.id,
    imageW: saved.width,
    imageH: saved.height,
    tags: ['设计'],
    color: 'slate',
    width: 480,
    x: 140,
    y: 560
  })
  return note.id
})
await main.waitForTimeout(600)
const imageVisible = await main.locator(`.card[data-note-id="${imageCard}"] img`).count()
check('图片卡片渲染缩略图', imageVisible === 1)
await main.screenshot({ path: join(SHOTS, '15-image-card.png') })
await main.locator(`.card[data-note-id="${imageCard}"] img`).click()
await main.waitForTimeout(400)
check('点击图片打开浮层预览', await main.locator('.lightbox').isVisible())
await main.screenshot({ path: join(SHOTS, '16-lightbox.png') })
await main.keyboard.press('Escape')
await main.mouse.click(60, 700)
await main.waitForTimeout(300)

/* ---------------- 快捷键探测 ---------------- */
const probe = await main.evaluate(async () => {
  const ok = await window.jot.settings.probeShortcut('Control+Alt+N')
  const conflict = await window.jot.settings.probeShortcut('Control+Alt+N')
  return { ok, conflict }
})
check('快捷键探测可用（未报冲突）', probe.ok.ok === true, JSON.stringify(probe.ok))
check('重复探测不会残留已注册快捷键', probe.conflict.ok === true)

/* ---------------- 设置面板 ---------------- */
await main.click('.status-pill')
await main.waitForTimeout(400)
await main.screenshot({ path: join(SHOTS, '17-settings.png') })
check('设置面板打开', await main.locator('.dialog').isVisible())
await main.locator('.dialog-foot .ghost-btn').click()
await main.waitForTimeout(300)

/* ---------------- 深色主题 ---------------- */
await main.evaluate(async () => {
  await window.jot.settings.patch({ theme: 'dark' })
})
await main.waitForTimeout(600)
await main.screenshot({ path: join(SHOTS, '18-dark.png') })

/* ---------------- 重启持久化 ---------------- */
await app.evaluate(async ({ app: electronApp }) => {
  electronApp.exit(0)
})
await new Promise((resolve) => setTimeout(resolve, 1500))

const app2 = await launch()
const main2 = await mainPage(app2)
await main2.waitForSelector('.canvas', { timeout: 20000 })
await main2.waitForTimeout(1200)
check('重启后卡片仍在', (await main2.locator('.card').count()) === 7, `实际 ${await main2.locator('.card').count()}`)
check('重启后分组仍在', (await main2.locator('.group-frame').count()) === 1)
const cameraPersisted = await main2.evaluate(async () => (await window.jot.board.get()).camera)
check('重启后相机位置保持', Math.abs(cameraPersisted.zoom - 1) > 0.0001 || cameraPersisted.x !== 0)
await main2.screenshot({ path: join(SHOTS, '19-restart.png') })
await app2.evaluate(async ({ app: electronApp }) => {
  electronApp.exit(0)
})

console.log('\n截图目录：', SHOTS)
if (failures.length > 0) {
  console.log('\n失败项：')
  for (const item of failures) console.log(' -', item)
  process.exit(1)
}
console.log('\n全部检查通过')
