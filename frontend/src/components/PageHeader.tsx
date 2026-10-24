import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useIsMobile } from '../hooks/useMediaQuery'
import { cx } from '../lib/cx'
import { TAB_ROOTS } from '../lib/nav'

export default function PageHeader({
  title,
  subtitle,
  actions,
  children,
  className,
  back,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
  /** Phone back button: a handler, `false` to hide it, or automatic for non-tab pages. */
  back?: (() => void) | false
}) {
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/')
  }
  const onBack = back === false ? null : back ?? (TAB_ROOTS.includes(pathname) ? null : goBack)

  if (isMobile) {
    return (
      <header className={cx('glass safe-top sticky top-0 z-30 -mx-4 mb-4 border-b border-line px-4', className)}>
        <div className="flex min-h-14 items-center gap-2 py-2">
          {onBack && (
            <button
              type="button"
              aria-label="返回"
              onClick={onBack}
              className="tap -ml-2 flex h-10 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-ink"
            >
              <ChevronLeft size={26} strokeWidth={2.2} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="m-0 truncate text-[20px] leading-tight font-bold tracking-tight text-ink">{title}</h1>
            {subtitle && <div className="mt-0.5 truncate text-[12px] text-ink-3">{subtitle}</div>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        {children && <div className="pb-3">{children}</div>}
      </header>
    )
  }

  return (
    <header className={cx('mb-6', className)}>
      <div className="flex min-h-11 items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 truncate text-[28px] leading-tight font-bold tracking-tight text-ink">{title}</h1>
          {subtitle && <div className="mt-1 truncate text-[13px] text-ink-3">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
      </div>
      {children && <div className="mt-5">{children}</div>}
    </header>
  )
}
