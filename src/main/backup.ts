import { app } from 'electron'
import COS from 'cos-nodejs-sdk-v5'
import { copyFileSync, createReadStream, existsSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, getDb, paths } from './store/db'
import { listLocalImages } from './store/images'
import { getCredentials, getSettings, isCosConfigured } from './store/settings'
import type { BoardStore } from './store/board'
import type { BackupState, RestorePoint } from '@shared/types'

const SNAPSHOT_RETENTION = 10
const DEBOUNCE_MS = 30_000

type Listener = (state: BackupState) => void

interface CosObjectEntry {
  Key: string
  Size: string
  LastModified: string
}

function promisify<T>(fn: (callback: (error: Error | null, data: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((error, data) => {
      if (error) reject(error)
      else resolve(data)
    })
  })
}

export class BackupService {
  private state: BackupState = { status: 'idle' }
  private timer: NodeJS.Timeout | null = null
  private running = false
  private listeners = new Set<Listener>()

  constructor(private readonly store: BoardStore) {}

  onState(listener: Listener): void {
    this.listeners.add(listener)
  }

  getState(): BackupState {
    if (!isCosConfigured()) return { status: 'disabled' }
    return this.state
  }

  private setState(next: BackupState): BackupState {
    this.state = next
    for (const listener of this.listeners) listener(next)
    return next
  }

  private client(): COS | null {
    const credentials = getCredentials()
    if (!credentials) return null
    return new COS({ SecretId: credentials.secretId, SecretKey: credentials.secretKey })
  }

  private target() {
    const { cos } = getSettings()
    const prefix = cos.prefix.replace(/^\/+|\/+$/g, '')
    return {
      Bucket: cos.bucket,
      Region: cos.region,
      prefix: prefix ? `${prefix}/` : ''
    }
  }

  schedule(): void {
    if (!isCosConfigured()) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.runNow()
    }, DEBOUNCE_MS)
  }

  async runNow(): Promise<BackupState> {
    if (this.running) return this.state
    if (!isCosConfigured()) return this.setState({ status: 'disabled' })
    const cos = this.client()
    if (!cos) return this.setState({ status: 'disabled' })

    this.running = true
    this.setState({ status: 'syncing' })
    try {
      const target = this.target()
      const snapshot = await this.uploadSnapshot(cos, target)
      const uploaded = await this.uploadImages(cos, target)
      await this.pruneSnapshots(cos, target)
      return this.setState({ status: 'ok', at: Date.now(), uploadedImages: uploaded, message: snapshot })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.setState({ status: 'error', message, at: Date.now() })
    } finally {
      this.running = false
    }
  }

  private async uploadSnapshot(
    cos: COS,
    target: { Bucket: string; Region: string; prefix: string }
  ): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const file = join(tmpdir(), `jot-snapshot-${stamp}.sqlite`)
    this.store.vacuumInto(file)
    const key = `${target.prefix}db/jot-${stamp}.sqlite`
    try {
      await promisify<unknown>((callback) =>
        cos.putObject(
          {
            Bucket: target.Bucket,
            Region: target.Region,
            Key: key,
            Body: createReadStream(file),
            ContentLength: statSync(file).size
          },
          callback as never
        )
      )
    } finally {
      try {
        unlinkSync(file)
      } catch {
        /* 临时文件清理失败不影响结果 */
      }
    }
    return key
  }

  private async uploadImages(cos: COS, target: { Bucket: string; Region: string; prefix: string }): Promise<number> {
    const db = getDb()
    const synced = new Set(
      (db.prepare('SELECT key FROM backup_objects WHERE at > 0').all() as unknown as Array<{ key: string }>).map(
        (row) => row.key
      )
    )
    const pending = listLocalImages().filter((image) => !synced.has(`images/${image.id}`))
    let uploaded = 0
    const concurrency = 3
    let cursor = 0

    const worker = async (): Promise<void> => {
      while (cursor < pending.length) {
        const image = pending[cursor++]
        const key = `${target.prefix}images/${image.id}`
        await promisify<unknown>((callback) =>
          cos.putObject(
            {
              Bucket: target.Bucket,
              Region: target.Region,
              Key: key,
              Body: createReadStream(join(paths().images, image.id)),
              ContentLength: image.size
            },
            callback as never
          )
        )
        db.prepare('UPDATE backup_objects SET at = ? WHERE key = ?').run(Date.now(), `images/${image.id}`)
        uploaded += 1
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker))
    return uploaded
  }

  private async pruneSnapshots(cos: COS, target: { Bucket: string; Region: string; prefix: string }): Promise<void> {
    const entries = await this.listSnapshots(cos, target)
    const stale = entries.slice(0, Math.max(0, entries.length - SNAPSHOT_RETENTION))
    for (const entry of stale) {
      await promisify<unknown>((callback) =>
        cos.deleteObject(
          { Bucket: target.Bucket, Region: target.Region, Key: entry.Key },
          callback as never
        )
      )
    }
  }

  private async listSnapshots(
    cos: COS,
    target: { Bucket: string; Region: string; prefix: string }
  ): Promise<CosObjectEntry[]> {
    const data = await promisify<{ Contents?: CosObjectEntry[] }>((callback) =>
      cos.getBucket(
        { Bucket: target.Bucket, Region: target.Region, Prefix: `${target.prefix}db/`, MaxKeys: 100 },
        callback as never
      )
    )
    // 按时间倒序：最新在前
    return (data.Contents ?? []).sort(
      (a, b) => new Date(b.LastModified).getTime() - new Date(a.LastModified).getTime()
    )
  }

  async listRestorePoints(): Promise<RestorePoint[]> {
    if (!isCosConfigured()) return []
    const cos = this.client()
    if (!cos) return []
    const entries = await this.listSnapshots(cos, this.target())
    return entries.map((entry) => ({
      key: entry.Key,
      size: Number(entry.Size) || 0,
      lastModified: entry.LastModified
    }))
  }

  /** 从云端快照恢复：下载到临时文件 → 校验 → 覆盖本地库 → 重启应用 */
  async restore(key: string): Promise<{ ok: boolean; message: string }> {
    if (!isCosConfigured()) return { ok: false, message: '未配置 COS' }
    const cos = this.client()
    if (!cos) return { ok: false, message: '未找到 COS 凭据' }
    const target = this.target()
    const temp = join(tmpdir(), `jot-restore-${Date.now()}.sqlite`)
    try {
      await promisify<unknown>((callback) =>
        cos.getObject(
          { Bucket: target.Bucket, Region: target.Region, Key: key, Output: temp as never },
          callback as never
        )
      )
      const header = readFileSync(temp).subarray(0, 15).toString('ascii')
      if (header !== 'SQLite format 3') {
        return { ok: false, message: '快照文件不是有效的 SQLite 数据库' }
      }
      closeDatabase()
      const dbPath = paths().dbFile
      if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`)
      if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`)
      copyFileSync(temp, dbPath)
      // 先让 IPC 回包送到渲染进程，再重启；否则界面会误报失败
      setTimeout(() => {
        app.relaunch()
        app.exit(0)
      }, 600)
      return { ok: true, message: '已恢复，应用即将重启' }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    } finally {
      try {
        unlinkSync(temp)
      } catch {
        /* ignore */
      }
    }
  }
}
