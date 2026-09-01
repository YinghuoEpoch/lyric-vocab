/** @type {import('tailwindcss').Config} */
export default {
  /*
   * hover 只对「真有鼠标」的设备生效。
   *
   * 手机上没有「把鼠标移开」这回事：手指点完，浏览器认为指针还停在按钮上，
   * hover 那套样式就一直挂着，直到你点别处。于是一颗两态的开关看着像三态 ——
   * 用户报的正是这个：整理关掉之后没复原，卡在「白底 + 琥珀字」上，
   * 而那正是 `hover:bg-stone-100 hover:text-amber-700` 的样子（量过：
   * rgb(245,245,244) 和 rgb(180,83,9)，和他描述的一模一样）。
   *
   * 这个毛病不是整理独有的 —— 全 App 每一颗带 hover 的按钮在手机上都这样，
   * 只是别的按钮点完就弹窗或跳页，不容易看出来。
   *
   * 开了这个开关，Tailwind 会把所有 hover 规则包进
   * `@media (hover: hover) and (pointer: fine)`：手机上根本不生效，
   * 电脑浏览器一切照旧。打包验过：20 条 hover 规则里 19 条被包了进去，
   * 剩下那条是滚动条滑块的 hover（手写 CSS，手机上本来就没有滚动条）。
   */
  future: { hoverOnlyWhenSupported: true },
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#fbfcf8',
        ink: '#2c2c2c',
        'ink-muted': '#5c5c5c',
        'paper-border': '#e5e3df',
        'accent': '#b8860b'
      },
      fontFamily: {
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
}
