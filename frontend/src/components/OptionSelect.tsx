import { Select } from 'antd'
import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useIsMobile } from '../hooks/useMediaQuery'
import { cx } from '../lib/cx'
import BottomSheet, { SheetAction, SheetGroup } from './BottomSheet'

export interface SelectOption<T extends string | number> {
  value: T
  label: ReactNode
}

/**
 * Single-choice select: a styled dropdown on desktop and a bottom sheet of options on phones.
 * Works as a controlled field inside `Form.Item` (value / onChange).
 */
export default function OptionSelect<T extends string | number>({
  value,
  onChange,
  options,
  title,
  placeholder = '请选择',
  className,
  disabled = false,
}: {
  value?: T
  onChange?: (value: T) => void
  options: SelectOption<T>[]
  /** Sheet title on phones. */
  title?: ReactNode
  placeholder?: string
  className?: string
  disabled?: boolean
}) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const current = options.find((option) => option.value === value)

  if (!isMobile) {
    return <Select disabled={disabled} value={value} onChange={(next: T) => onChange?.(next)} options={options} placeholder={placeholder} className={cx('w-full', className)} />
  }
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cx(
          'neu-inset-sm flex h-11 w-full cursor-pointer items-center gap-2 rounded-[14px] border-0 px-3.5 text-left text-[15px] font-medium disabled:cursor-not-allowed disabled:opacity-50',
          current ? 'text-ink' : 'text-ink-3',
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">{current?.label ?? placeholder}</span>
        <ChevronDown size={16} className="shrink-0 text-ink-3" />
      </button>
      <BottomSheet open={open && !disabled} onClose={() => setOpen(false)} title={title}>
        <SheetGroup>
          {options.map((option) => (
            <SheetAction
              key={String(option.value)}
              label={option.label}
              active={option.value === value}
              onClick={() => {
                setOpen(false)
                onChange?.(option.value)
              }}
            />
          ))}
        </SheetGroup>
      </BottomSheet>
    </>
  )
}
