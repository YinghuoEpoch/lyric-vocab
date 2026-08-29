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
    if (a.type === 'sentence') continue
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

/** 在某篇文档里按坐标找一条单词标注 */
export function findWordAnnotation(
  annotations: Annotation[],
  docId: string,
  anchorId: string
): Annotation | undefined {
  return annotations.find(
    (a) => a.docId === docId && a.type !== 'sentence' && a.start === anchorId
  )
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
    annotations.find((a) => a.id === key && a.docId === docId)
  )
}

/** 在某篇文档里按范围找一条句摘标注 */
export function findRangeAnnotation(
  annotations: Annotation[],
  docId: string,
  startAnchorId: string,
  endAnchorId: string
): Annotation | undefined {
  return annotations.find(
    (a) =>
      a.docId === docId &&
      a.type === 'sentence' &&
      a.start === startAnchorId &&
      a.end === endAnchorId
  )
}
