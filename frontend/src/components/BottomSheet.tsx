import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../lib/cx'

/** Native-feeling action sheet for touch layouts; swipe down or tap outside to close. */
export default function BottomSheet({
  open,
  onClose,
  title,
  header,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  /** Custom header (e.g. file icon and details) rendered instead of the plain title. */
  header?: ReactNode
  children: ReactNode
}) {
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)
  const [drag, setDrag] = useState(0)
  const start = useRef<number | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  if (open && !mounted) setMounted(true)

  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(frame)
    }
    const timer = window.setTimeout(() => {
      setVisible(false)
      setMounted(false)
      setDrag(0)
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
        className={cx('absolute inset-0 bg-black/30 backdrop-blur-[4px] transition-opacity duration-250', shown ? 'opacity-100' : 'opacity-0')}
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        onTouchStart={(event) => {
          start.current = (panel.current?.scrollTop ?? 0) <= 0 ? event.touches[0].clientY : null
        }}
        onTouchMove={(event) => {
          if (start.current === null) return
          setDrag(Math.max(0, event.touches[0].clientY - start.current))
        }}
        onTouchEnd={() => {
          if (drag > 90) onClose()
          else setDrag(0)
          start.current = null
        }}
        style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}
        className={cx(
          'safe-bottom absolute inset-x-0 bottom-0 mx-auto max-h-[86dvh] max-w-xl overflow-y-auto rounded-t-[30px] border-t border-[var(--glass-border)] bg-[var(--glass-strong)] px-4 pt-2.5 pb-4 shadow-[0_-20px_50px_-20px_rgba(0,0,0,0.35)] backdrop-blur-2xl backdrop-saturate-150 transition-transform duration-250 ease-out',
          shown ? 'translate-y-0' : 'translate-y-full',
        )}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-ink/15" />
        {header ?? (title && <div className="mb-3 truncate px-2 text-center text-[15px] font-semibold text-ink">{title}</div>)}
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** Rounded group of sheet rows separated by hairlines. */
export function SheetGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mb-3 divide-y divide-line overflow-hidden rounded-[20px] group-fill', className)}>{children}</div>
}

export function SheetAction({
  icon,
  label,
  onClick,
  danger,
  disabled,
  active,
  extra,
}: {
  icon?: ReactNode
  label: ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  /** Marks the currently chosen option (accent text and a trailing check). */
  active?: boolean
  extra?: ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex w-full cursor-pointer items-center gap-3.5 border-0 bg-transparent px-4 py-3.5 text-left text-[15px] transition-colors active:bg-black/[0.05] disabled:opacity-40 dark:active:bg-white/[0.06]',
        danger ? 'text-danger' : active ? 'font-semibold text-accent' : 'text-ink',
      )}
    >
      {icon && <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center', danger ? 'text-danger' : active ? 'text-accent' : 'text-ink-2')}>{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {extra}
      {active && (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
    </button>
  )
}
