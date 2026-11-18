import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { CardColor } from '@shared/types'
import { prepareImage, prepareImageFromDataUrl } from './lib/image'
import './styles.css'
import './capture.css'

const media = window.matchMedia('(prefers-color-scheme: dark)')
document.documentElement.dataset.theme = media.matches ? 'dark' : 'light'

interface AttachedImage {
  id: string
  width: number
  height: number
  previewUrl: string
}

function CaptureApp(): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState('')
  const [image, setImage] = useState<AttachedImage | null>(null)
  const [tags, setTags] = useState('')
  const [color, setColor] = useState<CardColor>('none')
  const [saving, setSaving] = useState(false)
  const [savedNoteId, setSavedNoteId] = useState<string | null>(null)

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])

  useEffect(() => {
    void window.jot.settings.get().then((settings) => {
      const theme = settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme
      document.documentElement.dataset.theme = theme
    })
    const off = window.jot.on('evt:capture-opened', () => {
      setText('')
      setImage(null)
      setTags('')
      setColor('none')
      setSavedNoteId(null)
      setSaving(false)
      focusInput()
    })
    focusInput()
    return () => off()
  }, [focusInput])

  useLayoutEffect(() => {
    const node = rootRef.current
    if (!node) return
    const observer = new ResizeObserver(() => {
      window.jotInternal.resize(node.offsetHeight + 8)
    })
    observer.observe(node)
    window.jotInternal.resize(node.offsetHeight + 8)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        window.jot.capture.close()
      }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        void submit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const attachImage = async (blob: Blob): Promise<void> => {
    const prepared = await prepareImage(blob)
    const result = await window.jot.images.save({
      dataUrl: prepared.dataUrl,
      thumbDataUrl: prepared.thumbDataUrl,
      width: prepared.width,
      height: prepared.height
    })
    setImage({
      id: result.id,
      width: result.width,
      height: result.height,
      previewUrl: prepared.thumbDataUrl
    })
  }

  const onPaste = async (event: React.ClipboardEvent): Promise<void> => {
    const items = event.clipboardData?.items ?? []
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          event.preventDefault()
          await attachImage(file)
          return
        }
      }
    }
    const files = event.clipboardData?.files ?? []
    if (files.length > 0 && files[0].type.startsWith('image/')) {
      event.preventDefault()
      await attachImage(files[0])
      return
    }
    const hasText = (event.clipboardData?.getData('text/plain') ?? '').length > 0
    if (hasText) return
    // 部分来源（截图工具、Office）不会通过 paste 暴露文件，退回主进程读剪贴板图片
    const dataUrl = await window.jot.images.fromClipboard()
    if (dataUrl) {
      event.preventDefault()
      const prepared = await prepareImageFromDataUrl(dataUrl)
      const result = await window.jot.images.save({
        dataUrl: prepared.dataUrl,
        thumbDataUrl: prepared.thumbDataUrl,
        width: prepared.width,
        height: prepared.height
      })
      setImage({
        id: result.id,
        width: result.width,
        height: result.height,
        previewUrl: prepared.thumbDataUrl
      })
    }
  }

  const submit = async (): Promise<void> => {
    if (saving) return
    const trimmed = text.trim()
    if (!trimmed && !image) return
    setSaving(true)
    try {
      const note = await window.jot.capture.submit({
        kind: image ? 'image' : 'text',
        text: trimmed,
        imageId: image?.id ?? null,
        imageW: image?.width ?? null,
        imageH: image?.height ?? null,
        tags: tags
          .split(/[,，\s]+/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        color
      })
      setSavedNoteId(note.id)
      setText('')
      setImage(null)
      setTags('')
      setSaving(false)
      setTimeout(() => {
        window.jot.capture.close()
        setSavedNoteId(null)
      }, 1800)
    } catch {
      setSaving(false)
    }
  }

  const canSave = (text.trim().length > 0 || image !== null) && !saving

  return (
    <div className="capture-root" ref={rootRef}>
      <div className="capture-card">
        <div className="capture-head">
          <div className="capture-dot" />
          <span className="capture-title">{savedNoteId ? '已保存' : '新便签'}</span>
          <span style={{ flex: 1 }} />
          <span className="capture-hint">Ctrl+Enter 保存 · Esc 关闭</span>
        </div>

        <textarea
          ref={textareaRef}
          className="capture-input"
          value={text}
          placeholder="粘贴文字或图片…"
          rows={3}
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => void onPaste(event)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              void submit()
            }
          }}
        />

        {image && (
          <div className="capture-image">
            <img src={image.previewUrl} alt="" draggable={false} />
            <button
              className="capture-image-remove"
              onClick={() => setImage(null)}
              aria-label="移除图片"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}

        <div className="capture-foot">
          <input
            className="capture-tags"
            value={tags}
            placeholder="标签"
            onChange={(event) => setTags(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submit()
              }
            }}
          />
          <div className="swatches" style={{ padding: 0 }}>
            {(['none', 'sand', 'rose', 'sky', 'sage', 'lilac', 'slate'] as CardColor[]).map((item) => (
              <button
                key={item}
                className="swatch"
                data-color={item}
                data-active={color === item}
                onClick={() => setColor(item)}
                aria-label={`颜色 ${item}`}
              />
            ))}
          </div>
          {savedNoteId ? (
            <button className="capture-save located" onClick={() => window.jot.capture.locate(savedNoteId)}>
              在画布中定位
            </button>
          ) : (
            <button className="capture-save" disabled={!canSave} onClick={() => void submit()}>
              保存
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const container = document.getElementById('root')
if (container) createRoot(container).render(<CaptureApp />)
