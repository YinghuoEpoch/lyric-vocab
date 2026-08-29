/**
 * 笔记各字段「该怎么写」的要求。
 *
 * 「一键填充」和「一键划词」是两条独立的提示词，但它们往同一批格子里写字 ——
 * 各写各的迟早会走样。**已经走样过一次**：填充要求「不是原形就在释义末尾
 * 补上原形」，划词却没这一条，于是同一本书里两种写法混着出现。
 *
 * 所以字段要求收在这里一份，两边的提示词都从它拼出来。
 * 改要求只改这里，不会漏掉另一边。
 */

/** 音标 */
export const PHONETIC_SPEC = `国际音标，两侧带斜杠，例如 /stʊd/。按该词在上下文中的实际读音标注。`

/** 词性 */
export const POS_SPEC = `词性缩写，用中文习惯写法，例如 n. / v. / adj. / adv. / prep. / conj.`

/**
 * 单词释义。两条硬要求：结合上下文选义项、非原形要补出原形。
 * 后者是用户明确要的 —— 看到 stood 时要知道它是 stand。
 */
export const DEFINITION_SPEC = `中文释义，简洁。**必须结合上下文选择该处真正的含义**，
  不要罗列多个义项。例如 stood 在 "I never stood up very tall" 中是「站立」，
  而在 "the offer stood" 中是「仍然有效」。
  **如果这个词不是原形（是过去式、过去分词、现在分词、复数、比较级等变形），
  就在释义末尾用括号补上原形和变形类型**，例如：
  flying -> 飞行；飞翔（fly 现在分词）
  stood -> 站立；挺立（stand 过去式）
  children -> 孩子们（child 复数）
  本身就是原形的词不要加括号，直接给释义即可。`

/** 原形。目前不显示，留给以后接词典用 */
export const LEMMA_SPEC = `该词的原形，例如 stood -> stand、bursting -> burst。本身就是原形则原样返回。`

/** 短语释义 */
export const PHRASE_DEFINITION_SPEC = `中文释义，简洁。**必须结合上下文选择该处真正的含义**，不要罗列多个义项。
  例如 take off 在 "the plane took off" 中是「起飞」，在 "he took off his coat" 中是「脱下」。
  **如果短语里的词不是原形（took off、looking forward to），
  就在释义末尾用括号补上原形**，例如：took off -> 起飞；脱下（take off 过去式）。`

/** 短语用法 */
export const PHRASE_USAGE_SPEC = `用法说明。写这个搭配怎么用 —— 后面接什么、常见于什么语境、有没有固定形式，
  20 到 40 字，具体一点。不要重复释义。
  例如 look forward to -> 「to 是介词，后面接名词或动名词，不接动词原形；多用于表达期待」`
