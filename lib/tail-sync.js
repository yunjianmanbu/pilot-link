/**
 * 会话尾部同步的判定逻辑（纯函数，便于单测）。
 *
 * 背景：手机端只有在收到 run.started / run.completed 时才会重新拉历史。
 * 中继在手机短暂离线时会把发给手机的帧直接丢掉（不重放），App 切到后台、
 * 局域网与中继之间切换也都可能漏掉收尾事件；此时手机会停在上一页，
 * 「最后一轮问答」在会话里看不到，而知识库每次都重新请求电脑端，所以仍然能查到。
 *
 * 这里只负责判断「现在要不要补拉一页」，请求本身由 store 发起。
 */

/** 「最后一条是我的指令但没有回答」这个备选信号，最多每 30 秒用一次。 */
export const TAIL_FALLBACK_MS = 30_000

/** 最后一条消息是否是等待回答的用户指令（没有回答跟在后面）。 */
export function lastMessageUnanswered(messages) {
  const rows = Array.isArray(messages) ? messages : []
  if (rows.length === 0) return false
  const last = rows[rows.length - 1]
  if (!last || typeof last !== 'object') return false
  if (last.role !== 'user') return false
  // 有正文、图片或引用才算一次真正的提问。
  const blocks = Array.isArray(last.blocks) ? last.blocks : []
  return blocks.some(
    (block) => block && (block.type === 'text' || block.type === 'image' || block.type === 'reference')
  )
}

/**
 * @param {object} input
 *   connected / agentOnline  当前是否连着电脑端
 *   sessionId                当前会话
 *   loading                  历史正在加载
 *   focusMessageId           知识库定位窗口（用户主动停在中段）
 *   historyNewer             后面还有更新的消息，等用户点「回到最新」
 *   running                  电脑端报告该会话正在运行
 *   remoteCount              电脑端该会话当前的消息总数
 *   knownCount               本地这一页拉取时电脑端的消息总数
 *   streaming                本地还有未收尾的流式文本
 *   fallbackAt               上次用备选信号补拉的时间
 *   now                      当前时间
 *   last                     本地最后一条消息
 * @returns {{sync: boolean, fallback: boolean, reason: string}}
 */
export function decideTailSync(input) {
  const value = input && typeof input === 'object' ? input : {}
  const none = { sync: false, fallback: false, reason: 'idle' }
  if (!value.connected || !value.agentOnline) return { ...none, reason: 'offline' }
  if (!value.sessionId) return { ...none, reason: 'no-session' }
  if (value.loading) return { ...none, reason: 'loading' }
  if (value.focusMessageId || value.historyNewer) return { ...none, reason: 'pinned' }
  if (value.running) return { ...none, reason: 'running' }

  const remote = Number(value.remoteCount) || 0
  const known = Number(value.knownCount) || 0
  // 电脑端的消息数比本地这一页拉取时多了，说明尾部已经落后。
  if (remote > 0 && remote > known) return { sync: true, fallback: false, reason: 'behind' }

  const now = Number(value.now) || Date.now()
  const fallbackAt = Number(value.fallbackAt) || 0
  const throttled = now - fallbackAt < TAIL_FALLBACK_MS

  // 备选信号一：电脑端说没在跑，但本地还挂着流式文本，
  // 说明收尾事件丢了，界面会永远停在「执行中…」。
  if (value.streaming) {
    if (throttled) return { ...none, reason: 'throttled' }
    return { sync: true, fallback: true, reason: 'stale-stream' }
  }

  // 备选信号二：本地最后一条是我的提问，且没有回答跟着它。
  const last = Array.isArray(value.last)
    ? value.last
    : value.last
      ? [value.last]
      : []
  if (!lastMessageUnanswered(last)) return { ...none, reason: 'fresh' }
  if (throttled) return { ...none, reason: 'throttled' }
  return { sync: true, fallback: true, reason: 'unanswered' }
}
