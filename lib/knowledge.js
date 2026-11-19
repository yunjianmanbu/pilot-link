
import { t } from './i18n.js'

/**
 * 会话知识库：手机端的本地检索实现。
 *
 * 联网时直接调用电脑端的 sessions.search（能检索全部会话）；
 * 电脑离线或中继断开时，退回这台手机上缓存过的最近会话正文，
 * 保证知识库随时可查，同时明确告诉用户结果来自本机缓存。
 */

const MAX_QUERY_CHARS = 200
const MAX_HITS_PER_SESSION = 8
const MAX_HIGHLIGHT_SEGMENTS = 60

/** 与电脑端一致：忽略盘符大小写、斜杠方向和末尾分隔符。 */
export function pathKey(path) {
  return String(path || '')
    .trim()
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()
}

function toMillis(value) {
  const time = typeof value === 'number' ? value : Date.parse(String(value || ''))
  return Number.isFinite(time) ? time : 0
}

/** 只有用户与 Pilot 的正文参与检索，工具过程和内部续跑指令不算知识。 */
function messageText(message) {
  if (!message || typeof message !== 'object') return ''
  if (message.role !== 'user' && message.role !== 'assistant') return ''
  if (message.control === true) return ''
  const blocks = Array.isArray(message.blocks) ? message.blocks : null
  if (!blocks) return typeof message.content === 'string' ? message.content : ''
  return blocks
    .filter((block) => block && block.type === 'text')
    .map((block) => String(block.text || ''))
    .join('\n')
}

/** 换行替换成空格但保留字符串长度，让命中位置和截取区间保持一致。 */
function flatten(text) {
  return text.replace(/[\r\n\t]/g, ' ')
}

