/**
 * 元素的内容是不是真的被截断了（超出了可见范围）。
 *
 * 「点一下展开」这件事必须先知道**有没有东西可展开** ——
 * 不判断的话，短句子点一下也会进入展开态，多出一截空白，
 * 用户看着就是「点了个寂寞还撑高了一点」。
 *
 * 抽成纯函数是为了好测：只认这四个数，不需要真的渲染一个元素。
 * 留 1px 容差 —— 浏览器算出来的高度常有零点几像素的误差。
 */
export interface Measurable {
  scrollHeight: number
  clientHeight: number
  scrollWidth: number
  clientWidth: number
}

export function isClamped(el: Measurable | null | undefined): boolean {
  if (!el) return false
  return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1
}
