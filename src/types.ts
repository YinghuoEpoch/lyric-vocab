export interface LyricBook {
  id: string
  name: string
  createdAt: number
  deletedAt?: number
}

export interface LyricPage {
  id: string
  /**
   * 所属文库 ID；为 null 时表示顶层「根」文档（不在任何文库中）。
   */
  bookId: string | null
  title: string
  content: string
  updatedAt: number
  deletedAt?: number
  /** 阅读进度：滚动位置 scrollTop，用于恢复上次阅读位置 */
  progress?: number
}

export interface WordNote {
  word: string
  phonetic?: string
  pos?: string
  definition?: string
  /**
   * 由 AI 自动填充。用于在界面上标出「这条是机器填的、需要复核」，
   * 也便于一键撤销全部自动填充的内容。用户手动改过之后应清掉此标记。
   */
  auto?: boolean
  /** 词的原形（stood -> stand）。目前不显示，留给以后接词典用。 */
  lemma?: string
  /**
   * 原文已删除：正文编辑后找不到这个词了，但用户选择了保留笔记。
   * 界面上会标出来，方便一眼认出「这条笔记在文中已经没有对应内容了」。
   * 若之后原文里又出现这个词，对账时会自动重新挂上并清掉此标记。
   */
  orphaned?: boolean
}

export type NotesMap = Record<string, WordNote> // anchorId -> WordNote

export interface AppData {
  books: LyricBook[]
  pages: LyricPage[]
  notes: Record<string, NotesMap> // pageId -> NotesMap
  /**
   * 句摘（旧形状）。
   *
   * 运行期已经不用它了 —— 句摘现在就是 annotations 里 type 为 'sentence' 的标注。
   * 保留两个用途：读取「统一标注模型」之前导出的老备份；
   * 以及导出时额外写一份，万一要退回旧版本 APK，旧版本认得的正是这个字段。
   */
  sentences?: Sentence[]
  /**
   * 统一标注表（新模型，见下方 Annotation）。
   *
   * 目前与上面的 notes / sentences 并存：那两份是旧模型的存量数据，
   * 迁移之后仍原样保留不删，作为可回退的保险。等新模型在真机上跑稳了再清理。
   */
  annotations?: Annotation[]
  /**
   * 标注迁移完成的时间。存在即表示迁移已经跑过，不要再跑第二遍。
   *
   * 这个标记必须跟数据存在一起，不能像分词迁移那样放 localStorage ——
   * 那两处会脱节：清掉 localStorage 之后迁移会重跑，
   * 而重跑是拿「旧的 notes」重建标注表，等于把你迁移之后新加的标注全冲掉。
   */
  annotationsMigratedAt?: number
}

export type ReaderSettings = {
  fontSize: number
  fontFamily: 'sans' | 'serif' | 'rounded'
  /** 纸色。仅浅色变体：纯白 / 青灰(Sage) / 暖白 */
  theme: 'pure' | 'original' | 'rice'
  /**
   * 强调色。下划线、按钮、卡片词头这些「有颜色的地方」用它。
   *
   * 和纸色是两件事：纸色管底，强调色管点缀，各选各的。
   * 真正的色值在 src/index.css 里，这里存的只是选了哪一档。
   */
  accent: AccentColor
}

/** 琥珀 / 墨蓝 / 松绿 / 朱红 / 石墨 */
export type AccentColor = 'amber' | 'indigo' | 'teal' | 'rose' | 'stone'

/** 句摘：用户保存的句子（范围文本），用于句型/翻译笔记 */
export interface Sentence {
  id: string
  /** 完整句子原文 */
  text: string
  /** 当初划下这句时的原文；正文改过、这句因此变短或错位时才有。见 Annotation.sourceText */
  sourceText?: string
  /** 句型/语法说明 */
  grammar: string
  /** 翻译或释义 */
  meaning: string
  /** 所属文档 ID */
  docId: string
  /** 句子起始单词的 anchorId（用于在原文中持久标记范围） */
  startAnchorId: string
  /** 句子结束单词的 anchorId（用于在原文中持久标记范围） */
  endAnchorId: string
  /** 创建/更新时间戳 */
  date: number
  /** 原文已删除；含义同 WordNote.orphaned */
  orphaned?: boolean
  /** 由 AI 自动填充；含义同 WordNote.auto */
  auto?: boolean
}

