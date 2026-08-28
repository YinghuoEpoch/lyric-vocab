/**
 * 「一键填充」的统一约定。
 *
 * 和导入层同一个思路：界面只认这份约定，具体谁来填（DeepSeek、别家 AI、
 * 将来的本地词典）都是可替换的实现，换供应商不必动界面。
 */

/** 待填充的单词。context 是它所在的那一行，用来判断在这句话里取哪个义项。 */
export interface WordTask {
  /** 在本次任务中唯一标识这个词，回填时按它对号入座 */
  id: string
  word: string
  /** 该词所在的整行原文；孤儿笔记可能没有上下文 */
  context?: string
}

export interface SentenceTask {
  id: string
  text: string
}

export interface WordFill {
  phonetic?: string
  pos?: string
  definition?: string
  /** 原形，stood -> stand。留给以后接词典用。 */
  lemma?: string
}

export interface SentenceFill {
  grammar?: string
  meaning?: string
}

export interface Enricher {
  /** 供界面显示的名称 */
  name: string
  /**
   * 填一批单词。返回值按 task.id 索引；模型漏掉的条目直接不出现在结果里，
   * 上层据此判断哪些没填上。
   */
  fillWords(tasks: WordTask[], signal?: AbortSignal): Promise<Record<string, WordFill>>
  fillSentences(tasks: SentenceTask[], signal?: AbortSignal): Promise<Record<string, SentenceFill>>
}
