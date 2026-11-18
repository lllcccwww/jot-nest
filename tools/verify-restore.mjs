/**
 * 灾难恢复演练：备份 → 删光本地数据 → 从云端快照恢复 → 验证数据回来了。
 * 用独立数据目录与 jot-verify 前缀，结束后清理测试对象并杀掉重启出来的进程。
 *
 * 用法：node tools/verify-restore.mjs
 */
import { _electron as electron } from 'playwright-core'
import COS from 'cos-nodejs-sdk-v5'
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, '.tmp', 'restore-data')
const PREFIX = 'jot-verify'
const Region = process.env.JOT_COS_REGION ?? 'ap-guangzhou'
const SecretId = process.env.JOT_COS_SECRET_ID
const SecretKey = process.env.JOT_COS_SECRET_KEY
const Bucket = process.env.JOT_COS_BUCKET

if (!SecretId || !SecretKey || !Bucket) {
  console.error('缺少 JOT_COS_SECRET_ID / JOT_COS_SECRET_KEY / JOT_COS_BUCKET')
  process.exit(2)
}

const cos = new COS({ SecretId, SecretKey })
const call = (method, params) =>
  new Promise((resolve, reject) => cos[method](params, (error, data) => (error ? reject(error) : resolve(data))))

const failures = []
const check = (name, ok, detail = '') => {
  console.log(ok ? `• PASS ${name}` : `✗ FAIL ${name} ${detail}`)
  if (!ok) failures.push(name)
}

rmSync(DATA, { recursive: true, force: true })
mkdirSync(DATA, { recursive: true })

const app = await electron.launch({
  executablePath: join(ROOT, 'node_modules/electron/dist/electron.exe'),
  args: [ROOT, `--user-data=${DATA}`]
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

await main.evaluate(
  async (payload) => window.jot.settings.patch({ cos: payload }),
  { bucket: Bucket, region: Region, prefix: PREFIX, secretId: SecretId, secretKey: SecretKey }
)

const ids = await main.evaluate(async () => {
  const created = []
  for (const text of ['恢复演练 A：待办', '恢复演练 B：灵感']) {
    const note = await window.jot.board.createNote({ kind: 'text', text, tags: ['演练'], x: 200 + created.length * 380, y: 160 })
    created.push(note.id)
  }
  return created
})
check('创建 2 张卡片', ids.length === 2)

const backup = await main.evaluate(() => window.jot.backup.now())
check('备份成功', backup.status === 'ok', JSON.stringify(backup))
const points = await main.evaluate(() => window.jot.backup.restorePoints())
check('存在恢复点', points.length >= 1)
const key = points[0].key
console.log('  使用快照：', key)

// 抹掉本地数据，模拟"机器坏了/库损坏"
await main.evaluate(async (list) => window.jot.board.deleteNotes(list), ids)
const cleared = await main.evaluate(async () => (await window.jot.board.get()).notes.length)
check('本地数据已清空', cleared === 0, `剩 ${cleared}`)

const restore = await main.evaluate((snapshotKey) => window.jot.backup.restore(snapshotKey), key)
check('恢复调用返回成功', restore.ok === true, JSON.stringify(restore))

// 恢复后会 closeDatabase → 覆盖 db → app.relaunch() → app.exit(0)
await new Promise((r) => setTimeout(r, 6000))

const db = new DatabaseSync(join(DATA, 'jot.db'), { readOnly: true })
const rows = db.prepare('SELECT text FROM notes WHERE deleted_at IS NULL').all()
db.close()
check('恢复后本地库回到了 2 张卡片', rows.length === 2, `实际 ${rows.length}`)
check('恢复内容正确', rows.map((row) => row.text).join('|').includes('恢复演练 A'))

// 清理重启出来的进程（按启动参数定位，避免误杀其他 Electron 应用）
try {
  const script = `
    $targets = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
      Where-Object { $_.CommandLine -like '*restore-data*' }
    foreach ($t in $targets) { Stop-Process -Id $t.ProcessId -Force -ErrorAction SilentlyContinue }
    Write-Output ("killed=" + ($targets | Measure-Object).Count)
  `
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' })
  console.log('  清理重启进程：', out.trim())
} catch (error) {
  console.warn('  清理重启进程失败：', error.message)
}

// 清理桶内测试对象
for (let pass = 0; pass < 5; pass += 1) {
  const listed = await call('getBucket', { Bucket, Region, Prefix: `${PREFIX}/` })
  const keys = (listed.Contents ?? []).map((item) => item.Key)
  if (keys.length === 0) break
  for (const objectKey of keys) {
    await call('deleteObject', { Bucket, Region, Key: objectKey })
  }
}
const after = await call('getBucket', { Bucket, Region, Prefix: `${PREFIX}/` })
check('测试对象已清理', (after.Contents ?? []).length === 0)

if (failures.length > 0) {
  console.log('\n失败项：', failures.join(', '))
  process.exit(1)
}
console.log('\n恢复演练通过')
