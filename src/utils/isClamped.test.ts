import { describe, it, expect } from 'vitest'
import { isClamped } from './isClamped'

const box = (sh: number, ch: number, sw = 100, cw = 100) => ({
  scrollHeight: sh,
  clientHeight: ch,
  scrollWidth: sw,
  clientWidth: cw
})

describe('内容有没有被截断', () => {
  it('装得下就不算截断', () => {
    expect(isClamped(box(20, 20))).toBe(false)
  })

  it('高度超出算截断（多行被 line-clamp 砍掉）', () => {
    expect(isClamped(box(60, 20))).toBe(true)
  })

  it('宽度超出也算截断（单行 truncate）', () => {
    expect(isClamped(box(20, 20, 300, 100))).toBe(true)
  })

  it('零点几像素的误差不算 —— 浏览器算出来常有', () => {
    expect(isClamped(box(20.6, 20))).toBe(false)
    expect(isClamped(box(21.5, 20))).toBe(true)
  })

  it('元素还没挂上时当作不能展开，不炸', () => {
    expect(isClamped(null)).toBe(false)
    expect(isClamped(undefined)).toBe(false)
  })
})
