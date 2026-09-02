import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.colin.lyricvocab',
  appName: '我的文库',
  webDir: 'dist',
  plugins: {
    /*
     * 系统栏（顶上的时钟电量、底下的导航键）里那些图标用哪一套。
     *
     * LIGHT = 「底色是浅的」，于是系统把图标画成**深色**。
     * 名字容易反过来理解，记一笔：这里说的是**底色**，不是图标。
     *
     * 必须写。不写是 DEFAULT，Capacitor 会跟着系统深浅色走
     * （见 SystemBars.java 的 setStyle），而且它是在 MainActivity 之后跑的，
     * 会把那边设好的覆盖掉 —— 一开深色模式图标就成了白的,
     * 而我们的系统栏已经透明、后面是白纸，白图标等于看不见。
     * 这个 app 没有深色模式，这里也就一律按浅色底来。
     */
    SystemBars: {
      style: 'LIGHT'
    }
  }
};

export default config;
