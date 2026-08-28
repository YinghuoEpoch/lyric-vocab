# 歌词学英语

通过歌词上下文记单词的 PWA 应用。

## 技术栈

- React 18 + TypeScript
- Vite
- Tailwind CSS
- Lucide Icons
- LocalStorage

## 运行

```bash
cd lyric-vocab
npm install
npm run dev
```

浏览器打开 http://localhost:5173

## 功能

- **左侧栏**：歌词本（文件夹），可新建/删除歌词本与单篇歌词
- **中间**：极简编辑器；粘贴中英混合歌词后自动区分英文（衬线 Playfair Display）与中文（无衬线）
- **单词笔记**：悬停高亮英文单词，点击弹出气泡填写音标、词性、释义；保存后单词显示下划线，再次点击可编辑
- **右侧栏**：生词板自动汇总当前篇/全部标记过的单词，点击可滚动到文中位置
- **移动端**：左右侧栏默认隐藏，通过顶部汉堡菜单与生词图标呼出

首次打开会自带示例歌词《Yesterday Once More》及两条示例笔记，可直接体验点击单词做笔记。
