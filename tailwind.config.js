import plugin from 'tailwindcss/plugin'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      /*
       * 「宽屏布局」这条线：够不够摆得下三栏。
       *
       * 从前用的是默认的 md（768）。手机永远到不了，所以三栏那套从来没人验过，
       * 而平板竖屏（iPad 768、安卓平板多是 800）正好落在上面一点，
       * 拿到了一套摆不下的布局：笔记栏一开，正文只剩 94～126px，一行放不下两个词。
       *
       * 1024 把平板竖屏划给手机那套（侧栏浮起来盖住正文，正文永远整宽），
       * 横屏才走三栏。缘由和量出来的数记在 src/hooks/useWideLayout.ts。
       *
       * ⚠️ 和 useWideLayout.ts 里的 WIDE_PX 必须是同一个数。
       * md/lg/xl 保持 Tailwind 默认，别再拿它们表示「电脑版布局」。
       */
      screens: {
        wide: '1024px'
      },
      colors: {
        paper: '#fbfcf8',
        ink: '#2c2c2c',
        'ink-muted': '#5c5c5c',
        'paper-border': '#e5e3df',
        /*
         * 强调色。十档色阶全部走 CSS 变量（值在 src/index.css），
         * 所以切换颜色不必重新编译 —— 改 <html data-accent> 一处即可。
         *
         * 变量里存的是 RGB 分量（"245 158 11"）而不是 #f59e0b，
         * 为的是 `<alpha-value>` 还能用 —— 代码里有 19 处带透明度的写法
         * （accent-500/30、accent-700/80 这类），存成十六进制它们会全废。
         */
        accent: Object.fromEntries(
          [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((n) => [
            n,
            `rgb(var(--accent-${n}) / <alpha-value>)`
          ])
        )
      },
      fontFamily: {
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: [
    /*
     * `hover:` 改成「鼠标悬停 **或** 手指正按着」。
     *
     * 起因是两个毛病，一前一后：
     *
     * 1. **手机上 hover 退不掉**。手指点完，浏览器认为指针还停在按钮上，hover 那套
     *    一直挂着到你点别处。用户在「整理」上看出来了 —— 一颗两态的开关看着像三态，
     *    第三种正是 `hover:bg-stone-100 hover:text-amber-700`（量过：白底
     *    rgb(245,245,244)、琥珀字 rgb(180,83,9)，和他描述的一模一样）。
     *
     * 2. 于是先只把 hover 关进 `@media (hover: hover)`，手机上不再生效 ——
     *    **结果全 App 的点击反馈一起没了**，按哪儿都没动静。用户的原话是
     *    「一下子好像改的太死板了」。这一步是我改坏的。
     *
     * 所以正解不是「关掉 hover」，是**给它换一套触发条件**：
     * 有真鼠标就认悬停，没有就认「正按着」。`:active` 手指一松就退，
     * 不会像 hover 那样赖着不走 —— 第 1 条的病根也就没了。
     *
     * 这么做的好处是**一次覆盖全部**：84 处写着 `hover:` 的地方自动都有了
     * 触屏反馈，各自的颜色也照旧（琥珀底的按下去加深一格、白底的按下去出琥珀字），
     * 不用一个个去补 `active:`，以后新写的也自动带上。
     *
     * `group-hover` 不受影响（这个项目目前一处没用）。
     */
    plugin(({ addVariant }) => {
      addVariant('hover', [
        '@media (hover: hover) and (pointer: fine) { &:hover }',
        '&:active'
      ])
    })
  ]
}
