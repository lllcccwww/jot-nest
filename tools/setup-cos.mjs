/**
 * 把真实可用的 COS 配置写进应用，并上传自动更新源。
 *
 * - 上传 release/latest.yml、安装包、blockmap 到 <prefix>/updates/，对象 ACL = public-read
 * - 匿名校验 latest.yml 与安装包可下载
 * - 启动真实用户数据目录的应用，写入 COS 袋配置 + 更新源，并跑一次真实备份
 *
 * 用法（凭据通过 WSLENV 透传）：
 *   JOT_COS_SECRET_ID=... JOT_COS_SECRET_KEY=... JOT_COS_BUCKET=... node tools/setup-cos.mjs
 */
import { _electron as electron } from 'playwright-core'
import COS from 'cos-nodejs-sdk-v5'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RELEASE = join(ROOT, 'release')
const PREFIX = 'jot'
const UPDATES_PREFIX = 'updates'

const SecretId = process.env.JOT_COS_SECRET_ID
const SecretKey = process.env.JOT_COS_SECRET_KEY
const Bucket = process.env.JOT_COS_BUCKET
const Region = process.env.JOT_COS_REGION ?? 'ap-guangzhou'

if (!SecretId || !SecretKey || !Bucket) {
  console.error('缺少 JOT_COS_SECRET_ID / JOT_COS_SECRET_KEY / JOT_COS_BUCKET')
  process.exit(2)
}

const cos = new COS({ SecretId, SecretKey })
const call = (method, params) =>
  new Promise((resolve, reject) => cos[method](params, (error, data) => (error ? reject(error) : resolve(data))))

const host = `https://${Bucket}.cos.${Region}.myqcloud.com`
const failures = []
const check = (name, ok, detail = '') => {
  console.log(ok ? `• PASS ${name}` : `✗ FAIL ${name} ${detail}`)
  if (!ok) failures.push(name)
}

/* ---------------- 1. 上传自动更新源 ---------------- */
const artifacts = ['latest.yml', 'Jot-Setup-0.1.0.exe', 'Jot-Setup-0.1.0.exe.blockmap']
for (const name of artifacts) {
  const file = join(RELEASE, name)
  const size = statSync(file).size
  const started = Date.now()
  await call('putObject', {
    Bucket,
    Region,
    Key: `${UPDATES_PREFIX}/${name}`,
    Body: createReadStream(file),
    ContentLength: size,
    ACL: 'public-read',
    ContentType: name.endsWith('.yml') ? 'text/yaml; charset=utf-8' : 'application/octet-stream'
  })
  console.log(`  上传 ${name}（${(size / 1024 / 1024).toFixed(1)}MB，${((Date.now() - started) / 1000).toFixed(1)}s）`)
}

/* ---------------- 2. 匿名可访问性检查 ---------------- */
const ymlResponse = await fetch(`${host}/${UPDATES_PREFIX}/latest.yml`)
check('latest.yml 匿名可读', ymlResponse.ok, `HTTP ${ymlResponse.status}`)
const ymlText = ymlResponse.ok ? await ymlResponse.text() : ''
check('latest.yml 内容指向无空格文件名', ymlText.includes('path: Jot-Setup-0.1.0.exe'))

const headResponse = await fetch(`${host}/${UPDATES_PREFIX}/Jot-Setup-0.1.0.exe`, {
  headers: { Range: 'bytes=0-1023' }
})
check('安装包匿名可下载（支持 Range）', headResponse.status === 206 || headResponse.status === 200, `HTTP ${headResponse.status}`)

/* ---------------- 3. 写入真实应用配置 ---------------- */
const app = await electron.launch({
  executablePath: join(ROOT, 'node_modules/electron/dist/electron.exe'),
  args: [ROOT]
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
  async (payload) =>
    window.jot.settings.patch({
      cos: payload.cos,
      updateFeedUrl: payload.feed,
      autoUpdate: true
    }),
  {
    cos: { bucket: Bucket, region: Region, prefix: PREFIX, secretId: SecretId, secretKey: SecretKey },
    feed: `${host}/${UPDATES_PREFIX}/`
  }
)
check('应用内已写入 COS 配置', settings.cos.hasCredential && settings.cos.bucket === Bucket)
check('应用内已写入更新源', settings.updateFeedUrl === `${host}/${UPDATES_PREFIX}/`, settings.updateFeedUrl)

const backup = await main.evaluate(() => window.jot.backup.now())
check('真实数据目录首次备份成功', backup.status === 'ok', JSON.stringify(backup))
console.log('  备份结果：', JSON.stringify(backup))

const info = await main.evaluate(() => window.jot.app.info())
console.log('  数据目录：', info.dataDir)

await app.evaluate(async ({ app: electronApp }) => electronApp.exit(0))
await new Promise((r) => setTimeout(r, 800))

/* ---------------- 4. 汇总桶内布局 ---------------- */
const listed = await call('getBucket', { Bucket, Region, Prefix: '' })
const keys = (listed.Contents ?? []).map((item) => item.Key).sort()
console.log('\n桶内对象：')
for (const key of keys) console.log('  -', key)

const settingsFile = join(info.dataDir, 'settings.json')
const raw = JSON.parse(readFileSync(settingsFile, 'utf8'))
check('settings.json 中密钥为密文', Boolean(raw.cos.secretKey) && !raw.cos.secretKey.includes(SecretKey))

if (failures.length > 0) {
  console.log('\n失败项：', failures.join(', '))
  process.exit(1)
}
console.log('\n配置与更新源就绪：', `${host}/${UPDATES_PREFIX}/`)
