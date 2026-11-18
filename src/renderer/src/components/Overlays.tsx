export interface ToastItem {
  id: number
  text: string
  actionLabel?: string
  onAction?: () => void
}

export function Toasts({ items }: { items: ToastItem[] }): React.JSX.Element {
  return (
    <div className="toasts">
      {items.map((item) => (
        <div key={item.id} className="toast">
          <span>{item.text}</span>
          {item.actionLabel && item.onAction && (
            <button
              onClick={() => {
                item.onAction?.()
              }}
            >
              {item.actionLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

export function Lightbox({ imageId, onClose }: { imageId: string; onClose: () => void }): React.JSX.Element {
  return (
    <div className="lightbox" onClick={onClose} onKeyDown={(event) => event.key === 'Escape' && onClose()}>
      <img src={`jot://orig/${imageId}`} alt="" draggable={false} />
    </div>
  )
}
