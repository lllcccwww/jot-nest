import { useEffect, useState } from 'react'
import type { AppSettings, BackupState, RestorePoint, ShortcutProbeResult, ThemeMode } from '@shared/types'
import { acceleratorFromEvent, formatAccelerator } from '../lib/format'

interface SettingsDialogProps {
  settings: AppSettings
  backupState: BackupState
  onClose: () => void
  onSettingsChanged: (settings: AppSettings) => void
}

export function SettingsDialog({
  settings,
  backupState,
  onClose,
  onSettingsChanged
}: SettingsDialogProps): React.JSX.Element {
  const [cos, setCos] = useState({
    bucket: settings.cos.bucket,
    region: settings.cos.region,
    prefix: settings.cos.prefix,
    secretId: '',
    secretKey: ''
  })
  const [feedUrl, setFeedUrl] = useState(settings.updateFeedUrl)
  const [cosHint, setCosHint] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [recording, setRecording] = useState(false)
  const [hotkeyHint, setHotkeyHint] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [restorePoints, setRestorePoints] = useState<RestorePoint[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [appInfo, setAppInfo] = useState<{ version: string; dataDir: string; hotkey: string } | null>(null)

  useEffect(() => {
    void window.jot.app.info().then(setAppInfo)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !recording) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, recording])

  const patch = async (next: Parameters<typeof window.jot.settings.patch>[0]): Promise<void> => {
    const updated = await window.jot.settings.patch(next)
    onSettingsChanged(updated)
  }

  const saveCos = async (): Promise<void> => {
    setBusy(true)
    try {
      const payload: Parameters<typeof window.jot.settings.patch>[0] = {
        cos: { bucket: cos.bucket, region: cos.region, prefix: cos.prefix }
      }
      if (cos.secretId.trim()) payload.cos!.secretId = cos.secretId.trim()
      if (cos.secretKey.trim()) payload.cos!.secretKey = cos.secretKey.trim()
      await patch(payload)
      setCos({ ...cos, secretId: '', secretKey: '' })
      setCosHint({ tone: 'ok', text: '已保存，密钥以系统凭据加密存储' })
    } catch (error) {
      setCosHint({ tone: 'error', text: error instanceof Error ? error.message : '保存失败' })
    } finally {
      setBusy(false)
    }
  }

  const onRecordKey = async (event: React.KeyboardEvent): Promise<void> => {
    event.preventDefault()
    if (event.key === 'Escape') {
      setRecording(false)
      return
    }
    const accelerator = acceleratorFromEvent(event.nativeEvent)
    if (!accelerator) return
    const probe: ShortcutProbeResult = await window.jot.settings.probeShortcut(accelerator)
    if (!probe.ok) {
      setHotkeyHint({ tone: 'error', text: `无法注册：${probe.conflictWith ?? '未知冲突'}` })
      return
    }
    await window.jot.settings.setShortcut(accelerator)
    setHotkeyHint({ tone: 'ok', text: `已设为 ${formatAccelerator(accelerator)}` })
    setRecording(false)
    onSettingsChanged(await window.jot.settings.get())
  }

  const loadRestorePoints = async (): Promise<void> => {
    setBusy(true)
    try {
      setRestorePoints(await window.jot.backup.restorePoints())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label="设置">
        <div className="dialog-head">
          <div className="dialog-title">设置</div>
          <span style={{ flex: 1 }} />
          <button className="glass-btn" onClick={onClose} aria-label="关闭">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="dialog-body">
          <section className="section">
            <div className="section-title">外观</div>
            <div className="field">
              <div className="field-label">主题</div>
              <div className="field-control">
                <div className="segmented">
                  {(['light', 'dark', 'system'] as ThemeMode[]).map((mode) => (
                    <button
                      key={mode}
                      data-active={settings.theme === mode}
                      onClick={() => void patch({ theme: mode })}
                    >
                      {mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '跟随系统'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="section">
            <div className="section-title">捕捉</div>
            <div className="field">
              <div className="field-label">全局快捷键</div>
              <div className="field-control" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  className="hotkey-record"
                  data-recording={recording}
                  onClick={() => {
                    setRecording(true)
                    setHotkeyHint(null)
                  }}
                  onKeyDown={(event) => {
                    if (recording) void onRecordKey(event)
                  }}
                >
                  {recording ? '请按下组合键…' : formatAccelerator(settings.hotkey)}
                </button>
                {hotkeyHint && (
                  <span className="hint" data-tone={hotkeyHint.tone} style={{ margin: 0 }}>
                    {hotkeyHint.text}
                  </span>
                )}
              </div>
            </div>
            <div className="hint">需至少包含 Ctrl 或 Alt。注册时会实时检测是否被其他程序占用。</div>
            <div className="field" style={{ marginTop: 12 }}>
              <div className="field-label">开机自启</div>
              <div className="field-control">
                <button
                  className="switch"
                  data-on={settings.autoLaunch}
                  onClick={() => void patch({ autoLaunch: !settings.autoLaunch })}
                  aria-label="开机自启"
                />
              </div>
            </div>
          </section>

          <section className="section">
            <div className="section-title">腾讯云 COS 备份</div>
            <div className="field">
              <div className="field-label">存储桶</div>
              <div className="field-control">
                <input
                  className="text-input"
                  placeholder="example-1250000000"
                  value={cos.bucket}
                  onChange={(event) => setCos({ ...cos, bucket: event.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <div className="field-label">地域</div>
              <div className="field-control">
                <input
                  className="text-input"
                  placeholder="ap-guangzhou"
                  value={cos.region}
                  onChange={(event) => setCos({ ...cos, region: event.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <div className="field-label">路径前缀</div>
              <div className="field-control">
                <input
                  className="text-input"
                  placeholder="jot"
                  value={cos.prefix}
                  onChange={(event) => setCos({ ...cos, prefix: event.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <div className="field-label">SecretId</div>
              <div className="field-control">
                <input
                  className="text-input"
                  placeholder={settings.cos.hasCredential ? '已保存，留空则不修改' : 'AKID…'}
                  value={cos.secretId}
                  onChange={(event) => setCos({ ...cos, secretId: event.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <div className="field-label">SecretKey</div>
              <div className="field-control">
                <input
                  className="text-input"
                  type="password"
                  placeholder={settings.cos.hasCredential ? '已保存，留空则不修改' : '••••••••'}
                  value={cos.secretKey}
                  onChange={(event) => setCos({ ...cos, secretKey: event.target.value })}
                />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <button className="ghost-btn primary" disabled={busy} onClick={() => void saveCos()}>
                保存备份配置
              </button>
              <button
                className="ghost-btn"
                disabled={busy || !settings.cos.hasCredential}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await window.jot.backup.now()
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                立即备份
              </button>
              <button className="ghost-btn" disabled={busy || !settings.cos.hasCredential} onClick={() => void loadRestorePoints()}>
                查看云端快照
              </button>
            </div>
            {cosHint && (
              <div className="hint" data-tone={cosHint.tone}>
                {cosHint.text}
              </div>
            )}
            <div className="hint">
              备份状态：{backupState.status === 'ok' ? '已同步' : backupState.status === 'error' ? `失败 · ${backupState.message ?? ''}` : backupState.status === 'syncing' ? '同步中' : '待同步'}
            </div>
            {restorePoints && (
              <div className="popover-tags" style={{ marginTop: 10 }}>
                {restorePoints.length === 0 && <div className="hint">云端还没有快照</div>}
                {restorePoints.map((point) => (
                  <button
                    key={point.key}
                    className="chip"
                    onClick={async () => {
                      const result = await window.jot.backup.restore(point.key)
                      setCosHint({ tone: result.ok ? 'ok' : 'error', text: result.message })
                    }}
                  >
                    {point.key.split('/').pop()}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="section">
            <div className="section-title">更新</div>
            <div className="field">
              <div className="field-label">自动检查更新</div>
              <div className="field-control">
                <button
                  className="switch"
                  data-on={settings.autoUpdate}
                  onClick={() => void patch({ autoUpdate: !settings.autoUpdate })}
                  aria-label="自动检查更新"
                />
              </div>
            </div>
            <div className="field">
              <div className="field-label">更新源</div>
              <div className="field-control">
                <input
                  className="text-input"
                  placeholder="https://<bucket>.cos.<region>.myqcloud.com/updates/"
                  value={feedUrl}
                  onChange={(event) => setFeedUrl(event.target.value)}
                  onBlur={() => void patch({ updateFeedUrl: feedUrl.trim() })}
                />
              </div>
            </div>
            <div className="hint">留空表示不检查更新。填你自己的分发地址（需公开可读）后才会启用；未签名安装包首次运行会触发 SmartScreen 提示。</div>
          </section>

          <section className="section">
            <div className="section-title">关于</div>
            <div className="field">
              <div className="field-label">版本</div>
              <div className="field-control" style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
                Jot {appInfo?.version ?? '—'}
              </div>
            </div>
            <div className="field">
              <div className="field-label">数据目录</div>
              <div className="field-control">
                <input className="text-input" readOnly value={appInfo?.dataDir ?? ''} />
              </div>
            </div>
          </section>
        </div>

        <div className="dialog-foot">
          <button className="ghost-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
