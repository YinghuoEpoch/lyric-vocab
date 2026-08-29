import type { Annotation, NotesMap, Sentence, WordNote } from '../types'
import { isOrphanAnnotation } from '../types'

/**
 * 标注表 -> 界面需要的「读模型」。
 *
 * 标注表是唯一的权威数据，但各处界面要的形状不一样：
 * 阅读页要按坐标快速查「这个词有没有笔记」，复习页要一张按顺序排好的卡片列表。
 * 这里把权威数据算成那些形状 —— 纯函数、只读，改数据一律回到标注表上改。
 *
 * 这不是「又搞了一套并行数据」：读模型每次都是从标注表算出来的，
 * 不落盘、不可写，不存在两份数据对不上的问题。
 */

/**
 * 标注在读模型里的键。
 *
 * 有位置的用坐标当键 —— 阅读页正是拿坐标来查的。
 * 孤儿没有位置，用它自己的 id；id 不可能长成 `L数字W数字`，所以不会和坐标撞车。
 */
export function annotationKey(a: Annotation): string {
  return a.start ?? a.id
}

export function annotationToWordNote(a: Annotation): WordNote {
  const note: WordNote = { word: a.text }
  if (a.phonetic !== undefined) note.phonetic = a.phonetic
  if (a.pos !== undefined) note.pos = a.pos
  if (a.definition !== undefined) note.definition = a.definition
  if (a.lemma !== undefined) note.lemma = a.lemma
  if (a.auto) note.auto = true
  if (isOrphanAnnotation(a)) note.orphaned = true
  return note
}

export function annotationToSentence(a: Annotation): Sentence {
  const s: Sentence = {
    id: a.id,
    text: a.text,
    grammar: a.grammar ?? '',
    meaning: a.meaning ?? '',
    docId: a.docId,
    startAnchorId: a.start ?? '',
    endAnchorId: a.end ?? '',
    date: a.createdAt
  }
  if (a.auto) s.auto = true
  if (isOrphanAnnotation(a)) s.orphaned = true
  return s
}

/**
 * 按文档分组的单词笔记表，形如 `{ 文档id: { 坐标: 笔记 } }`。
 *
 * 键的插入顺序就是 order 的顺序 —— 下游 Object.entries 取出来是什么次序，
 * 复习页的卡片就是什么次序，所以这里必须先排好再塞。
 */
export function buildNotesIndex(annotations: Annotation[]): Record<string, NotesMap> {
  const byDoc = new Map<string, Annotation[]>()
  for (const a of annotations) {
    // 只收单词。短语虽然也是「词汇」，但它占的是一段范围，
    // 塞进这张按坐标索引的表只会在首词底下画一条线，剩下几个词没有着落。
    // 阅读页另有一条短语的路（buildPhraseList）。
    if (a.type !== 'word') continue
    const list = byDoc.get(a.docId)
    if (list) list.push(a)
    else byDoc.set(a.docId, [a])
  }

  const out: Record<string, NotesMap> = {}
  for (const [docId, list] of byDoc) {
    list.sort((x, y) => x.order - y.order)
    const map: NotesMap = {}
    for (const a of list) {
      // 理论上不会撞键（对账保证一个坐标最多一条单词标注），
      // 真撞了也不能让后来的覆盖掉前一条 —— 退回用 id 当键，两条都留下
      const key = annotationKey(a)
      map[key in map ? a.id : key] = annotationToWordNote(a)
    }
    out[docId] = map
  }
  return out
}

/** 句摘列表，按 order 排好（同一文档内的相对次序就是卡片次序） */
export function buildSentenceList(annotations: Annotation[]): Sentence[] {
  return annotations
    .filter((a) => a.type === 'sentence')
    .sort((a, b) => a.order - b.order)
    .map(annotationToSentence)
}

/**
 * 在某篇文档里按坐标找一条单词标注。
 *
 * 只认 `word`：短语的首词坐标可能和某个单词标注相同，
 * 认了的话在那个词上长按会改到短语头上去。
 */
export function findWordAnnotation(
  annotations: Annotation[],
  docId: string,
  anchorId: string
): Annotation | undefined {
  return annotations.find((a) => a.docId === docId && a.type === 'word' && a.start === anchorId)
}

/** 短语的读模型：给阅读页画线、给抽屉预填 */
export interface PhraseView {
  id: string
  text: string
  /** 中文释义 */
  definition: string
  /** 用法 / 搭配说明。复用标注的 grammar 字段（句子那边装的是句型说明） */
  usage: string
  docId: string
  startAnchorId: string
  endAnchorId: string
  orphaned?: boolean
  auto?: boolean
}

