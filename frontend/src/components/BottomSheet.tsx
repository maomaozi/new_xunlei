import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../lib/cx'

/** Native-feeling action sheet for touch layouts. */
export default function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
}) {
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)
  if (open && !mounted) setMounted(true)

  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(frame)
    }
    const timer = window.setTimeout(() => {
      setVisible(false)
      setMounted(false)
    }, 260)
    return () => window.clearTimeout(timer)
  }, [open])
  const shown = open && visible

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!mounted) return null
  return createPortal(
    <div className="fixed inset-0 z-[1100]">
      <div
        className={cx('absolute inset-0 bg-black/25 backdrop-blur-[3px] transition-opacity duration-250', shown ? 'opacity-100' : 'opacity-0')}
        onClick={onClose}
      />
      <div
        role="dialog"
        className={cx(
          'neu-raised safe-bottom absolute inset-x-0 bottom-0 max-h-[82vh] overflow-y-auto rounded-t-[30px] px-4 pt-3 pb-4 transition-transform duration-250 ease-out',
          shown ? 'translate-y-0' : 'translate-y-full',
        )}
      >
        <div className="neu-inset-sm mx-auto mb-4 h-1.5 w-12 rounded-full" />
        {title && <div className="mb-3 truncate px-2 text-center text-[15px] font-semibold text-ink">{title}</div>}
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function SheetAction({
  icon,
  label,
  onClick,
  danger,
  disabled,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'neu-press flex w-full cursor-pointer items-center gap-3 rounded-2xl border-0 px-4 py-3.5 text-left text-[15px] disabled:opacity-40',
        danger ? 'text-danger' : 'text-ink',
      )}
    >
      <span className={cx('flex h-5 w-5 items-center justify-center', danger ? 'text-danger' : 'text-ink-2')}>{icon}</span>
      {label}
    </button>
  )
}