function snippetFor(text, index, length) {
  const start = Math.max(0, index - 48)
  const end = Math.min(text.length, index + length + 72)
  const piece = flatten(text.slice(start, end)).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${piece}${end < text.length ? '…' : ''}`
}

function sessionStamp(session) {
  return Math.max(
    Number(session?.lastModified) || 0,
    toMillis(session?.updatedAt),
    toMillis(session?.createdAt)
  )
}

/**
 * 在本机缓存里检索消息。
 *
 * @param {Array} sessions 会话列表（store.sessions，用来拿标题、工作区和排序）
 * @param {Object} histories loadHistoryCacheAll 的结果：sessionId -> { messages }
 * @param {string} query 关键词
 * @param {{ limit?: number, filter?: { workspacePath?: string, sessionId?: string, role?: string, since?: string } }} options
 * @returns {Array} 与电脑端 MessageSearchHit 同构的命中项
 */
export function searchLocalKnowledge(sessions, histories, query, options = {}) {
  const needle = String(query || '').trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_CHARS).toLowerCase()
  if (!needle) return []
  const limit = Math.max(1, Math.min(120, Math.round(Number(options.limit) || 60)))
  const filter = options.filter && typeof options.filter === 'object' ? options.filter : {}
  const workspace = filter.workspacePath ? pathKey(filter.workspacePath) : ''
  const sessionId = String(filter.sessionId || '').trim()
  const role = filter.role === 'user' || filter.role === 'assistant' ? filter.role : ''
  const sinceAt = filter.since ? toMillis(filter.since) : 0
  const cache = histories && typeof histories === 'object' ? histories : {}
  const ordered = [...(Array.isArray(sessions) ? sessions : [])].sort(
    (left, right) => sessionStamp(right) - sessionStamp(left)
  )
  const hits = []

  for (const session of ordered) {
    if (hits.length >= limit) break
    if (!session || typeof session.id !== 'string') continue
    if (sessionId && session.id !== sessionId) continue
    const workspacePath = String(session.workspacePath || session.cwd || '')
    if (workspace && pathKey(workspacePath) !== workspace) continue
    const entry = cache[session.id]
    const messages = entry && Array.isArray(entry.messages) ? entry.messages : []
    let found = 0
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (hits.length >= limit) break
      if (found >= MAX_HITS_PER_SESSION) break
      const message = messages[index]
      if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue
      const messageId = String(message.id || '')
      if (!messageId) continue
      if (role && message.role !== role) continue
      const createdAt = message.createdAt || message.timestamp || ''
      if (sinceAt) {
        const created = toMillis(createdAt)
        if (!created || created < sinceAt) continue
      }
      const text = messageText(message)
      if (!text) continue
      const match = flatten(text).toLowerCase().indexOf(needle)
      if (match < 0) continue
      hits.push({
        sessionId: session.id,
        sessionTitle: String(session.title || ''),
        workspacePath,
        messageId,
        role: message.role,
        snippet: snippetFor(text, match, needle.length),
        createdAt
      })
      found += 1
    }
  }
  return hits
}

/**
 * 把一段文字按关键词切成高亮片段，供页面渲染。
 * 返回 [{ text, hit }]，没有命中时返回单个片段。
 */
export function highlightParts(text, query) {
  const value = String(text || '')
  const needle = String(query || '').trim()
  if (!needle || !value) return [{ text: value, hit: false }]
  const haystack = value.toLowerCase()
  const target = needle.toLowerCase()
  const parts = []
  let cursor = 0
  let at = haystack.indexOf(target)
  let count = 0
  while (at >= 0 && count < MAX_HIGHLIGHT_SEGMENTS) {
    if (at > cursor) parts.push({ text: value.slice(cursor, at), hit: false })
    parts.push({ text: value.slice(at, at + needle.length), hit: true })
    cursor = at + needle.length
    count += 1
    at = haystack.indexOf(target, cursor)
  }
  if (cursor < value.length) parts.push({ text: value.slice(cursor), hit: false })
  return parts.length ? parts : [{ text: value, hit: false }]
}

// rich-text 只能吃内联样式；高亮在深浅主题下都用同一套蓝底，文字沿用原色。
const RICH_HIGHLIGHT = 'background:rgba(79,182,240,0.24);border-radius:3px;font-weight:600;'

function highlightTextNode(text, query) {
  const parts = highlightParts(text, query)
  if (parts.length === 1 && !parts[0].hit) return [{ type: 'text', text }]
  return parts.map((part) =>
    part.hit
      ? {
          name: 'span',
          attrs: { style: RICH_HIGHLIGHT },
          children: [{ type: 'text', text: part.text }]
        }
      : { type: 'text', text: part.text }
  )
}

/**
 * 在 renderMarkdown 生成的节点树里标出搜索关键词。
 * 只拆分 text 节点，保留标题、代码块、表格等结构。
 */
export function highlightMarkdownNodes(nodes, query) {
  const needle = String(query || '').trim()
  const list = Array.isArray(nodes) ? nodes : []
  if (!needle) return list
  const walk = (node) => {
    if (!node || typeof node !== 'object') return [node]
    if (node.type === 'text') return highlightTextNode(String(node.text ?? ''), needle)
    if (!Array.isArray(node.children)) return [node]
    const children = []
    for (const child of node.children) children.push(...walk(child))
    return [{ ...node, children }]
  }
  const output = []
  for (const node of list) output.push(...walk(node))
  return output
}

/**
 * 把一段会话整理成「我的指令 → Pilot 回复」的成对记录。
 *
 * 每条有正文的用户消息开一条记录，随后到下一条用户消息之前的
 * Pilot 文本都算这次回复；工具过程、思考、内部续跑指令不进入知识库。
 * 最后一条指令还没有回复时也会保留，页面标记为「等待回复」。
 */
export function buildKnowledgePairs(messages) {
  const pairs = []
  let current = null
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== 'object' || message.control === true) continue
    if (message.role === 'user') {
      const text = messageText(message).trim()
      const blocks = Array.isArray(message.blocks) ? message.blocks : []
      const hasImage =
        blocks.some((block) => block && block.type === 'image') ||
        (Array.isArray(message.images) && message.images.length > 0)
      const instruction = text || (hasImage ? t("[图片]") : '')
      if (!instruction) {
        // 工具结果记录也是 user 消息，它表示上一条指令的回复范围结束。
        current = null
        continue
      }
      current = {
        key: String(message.id || `pair-${pairs.length + 1}`),
        index: pairs.length + 1,
        instructionId: String(message.id || ''),
        instruction,
        instructionAt: message.createdAt || message.timestamp || '',
        replyId: '',
        replyAt: '',
        reply: '',
        replyCount: 0
      }
      pairs.push(current)
      continue
    }
    if (message.role !== 'assistant' || !current) continue
    const text = messageText(message).trim()
    if (!text) continue
    current.reply = current.reply ? `${current.reply}\n\n${text}` : text
    current.replyCount += 1
    if (!current.replyId) current.replyId = String(message.id || '')
    if (!current.replyAt) current.replyAt = message.createdAt || message.timestamp || ''
  }
  return pairs
}

/** 按关键词筛选成对记录；指令和回复都参与匹配，大小写不敏感。 */
export function filterKnowledgePairs(pairs, query) {
  const needle = String(query || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
  if (!needle) return Array.isArray(pairs) ? pairs : []
  return (Array.isArray(pairs) ? pairs : []).filter((pair) => {
    const instruction = String(pair?.instruction || '').toLowerCase()
    const reply = String(pair?.reply || '').toLowerCase()
    return instruction.includes(needle) || reply.includes(needle)
  })
}

/**
 * 知识库统一按时间倒序展示：最新一轮排在最上面。
 *
 * 电脑端整理好的配对是按会话时间正序返回的（旧的在最前），页面直接渲染就成了
 * 「从头往下翻」。这里只改展示顺序，不改 `index`（轮次编号仍是原始时间顺序），
 * 也不改缓存里存的正序本身——缓存读回时还要按正序 `slice` 取最近若干条。
 * 时间缺失时退回轮次编号，编号相同则用原位置兜底，保证顺序稳定。
 */
export function sortKnowledgePairsNewestFirst(pairs) {
  return (Array.isArray(pairs) ? pairs : [])
    .map((pair, position) => ({ pair, position }))
    .sort((left, right) => {
      const byTime = toMillis(right.pair?.instructionAt) - toMillis(left.pair?.instructionAt)
      if (byTime) return byTime
      const byIndex = (Number(right.pair?.index) || 0) - (Number(left.pair?.index) || 0)
      if (byIndex) return byIndex
      return right.position - left.position
    })
    .map((entry) => entry.pair)
}

export const KNOWLEDGE_LIMIT = 120
export const KNOWLEDGE_MIN_QUERY = 2