export function annotationToPhrase(a: Annotation): PhraseView {
  const p: PhraseView = {
    id: a.id,
    text: a.text,
    definition: a.definition ?? '',
    usage: a.grammar ?? '',
    docId: a.docId,
    startAnchorId: a.start ?? '',
    endAnchorId: a.end ?? ''
  }
  if (a.auto) p.auto = true
  if (isOrphanAnnotation(a)) p.orphaned = true
  return p
}

/** 某篇文档里的短语，按 order 排好 */
export function buildPhraseList(annotations: Annotation[], docId: string): PhraseView[] {
  return annotations
    .filter((a) => a.type === 'phrase' && a.docId === docId)
    .sort((a, b) => a.order - b.order)
    .map(annotationToPhrase)
}

/**
 * 按读模型的键找一条标注：先当坐标找，找不到再当 id 找。
 * 复习页/右侧栏传回来的键两种都可能 —— 孤儿用的是 id。
 */
export function findAnnotationByKey(
  annotations: Annotation[],
  docId: string,
  key: string
): Annotation | undefined {
  return (
    findWordAnnotation(annotations, docId, key) ??
    // 短语在右侧栏里用的是首词坐标；同一坐标上若还有单词标注，上一行已经先认领了
    annotations.find((a) => a.docId === docId && a.type === 'phrase' && a.start === key) ??
    annotations.find((a) => a.id === key && a.docId === docId)
  )
}

/**
 * 在某篇文档里按范围找一条标注（句摘或短语）。
 *
 * 同一段范围可能既被标成短语又被标成句子，所以必须带上类型一起找，
 * 否则保存短语时会改到那条句摘头上。
 */
export function findRangeAnnotation(
  annotations: Annotation[],
  docId: string,
  startAnchorId: string,
  endAnchorId: string,
  type: 'sentence' | 'phrase' = 'sentence'
): Annotation | undefined {
  return annotations.find(
    (a) =>
      a.docId === docId &&
      a.type === type &&
      a.start === startAnchorId &&
      a.end === endAnchorId
  )
}

/** 右侧生词板的一条 */
export interface VocabItemView {
  word: string
  /** 有位置的用坐标，孤儿用 id —— 和 annotationKey 同一套 */
  anchorId: string
  pageId: string
  phonetic?: string
  pos?: string
  definition?: string
  orphaned?: boolean
  auto?: boolean
  /** 是短语不是单词 */
  isPhrase?: boolean
}

/**
 * 右侧生词板的清单：单词和短语**混在一起按 order 排**。
 *
 * 从前这份清单是分两步拼的（先塞全部单词、再把短语追加在末尾），
 * 于是短语永远排在所有单词后面，跟它在正文里的位置无关 ——
 * 而复习页走的是「一起筛出来一起排」，两边对不上。现在两边同一条路。
 *
 * order 是按排序分组编的（vocab 组 = 单词 + 短语），本来就可以直接比大小。
 */
export function buildVocabList(
  annotations: Annotation[],
  activePageIds: Set<string>
): VocabItemView[] {
  const byDoc = new Map<string, Annotation[]>()
  for (const a of annotations) {
    if (a.type === 'sentence' || !a.text || !activePageIds.has(a.docId)) continue
    const list = byDoc.get(a.docId)
    if (list) list.push(a)
    else byDoc.set(a.docId, [a])
  }

  const out: VocabItemView[] = []
  for (const [, list] of byDoc) {
    list.sort((x, y) => x.order - y.order)
    // 键撞车的处理跟 buildNotesIndex 一致：后来的退回用 id，两条都留下
    const usedKeys = new Set<string>()
    for (const a of list) {
      const key = annotationKey(a)
      const anchorId = usedKeys.has(key) ? a.id : key
      usedKeys.add(anchorId)
      const item: VocabItemView = { word: a.text, anchorId, pageId: a.docId }
      if (a.definition !== undefined) item.definition = a.definition
      if (a.auto) item.auto = true
      if (isOrphanAnnotation(a)) item.orphaned = true
      if (a.type === 'phrase') {
        // 短语没有音标 / 词性，那两格在卡片上根本不画
        item.isPhrase = true
      } else {
        if (a.phonetic !== undefined) item.phonetic = a.phonetic
        if (a.pos !== undefined) item.pos = a.pos
      }
      out.push(item)
    }
  }
  return out
}
