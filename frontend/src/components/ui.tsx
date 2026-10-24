import { Tooltip } from 'antd'
import { Check, ChevronRight, Loader2, type LucideIcon } from 'lucide-react'
import { useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { cx } from '../lib/cx'
import { TONE_TEXT, type Tone } from '../lib/tone'

export type { Tone }

type ClickHandler = (event: MouseEvent<HTMLButtonElement>) => unknown

interface AsyncClickProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  /** When the handler returns a promise the button shows a spinner and ignores clicks until it settles. */
  onClick?: ClickHandler
  /** Externally controlled busy state (same effect as a pending click). */
  loading?: boolean
}

/** Tracks a pending async click so slow API calls cannot be submitted twice. */
function usePendingClick(onClick: ClickHandler | undefined): [boolean, ClickHandler] {
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const handle: ClickHandler = (event) => {
    if (busy.current || !onClick) return
    const result = onClick(event)
    if (result instanceof Promise) {
      busy.current = true
      setPending(true)
      void result.finally(() => {
        busy.current = false
        setPending(false)
      })
    }
  }
  return [pending, handle]
}

export function Card({
  children,
  className,
  inset = false,
  glass = false,
  style,
  onClick,
}: {
  children: ReactNode
  className?: string
  inset?: boolean
  /** Frosted translucent surface instead of the raised neumorphic one. */
  glass?: boolean
  style?: CSSProperties
  onClick?: () => void
}) {
  return (
    <div
      className={cx(inset ? 'neu-inset' : glass ? 'glass-card' : 'neu-raised', 'rounded-[26px] p-5', className)}
      style={style}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

interface IconButtonProps extends AsyncClickProps {
  icon: LucideIcon
  label: string
  active?: boolean
  size?: 'sm' | 'md' | 'lg'
  tone?: 'default' | 'accent' | 'danger'
  showTooltip?: boolean
  spinning?: boolean
  /** `ghost` is a flat round button for glass bars and dense rows. */
  variant?: 'neu' | 'ghost'
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
  variant = 'neu',
  className,
  onClick,
  loading = false,
  disabled,
  ...rest
}: IconButtonProps) {
  const [pending, handleClick] = usePendingClick(onClick)
  const busy = pending || loading
  const ShownIcon = busy && !spinning ? Loader2 : Icon
  const button = (
    <button
      type="button"
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={handleClick}
      data-active={active ? 'true' : undefined}
      className={cx(
        'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-2xl border-0 outline-none disabled:cursor-not-allowed disabled:opacity-40',
        variant === 'neu'
          ? 'neu-press'
          : 'tap bg-transparent hover:bg-black/[0.05] active:bg-black/[0.08] data-[active=true]:bg-accent/12 dark:hover:bg-white/[0.06]',
        SIZES[size],
        tone === 'accent' || active ? 'text-accent' : tone === 'danger' ? 'text-danger' : 'text-ink-2',
        className,
      )}
      {...rest}
    >
      <ShownIcon size={ICON_SIZES[size]} strokeWidth={2} className={spinning || busy ? 'animate-spin' : undefined} />
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
  onClick,
  loading = false,
  disabled,
  ...rest
}: AsyncClickProps & { icon?: LucideIcon; active?: boolean; primary?: boolean }) {
  const [pending, handleClick] = usePendingClick(onClick)
  const busy = pending || loading
  return (
    <button
      type="button"
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={handleClick}
      data-active={active ? 'true' : undefined}
      className={cx(
        'inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-2xl border-0 px-4 py-2.5 text-sm font-medium whitespace-nowrap outline-none transition disabled:cursor-not-allowed disabled:opacity-40',
        primary ? 'accent-fill hover:brightness-105 active:brightness-95' : 'neu-press',
        !primary && (active ? 'text-accent' : 'text-ink-2'),
        className,
      )}
      {...rest}
    >
      {busy ? <Loader2 size={16} strokeWidth={2.2} className="animate-spin" /> : Icon && <Icon size={16} strokeWidth={2.2} />}
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
    <div className={cx('neu-inset-sm h-2 overflow-hidden rounded-full', className)}>
      <div
        className={cx('h-full rounded-full transition-[width] duration-500 ease-out', animated && 'progress-stripes')}
        style={{
          width: `${Math.max(value, value > 0 ? 3 : 0)}%`,
          backgroundColor: color,
          backgroundImage:
            tone === 'accent' ? 'linear-gradient(90deg, color-mix(in srgb, var(--accent) 80%, var(--accent-2)), var(--accent))' : undefined,
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
            <stop offset="0" stopColor="var(--accent-2)" />
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
      <div className="neu-inset mb-5 flex h-20 w-20 items-center justify-center rounded-[28px] text-accent">
        <div className="tint flex h-14 w-14 items-center justify-center rounded-[20px]">
          <Icon size={28} strokeWidth={1.8} />
        </div>
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
  tone?: Tone
  className?: string
}) {
  return (
    <span
      className={cx(
        'tint inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-4 font-semibold whitespace-nowrap',
        TONE_TEXT[tone],
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
  tone?: Tone
}) {
  return (
    <Card className="flex items-center gap-4 p-4">
      <IconTile icon={Icon} tone={tone} size={48} />
      <div className="min-w-0">
        <div className="text-xs text-ink-3">{label}</div>
        <div className="truncate text-lg font-semibold text-ink tabular-nums">{value}</div>
        {hint && <div className="truncate text-xs text-ink-3">{hint}</div>}
      </div>
    </Card>
  )
}

/** Rounded tile with a tinted fill in the tone color; the colored counterpart of a neu icon well. */
export function IconTile({
  icon: Icon,
  tone = 'accent',
  size = 40,
  className,
  children,
}: {
  icon: LucideIcon
  tone?: Tone
  size?: number
  className?: string
  children?: ReactNode
}) {
  return (
    <div
      className={cx('tint relative flex shrink-0 items-center justify-center', TONE_TEXT[tone], className)}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.34) }}
    >
      <Icon size={Math.round(size * 0.46)} strokeWidth={2} />
      {children}
    </div>
  )
}

export interface ChipOption<T extends string> {
  value: T
  label: ReactNode
  count?: number
}

/** Horizontally scrolling filter chips (tab-like on phones, compact on desktop). */
export function Chips<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: ChipOption<T>[]
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div role="tablist" className={cx('scrollbar-none flex gap-2 overflow-x-auto', className)}>
      {options.map((option) => {
        const on = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(option.value)}
            className={cx(
              'tap flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border-0 px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors',
              on ? 'accent-fill' : 'neu-raised-xs text-ink-2 hover:text-ink',
            )}
          >
            {option.label}
            {option.count !== undefined && option.count > 0 && (
              <span
                className={cx(
                  'min-w-5 rounded-full px-1.5 text-center text-[11px] leading-[18px] font-semibold tabular-nums',
                  on ? 'bg-white/25 text-white' : 'tint text-ink-3',
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Inset-grouped list, the native settings/menu pattern. */
export function ListGroup({
  title,
  children,
  className,
  glass = false,
}: {
  title?: ReactNode
  children: ReactNode
  className?: string
  glass?: boolean
}) {
  return (
    <section className={className}>
      {title && <div className="mb-2 px-4 text-[12px] font-medium tracking-wide text-ink-3">{title}</div>}
      <div className={cx('overflow-hidden rounded-[22px]', glass ? 'glass-card' : 'neu-raised-sm')}>
        <div className="divide-y divide-line">{children}</div>
      </div>
    </section>
  )
}

export function ListItem({
  icon,
  tone = 'accent',
  title,
  subtitle,
  extra,
  onClick,
  chevron = Boolean(onClick),
  danger,
}: {
  icon?: LucideIcon
  tone?: Tone
  title: ReactNode
  subtitle?: ReactNode
  extra?: ReactNode
  onClick?: () => void
  chevron?: boolean
  danger?: boolean
}) {
  const body = (
    <>
      {icon && <IconTile icon={icon} tone={danger ? 'danger' : tone} size={34} />}
      <div className="min-w-0 flex-1">
        <div className={cx('truncate text-[15px] font-medium', danger ? 'text-danger' : 'text-ink')}>{title}</div>
        {subtitle && <div className="mt-0.5 truncate text-[12px] text-ink-3">{subtitle}</div>}
      </div>
      {extra && <div className="flex shrink-0 items-center gap-2 text-[13px] text-ink-3">{extra}</div>}
      {chevron && <ChevronRight size={17} className="shrink-0 text-ink-3" />}
    </>
  )
  const className = 'flex w-full items-center gap-3 px-4 py-3 text-left'
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cx(className, 'cursor-pointer border-0 bg-transparent transition-colors hover:bg-black/[0.025] active:bg-black/[0.05] dark:hover:bg-white/[0.03] dark:active:bg-white/[0.06]')}
    >
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  )
}

export interface BarAction {
  key: string
  icon: LucideIcon
  label: string
  onClick: () => unknown
  danger?: boolean
  disabled?: boolean
}

/** Bottom action bar for selections on phones; covers the tab bar while shown. */
export function ActionBar({ actions }: { actions: BarAction[] }) {
  return (
    <div className="glass safe-bottom fixed inset-x-0 bottom-0 z-[60] border-t border-line">
      <div className="mx-auto flex max-w-lg items-stretch justify-around px-2 pt-2 pb-1.5">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            disabled={action.disabled}
            onClick={() => void action.onClick()}
            className={cx(
              'tap flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-1 border-0 bg-transparent py-1 text-[11px] font-medium disabled:opacity-35',
              action.danger ? 'text-danger' : 'text-ink-2',
            )}
          >
            <action.icon size={21} strokeWidth={2} />
            <span className="truncate">{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Round selection check used by selectable rows and tiles. */
export function SelectCheck({
  checked,
  onClick,
  className,
}: {
  checked: boolean
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
  className?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? '取消选择' : '选择'}
      onClick={(event) => {
        event.stopPropagation()
        onClick?.(event)
      }}
      className={cx(
        'flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-full border-0 transition-all duration-200',
        checked ? 'accent-fill' : 'neu-inset-sm text-transparent',
        className,
      )}
    >
      <Check size={13} strokeWidth={3.2} />
    </button>
  )
}

/** Phone header controls while selecting: select all / done. */
export function SelectionControls({ allSelected, onAll, onDone }: { allSelected: boolean; onAll: () => void; onDone: () => void }) {
  return (
    <>
      <button type="button" onClick={onAll} className="tap cursor-pointer rounded-xl border-0 bg-transparent px-2 py-1.5 text-[15px] font-medium text-accent">
        {allSelected ? '全不选' : '全选'}
      </button>
      <button type="button" onClick={onDone} className="tap cursor-pointer rounded-xl border-0 bg-accent/12 px-3 py-1.5 text-[15px] font-semibold text-accent">
        完成
      </button>
    </>
  )
}
