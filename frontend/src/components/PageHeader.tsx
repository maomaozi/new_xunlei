import type { ReactNode } from 'react'
import { cx } from '../lib/cx'

export default function PageHeader({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <header
      className={cx(
        'glass safe-top sticky top-0 z-30 -mx-4 mb-4 px-4 pt-3 pb-3 md:static md:mx-0 md:mb-6 md:bg-transparent md:px-0 md:pt-0 md:pb-0 md:backdrop-blur-none',
        className,
      )}
    >
      <div className="flex min-h-11 items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 truncate text-[22px] leading-tight font-bold tracking-tight text-ink md:text-[28px]">{title}</h1>
          {subtitle && <div className="mt-0.5 truncate text-[13px] text-ink-3">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
      </div>
      {children}
    </header>
  )
}
