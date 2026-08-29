import { useEffect, useRef } from 'react'

interface AutoTextareaProps {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  className?: string
  'aria-label'?: string
}

/**
 * 高度跟着内容走的多行输入框。
 *
 * 固定行数的输入框会让卡片一进编辑模式就凭空长高一截（原本一行释义占 19px，
 * 换成固定三行的输入框要占 68px），整屏卡片跟着重新流动一次。
 * 这里每次内容变化就把高度贴合内容，于是两种模式下卡片高度几乎一样。
 */
export function AutoTextarea({
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  'aria-label': ariaLabel
}: AutoTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // 先归零再读 scrollHeight，否则内容变短时高度只增不减
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      rows={1}
      className={className}
      style={{ resize: 'none', overflow: 'hidden' }}
      placeholder={placeholder}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  )
}
