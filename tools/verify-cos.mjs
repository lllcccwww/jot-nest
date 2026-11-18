/**
 * COS 备份链路真实验证：用真实桶跑一遍 上传 → 快照下载校验 → 恢复点列表。
 * 使用独立数据目录与独立前缀（jot-verify），结束后清理测试对象。
 *
 * 用法：node tools/verify-cos.mjs
 */
import { _electron as electron } from 'playwright-core'
import COS from 'cos-nodejs-sdk-v5'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, '.tmp', 'cos-data')
const PREFIX = 'jot-verify'
const REGION = 'ap-guangzhou'

const CREDS = {
  SecretId: process.env.JOT_COS_SECRET_ID ?? '',
  SecretKey: process.env.JOT_COS_SECRET_KEY ?? ''
}
const BUCKET_NAME = process.env.JOT_COS_BUCKET ?? ''

if (!CREDS.SecretId || !CREDS.SecretKey || !BUCKET_NAME) {
  console.error('缺少环境变量 JOT_COS_SECRET_ID / JOT_COS_SECRET_KEY / JOT_COS_BUCKET')
  process.exit(2)
}

rmSync(DATA, { recursive: true, force: true })
mkdirSync(DATA, { recursive: true })

const cos = new COS({ SecretId: CREDS.SecretId, SecretKey: CREDS.SecretKey })
const call = (method, params) =>
  new Promise((resolve, reject) => {
    cos[method](params, (error, data) => (error ? reject(error) : resolve(data)))
  })

const failures = []
const check = (name, ok, detail = '') => {
  console.log(ok ? `• PASS ${name}` : `✗ FAIL ${name} ${detail}`)
  if (!ok) failures.push(name)
}

/* ---------------- 1. 启动应用并写入 COS 配置 ---------------- */
const app = await electron.launch({
  executablePath: join(ROOT, 'node_modules/electron/dist/electron.exe'),
  args: [ROOT],
  env: { ...process.env, JOT_USER_DATA: DATA }
})
let main
for (let i = 0; i < 80; i += 1) {
  const pages = app.windows().filter((page) => page.url().includes('index.html'))
  if (pages.length) {
    main = pages[0]
    break
  }
  await new Promise((r) => setTimeout(r, 250))
}
await main.waitForSelector('.canvas')
await main.waitForTimeout(800)

const settings = await main.evaluate(
  async (payload) => window.jot.settings.patch({ cos: payload }),
  { bucket: BUCKET_NAME, region: REGION, prefix: PREFIX, secretId: CREDS.SecretId, secretKey: CREDS.SecretKey }
)
check('COS 配置已保存（密钥加密存储）', settings.cos.hasCredential === true)
check('渲染进程读不到明文密钥', !JSON.stringify(settings).includes('AKID'), JSON.stringify(settings.cos))

/* ---------------- 2. 造数据并备份 ---------------- */
const noteCount = await main.evaluate(async () => {
  const ids = []
  for (const text of ['备份验证一：会议纪要', '备份验证二：采购清单', '备份验证三：代码片段']) {
    const note = await window.jot.board.createNote({ kind: 'text', text, tags: ['验证'], x: 160 + ids.length * 360, y: 120 })
    ids.push(note.id)
  }
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 200
  const context = canvas.getContext('2d')
  context.fillStyle = '#2f6be0'
  context.fillRect(0, 0, 320, 200)
  const thumb = document.createElement('canvas')
  thumb.width = 320
  thumb.height = 200
  thumb.getContext('2d').drawImage(canvas, 0, 0)
  const saved = await window.jot.images.save({
    dataUrl: canvas.toDataURL('image/png'),
    thumbDataUrl: thumb.toDataURL('image/webp', 0.82),
    width: 320,
    height: 200
  })
  await window.jot.board.createNote({
    kind: 'image',
    text: '备份验证四：图片卡片',
    imageId: saved.id,
    imageW: saved.width,
    imageH: saved.height,
    tags: ['验证'],
    x: 160,
    y: 420
  })
  return (await window.jot.board.get()).notes.length
})
check('本地已创建 4 张卡片', noteCount === 4, String(noteCount))

const backupState = await main.evaluate(() => window.jot.backup.now())
console.log('备份状态：', JSON.stringify(backupState))
check('立即备份成功', backupState.status === 'ok', JSON.stringify(backupState))

const points = await main.evaluate(() => window.jot.backup.restorePoints())
check('恢复点列表非空', points.length >= 1, JSON.stringify(points))
console.log('恢复点：', points.map((p) => `${p.key} (${p.size}B)`).join(', '))

/* ---------------- 3. 直接在桶里核对对象 ---------------- */
const listed = await call('getBucket', { Bucket: BUCKET_NAME, Region: REGION, Prefix: `${PREFIX}/` })
const keys = (listed.Contents ?? []).map((item) => item.Key)
console.log('桶内对象：', keys.join(', '))
check('快照已上传', keys.some((key) => key.startsWith(`${PREFIX}/db/jot-`) && key.endsWith('.sqlite')))
check('图片已上传（按 sha256 命名）', keys.some((key) => new RegExp(`^${PREFIX}/images/[0-9a-f]{64}$`).test(key)))

/* ---------------- 4. 下载快照并校验内容 ---------------- */
const snapshotKey = keys
  .filter((key) => key.startsWith(`${PREFIX}/db/`))
  .sort()
  .pop()
const localSnapshot = join(ROOT, '.tmp', 'snapshot-download.sqlite')
await call('getObject', { Bucket: BUCKET_NAME, Region: REGION, Key: snapshotKey, Output: localSnapshot })
const db = new DatabaseSync(localSnapshot, { readOnly: true })
const rows = db.prepare('SELECT kind, text FROM notes WHERE deleted_at IS NULL').all()
db.close()
check('快照可打开且包含全部卡片', rows.length === 4, `实际 ${rows.length} 行`)
const texts = rows.map((row) => row.text).join('|')
check('快照内容与本地一致', texts.includes('备份验证一') && texts.includes('备份验证四'), texts.slice(0, 60))

/* ---------------- 5. 幂等性：再次备份不重传图片 ---------------- */
const second = await main.evaluate(() => window.jot.backup.now())
check('二次备份成功', second.status === 'ok', JSON.stringify(second))
check('图片不重复上传', second.uploadedImages === 0, `uploaded=${second.uploadedImages}`)

/* ---------------- 6. 清理测试对象 ---------------- */
await main.evaluate(async () => {
  await window.jot.settings.patch({ cos: { secretId: '', secretKey: '' } })
})
await app.evaluate(async ({ app: electronApp }) => electronApp.exit(0))
await new Promise((r) => setTimeout(r, 800))

for (let pass = 0; pass < 5; pass += 1) {
  const remaining = await call('getBucket', { Bucket: BUCKET_NAME, Region: REGION, Prefix: `${PREFIX}/` })
  const objects = (remaining.Contents ?? []).map((item) => item.Key)
  if (objects.length === 0) break
  for (const key of objects) {
    await call('deleteObject', { Bucket: BUCKET_NAME, Region: REGION, Key: key })
  }
}
const after = await call('getBucket', { Bucket: BUCKET_NAME, Region: REGION, Prefix: `${PREFIX}/` })
check('测试对象已清理', (after.Contents ?? []).length === 0, `${(after.Contents ?? []).length} 个残留`)

writeFileSync(join(ROOT, '.tmp', 'cos-verify-result.json'), JSON.stringify({ backupState, points, keys }, null, 2))

if (failures.length > 0) {
  console.log('\n失败项：', failures.join(', '))
  process.exit(1)
}
console.log('\nCOS 备份链路验证通过')
