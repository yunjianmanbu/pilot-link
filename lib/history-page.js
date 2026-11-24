/**
 * 「加载更早的消息」的分页判定（纯函数，便于单测）。
 *
 * 背景：一次 `sessions.get` 返回的是一页**原始消息**，而一段会话里绝大多数
 * 原始消息是工具调用与工具结果（实测对话正文只占 1–17%，典型 3%）。手机端
 * 只保留正文（`conversationOnly`），所以一页 25 条原始消息过滤后常常只剩
 * 0–3 条正文，甚至一条都不剩——界面看起来「点了没反应」，用户要连点很多次
 * 才能翻回上一轮问答。
 *
 * 现在的做法是两条腿：
 * 1. 新电脑端认 `conversation: true`，一页就按对话正文计数（一页 = 25 条问答）；
 * 2. 旧电脑端会忽略这个参数，于是这一页仍可能一条正文都没有。此时在同一次
 *    点击里继续往前补页，直到拿到正文、翻到头、或者补够上限为止。
 *
 * 这里只回答「还要不要继续补一页」，请求本身由 store 发起。
 */

/** 一次点击最多补几页。上限存在的意义是别让一次滑动把整段历史拉进内存。 */
export const EARLIER_MAX_ROUNDS = 6

/**
 * @param {object} input
 *   round             本次点击内已经请求过第几页（从 0 开始，即刚拿回的是第 round+1 页）
 *   received          这一页电脑端实际返回的原始消息条数
 *   conversationCount 这一页过滤后剩下的对话正文条数
 *   hasMore           电脑端是否还有更早的消息
 * @returns {boolean} true 表示在同一次点击里继续往前补一页
 */
export function earlierContinue({ round, received, conversationCount, hasMore }) {
  // 编造/丢帧的保护：没有新消息或已经翻到头，继续请求只会原地打转。
  if (hasMore !== true) return false
  if (!received) return false
  // 拿到正文就停：用户点一次就该看到上一轮问答，而不是一次吞下几十页。
  if (conversationCount > 0) return false
  return round + 1 < EARLIER_MAX_ROUNDS
}
