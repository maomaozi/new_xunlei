import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '../lib/cx'

export interface HeroStat {
  label: string
  value: ReactNode
  active?: boolean
  onClick?: () => void
}

/** Accent gradient summary card: one headline figure plus a row of tappable counters. */
export default function HeroStats({
  icon: Icon,
  label,
  value,
  hint,
  extra,
  stats,
  className,
}: {
  icon: LucideIcon
  label: string
  value: ReactNode
  hint?: ReactNode
  extra?: ReactNode
  stats: HeroStat[]
  className?: string
}) {
  return (
    <div className={cx('hero-gradient relative overflow-hidden rounded-[28px] p-5 md:p-6', className)}>
      <div className="pointer-events-none absolute -top-16 -right-10 h-44 w-44 rounded-full bg-white/15 blur-2xl" />
      <div className="relative flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13px] font-medium text-white/80">
            <Icon size={15} strokeWidth={2.4} /> {label}
          </div>
          <div className="mt-1 truncate text-[30px] leading-tight font-bold tracking-tight tabular-nums md:text-[34px]">{value}</div>
          {hint && <div className="mt-0.5 truncate text-[12px] text-white/75">{hint}</div>}
        </div>
        {extra}
      </div>
      <div className="relative mt-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
        {stats.map((stat) => {
          const body = (
            <>
              <div className="text-[17px] leading-tight font-bold tabular-nums">{stat.value}</div>
              <div className="mt-0.5 truncate text-[11px] text-white/80">{stat.label}</div>
            </>
          )
          const classes = cx(
            'rounded-2xl border px-2.5 py-2 text-left backdrop-blur-md transition',
            stat.active ? 'border-white/60 bg-white/30' : 'border-white/20 bg-white/12',
          )
          return stat.onClick ? (
            <button key={stat.label} type="button" onClick={stat.onClick} className={cx(classes, 'tap cursor-pointer text-white hover:bg-white/20')}>
              {body}
            </button>
          ) : (
            <div key={stat.label} className={classes}>
              {body}
            </div>
          )
        })}
      </div>
    </div>
  )
}