/**
 * 标注：单词 / 短语 / 句子的统一模型。
 *
 * 和旧的 WordNote / Sentence 最大的区别是**身份**。
 * 旧模型里单词笔记的键就是它的坐标（`L0W2` = 第 0 行第 2 个词），
 * 位置即身份 —— 于是正文一编辑，身份就跟着变，只能靠事后「对账」把笔记搬回去。
 * 这里 id 是稳定的，位置降级成一个普通属性，位置变了改属性就行。
 *
 * 三种类型只差范围长短，因此共用同一份逻辑：
 * 单词是首尾同一个坐标，短语和句子是首尾不同的坐标。
 */
export type AnnotationType = 'word' | 'phrase' | 'sentence'

/**
 * 排序分组。
 *
 * 单词和短语在复习页是**同一列卡片**（短语本质也是词汇），
 * 所以它们必须排在同一条队里 —— 各编各的号的话，两套 0、1、2 混在一起
 * 按数值排，短语就会随机插到单词中间。句子自成一队。
 */
export type AnnotationGroup = 'vocab' | 'sentence'

export function annotationGroupOf(type: AnnotationType): AnnotationGroup {
  return type === 'sentence' ? 'sentence' : 'vocab'
}

export interface Annotation {
  /** 稳定身份。创建后永不改变 —— 位置、原文、内容怎么变都不影响它 */
  id: string
  /** 所属文档 ID */
  docId: string
  type: AnnotationType
  /**
   * 范围的起止坐标（anchorId，形如 `L0W2`）。单词标注首尾相同。
   *
   * 为 null 表示「原文已删除」：孤儿按定义就是没有位置的，这里如实记成没有。
   * 旧模型里做不到这点 —— 表以坐标为键，孤儿只好编一个假坐标 `orphan:xxx`
   * 免得和真坐标撞车。那个补丁在这里不需要了。
   */
  start: string | null
  end: string | null
  /**
   * 范围对应的原文。单词标注就是这个词本身。
   * 用于卡片显示，以及原文被删又改回来时按文字把标注找回来。
   *
   * 范围类标注（句摘、短语）的这一格**跟着正文走**：正文里删掉了句子中间的
   * 一个词，范围会往里收，这里也跟着变成收缩后的样子。当初划的那一句
   * 存进 sourceText，不会丢。
   */
  text: string
  /**
   * 用户当初划下这条范围标注时的原文。
   *
   * 正文被编辑、范围因此缩短或错位时才写进来，而且**只写第一次** ——
   * 后面再怎么改都不动它，因为它是「把这条标注还原成本来样子」的唯一依据。
   * 从前没有这一格，缩短时直接拿新文字把 text 覆盖掉，于是原句永久消失：
   * 你把删掉的词打回正文，句摘也回不来了（见 后续规划.md 第二十一节）。
   *
   * 正文和当初一致时**不存在**这个字段 —— 它同时也是卡片上
   * 「正文已改」那个记号的判断依据。
   */
  sourceText?: string
  /** 卡片排序。只在同一文档、同一类型内比较大小，数值本身无意义 */
  order: number
  createdAt: number

  // —— 单词 / 短语的内容 ——
  phonetic?: string
  pos?: string
  definition?: string
  /** 词的原形（stood -> stand）。目前不显示，留给以后接词典用 */
  lemma?: string

  // —— 句子的内容 ——
  /** 句型/语法说明 */
  grammar?: string
  /** 翻译或释义 */
  meaning?: string

  /**
   * 由 AI 自动填充，是一份「待复核清单」。
   * 用户手动改过之后应清掉此标记。
   */
  auto?: boolean
}

/** 是不是孤儿（原文已删除）。没有位置就是孤儿，不再单独存一个标记字段，省得两处打架 */
export function isOrphanAnnotation(a: Annotation): boolean {
  return a.start === null || a.end === null
}
