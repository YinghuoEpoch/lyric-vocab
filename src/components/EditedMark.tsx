/**
 * 「正文已改」的记号，给句摘卡和短语卡共用。
 *
 * 什么时候出现：你在「编辑全文」里动了这条笔记框住的那段话，
 * 于是它跟着变短或错位了。卡片上显示的永远是**正文现在的样子**，
 * 这个记号则告诉你「它和你当初划的那一句不一样了」，展开能看到原句。
 *
 * 从前没有这个记号，也没有原句 —— 缩短时直接拿新文字把原文覆盖掉，
 * 于是句子悄悄少一截，你还查不出少了什么（见 后续规划.md 第二十一节）。
 *
 * 把删掉的内容打回正文，记号会自动消失，笔记也自动框回原样 ——
 * 所以它和「AI 填充」那个角标一样，是一份会自己了结的待办，不会越积越花。
 *
 * 样式跟着「原文已删除」那枚走（同样的圆角胶囊、同样的灰），
 * 两者是同一类信息：这条笔记和正文对不上了，差别只在程度。
 */
export function EditedMark({ sourceText, expanded }: { sourceText: string; expanded?: boolean }) {
  return (
    <>
      <span
        className="px-2 py-0.5 rounded-full bg-stone-100 text-ink-muted text-xs font-medium border border-stone-300/70"
        title={`正文改过了，这条笔记跟着变了。你当初划的是：${sourceText}`}
      >
        正文已改
      </span>
      {/*
        原句只在展开时露出来。收起时卡片本来就只给三行，
        再塞一句会把真正要看的释义挤出视野。
      */}
      {/*
        这里必须是 span+block，不能用 <p>：复习页的句摘卡把整段英文包在一个
        <p> 里，<p> 套 <p> 是非法嵌套，浏览器会擅自把外层那个提前闭掉，
        版式会莫名其妙地散架。span 放哪儿都合法。
      */}
      {expanded && (
        <span className="block w-full font-serif text-xs text-ink-muted/90 leading-snug">
          <span className="text-ink-muted/70">原句：</span>
          {sourceText}
        </span>
      )}
    </>
  )
}
