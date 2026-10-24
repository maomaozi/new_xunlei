import { Tooltip } from 'antd'
import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import { cx } from '../lib/cx'

export function Card({
  children,
  className,
  inset = false,
  style,
  onClick,
}: {
  children: ReactNode
  className?: string
  inset?: boolean
  style?: CSSProperties
  onClick?: () => void
}) {
  return (
    <div
      className={cx(inset ? 'neu-inset' : 'neu-raised', 'rounded-[26px] p-5', className)}
      style={style}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon
  label: string
  active?: boolean
  size?: 'sm' | 'md' | 'lg'
  tone?: 'default' | 'accent' | 'danger'
  showTooltip?: boolean
  spinning?: boolean
}

const SIZES = { sm: 'h-9 w-9', md: 'h-11 w-11', lg: 'h-13 w-13' }
const ICON_SIZES = { sm: 16, md: 18, lg: 21 }

export function IconButton({
  icon: Icon,
  label,
  active,
  size = 'md',
  tone = 'default',
  showTooltip = true,
  spinning = false,
  className,
  ...rest
}: IconButtonProps) {
  const button = (
    <button
      type="button"
      aria-label={label}
      data-active={active ? 'true' : undefined}
      className={cx(
        'neu-press inline-flex shrink-0 cursor-pointer items-center justify-center rounded-2xl border-0 outline-none disabled:cursor-not-allowed disabled:opacity-40',
        SIZES[size],
        tone === 'accent' || active ? 'text-accent' : tone === 'danger' ? 'text-danger' : 'text-ink-2',
        className,
      )}
      {...rest}
    >
      <Icon size={ICON_SIZES[size]} strokeWidth={2} className={spinning ? 'animate-spin' : undefined} />
    </button>
  )
  return showTooltip ? (
    <Tooltip title={label} mouseEnterDelay={0.5}>
      {button}
    </Tooltip>
  ) : (
    button
  )
}

export function PillButton({
  icon: Icon,
  children,
  active,
  className,
  primary,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: LucideIcon; active?: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      data-active={active ? 'true' : undefined}
      className={cx(
        'inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-2xl border-0 px-4 py-2.5 text-sm font-medium whitespace-nowrap outline-none transition disabled:cursor-not-allowed disabled:opacity-40',
        primary ? 'accent-fill hover:brightness-105 active:brightness-95' : 'neu-press',
        !primary && (active ? 'text-accent' : 'text-ink-2'),
        className,
      )}
      {...rest}
    >
      {Icon && <Icon size={16} strokeWidth={2.2} />}
      {children}
    </button>
  )
}

export function ProgressBar({
  value,
  tone = 'accent',
  animated = false,
  className,
}: {
  value: number
  tone?: 'accent' | 'success' | 'danger' | 'warning' | 'muted'
  animated?: boolean
  className?: string
}) {
  const color = {
    accent: 'var(--accent)',
    success: 'var(--success)',
    danger: 'var(--danger)',
    warning: 'var(--warning)',
    muted: 'var(--text-3)',
  }[tone]
  return (
    <div className={cx('neu-inset-sm h-2.5 overflow-hidden rounded-full', className)}>
      <div
        className={cx('h-full rounded-full transition-[width] duration-500 ease-out', animated && 'progress-stripes')}
        style={{
          width: `${Math.max(value, value > 0 ? 3 : 0)}%`,
          backgroundColor: color,
          boxShadow: `0 0 8px color-mix(in srgb, ${color} 45%, transparent)`,
        }}
      />
    </div>
  )
}

export function Ring({
  value,
  size = 148,
  stroke = 14,
  children,
}: {
  value: number
  size?: number
  stroke?: number
  children?: ReactNode
}) {
  const radius = (size - stroke) / 2 - 6
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - Math.min(100, Math.max(0, value)) / 100)
  return (
    <div className="neu-raised relative shrink-0 rounded-full" style={{ width: size, height: size }}>
      <div className="neu-inset absolute rounded-full" style={{ inset: 12 }} />
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="color-mix(in srgb, var(--accent) 65%, white)" />
            <stop offset="1" stopColor="var(--accent)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#ring-grad)"
          strokeWidth={stroke - 4}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(.2,.8,.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="neu-inset mb-5 flex h-20 w-20 items-center justify-center rounded-[28px] text-ink-3">
        <Icon size={32} strokeWidth={1.6} />
      </div>
      <div className="text-base font-semibold text-ink">{title}</div>
      {description && <div className="mt-1.5 max-w-sm text-sm text-ink-3">{description}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function SectionHeader({ title, extra, className }: { title: ReactNode; extra?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-4 flex items-center justify-between gap-3', className)}>
      <h3 className="m-0 text-[15px] font-semibold text-ink">{title}</h3>
      {extra}
    </div>
  )
}

export function Badge({
  children,
  tone = 'muted',
  className,
}: {
  children: ReactNode
  tone?: 'muted' | 'accent' | 'success' | 'danger' | 'warning'
  className?: string
}) {
  const colors = {
    muted: 'text-ink-3',
    accent: 'text-accent',
    success: 'text-success',
    danger: 'text-danger',
    warning: 'text-warning',
  }
  return (
    <span
      className={cx(
        'neu-inset-sm inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap',
        colors[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('neu-inset-sm progress-stripes rounded-xl opacity-70', className)} />
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-2">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function Stat({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'accent',
}: {
  icon: LucideIcon
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'accent' | 'success' | 'warning' | 'danger'
}) {
  const color = { accent: 'text-accent', success: 'text-success', warning: 'text-warning', danger: 'text-danger' }[tone]
  return (
    <Card className="flex items-center gap-4 p-4">
      <div className={cx('neu-inset flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl', color)}>
        <Icon size={21} />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-ink-3">{label}</div>
        <div className="truncate text-lg font-semibold text-ink tabular-nums">{value}</div>
        {hint && <div className="truncate text-xs text-ink-3">{hint}</div>}
      </div>
    </Card>
  )
}
