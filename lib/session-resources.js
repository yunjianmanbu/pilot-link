/**
 * 会话资源：任务卡片上的「链接」与「工具」预览。
 *
 * 联网时数据来自电脑端的 `sessions.links` / `sessions.tools`；
 * 电脑端离线、或装的还是旧版本（没有这两个方法）时，这里退成本地实现：
 * 链接从手机缓存的会话正文里就地提取，工具则没有本地来源，直接空列表 +
 * 一句说明。所有函数都是纯函数，方便单测。
 */

const SESSION_LINK_LIMIT = 60
const SESSION_TOOL_LIMIT = 120
const MAX_URL_CHARS = 2_000
const MAX_CONTEXT_CHARS = 120
const MAX_DESCRIPTION_CHARS = 320

/** 句末标点属于句子，不属于链接。 */
const TRAILING = /[.,;:!?、，。；：！？"'”’）\]】」》>]+$/
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/g
/** `scheme://` 之后到第一个 `/?#` 之间是主机（可能带 userinfo 与端口）。 */
const AUTHORITY_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]*)/

/**
 * 去掉链接末尾的句末标点。右括号只在没有配对左括号时才去掉，
 * 这样 `.../Foo_(bar)` 这类维基链接能保持完整。
 */
export function tidyUrl(raw) {
  let url = String(raw || '').trim()
  if (url.length > MAX_URL_CHARS) url = url.slice(0, MAX_URL_CHARS)
  for (;;) {
    const opens = (url.match(/\(/g) || []).length
    const closes = (url.match(/\)/g) || []).length
    if (url.endsWith(')') && closes > opens) {
      url = url.slice(0, -1)
      continue
    }
    const stripped = url.replace(TRAILING, '')
    if (stripped === url) return url
    url = stripped
  }
}

/**
 * 主机名去掉 `www.`；解析不了时返回空串，调用方据此丢弃。
 *
 * 刻意不用 `new URL()`：App 的逻辑层跑在 V8 / JSCore 里没有这个全局对象
 * （同 `lib/update.js` 的说明），一旦抛错，`normalizeSessionLinks` 会把每一条
 * 链接都当非法丢掉——手机上的现象就是「N 条链接 · 只显示最近 0 条」加空白列表。
 * 端口保留，与 `URL.host` 的口径一致。
 */
export function hostOf(url) {
  const text = String(url || '').trim()
  if (!text) return ''
  const match = AUTHORITY_PATTERN.exec(text)
  if (!match) return ''
  // `user:pass@host:port` 里只有 @ 之后是主机。
  const raw = match[1]
  const at = raw.lastIndexOf('@')
  const host = (at >= 0 ? raw.slice(at + 1) : raw).trim()
  if (!host || /[\s,;]/.test(host)) return ''
  return host.toLowerCase().replace(/^www\./, '')
}

function clip(text, limit) {
  const value = String(text || '')
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

/** 消息正文取第一行有内容的文字，并把链接本身去掉（否则上下文等于链接）。 */
function contextOf(content) {
  const lines = String(content || '')
    .split('\n')
    .map((line) => line.replace(URL_PATTERN, ' ').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
  const first = lines.find((line) => line.replace(/[#>*\-\s]/g, '').length > 0) || ''
  return clip(first, MAX_CONTEXT_CHARS)
}

/** 一条消息的纯文本：优先 blocks 里的 text，其次 content。 */
function textOf(message) {
  if (!message || typeof message !== 'object') return ''
  const blocks = Array.isArray(message.blocks) ? message.blocks : null
  if (!blocks) return typeof message.content === 'string' ? message.content : ''
  return blocks
    .filter((block) => block && block.type === 'text')
    .map((block) => String(block.text || ''))
    .join('\n')
}

/**
 * 电脑端不支持 `sessions.links` 时的本地兜底：从已缓存的会话正文里提取链接。
 * 规则与电脑端 collectSessionLinks 一致——只算用户与 Pilot 的正文，
 * 跳过内部续跑指令，按最后一次出现的位置从新到旧排序。
 */
export function extractSessionLinks(messages, limit = SESSION_LINK_LIMIT) {
  const rows = Array.isArray(messages) ? messages : []
  const byUrl = new Map()
  const lastSeen = new Map()
  let index = 0
  for (const message of rows) {
    index += 1
    if (!message || typeof message !== 'object') continue
    if (message.role !== 'user' && message.role !== 'assistant') continue
    if (message.role === 'user' && (message.internal === true || message.control === true)) continue
    const content = textOf(message)
    if (!content) continue
    URL_PATTERN.lastIndex = 0
    for (const match of content.matchAll(URL_PATTERN)) {
      const url = tidyUrl(match[0])
      if (url.length <= 'https://'.length) continue
      const host = hostOf(url)
      if (!host) continue
      lastSeen.set(url, index)
      const existing = byUrl.get(url)
      if (existing) {
        existing.count += 1
        continue
      }
      byUrl.set(url, {
        url,
        host,
        role: message.role,
        messageId: String(message.id || ''),
        createdAt: message.createdAt || '',
        context: contextOf(content),
        count: 1
      })
    }
  }
  const ordered = [...byUrl.values()].sort(
    (left, right) => (lastSeen.get(right.url) || 0) - (lastSeen.get(left.url) || 0)
  )
  return ordered.slice(0, Math.max(1, Math.min(SESSION_LINK_LIMIT, limit)))
}

/** 整理电脑端 `sessions.links` 的返回，丢弃解析不出主机名的条目。 */
export function normalizeSessionLinks(raw, limit = SESSION_LINK_LIMIT) {
  const rows = Array.isArray(raw) ? raw : []
  const out = []
  const seen = new Set()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const url = tidyUrl(row.url)
    if (!url || seen.has(url)) continue
    const host = hostOf(url)
    if (!host) continue
    seen.add(url)
    out.push({
      url,
      host,
      role: row.role === 'assistant' ? 'assistant' : 'user',
      messageId: String(row.messageId || ''),
      createdAt: row.createdAt || '',
      context: clip(row.context || '', MAX_CONTEXT_CHARS),
      count: Math.max(1, Number(row.count) || 1)
    })
    if (out.length >= Math.max(1, Math.min(SESSION_LINK_LIMIT, limit))) break
  }
  return out
}

const RISK_KEYS = {
  read: '只读',
  write: '写文件',
  exec: '命令',
  control: '控制'
}

const SOURCE_KEYS = {
  builtin: '内置',
  control: '控制',
  mcp: 'MCP',
  dynamic: '自写'
}

/** 风险等级的中文标签（页面再套 t() 翻译）。未知等级按最保守的「命令」显示。 */
export function toolRiskLabel(risk) {
  return RISK_KEYS[String(risk || '')] || RISK_KEYS.exec
}

/** 工具来源的中文标签。 */
export function toolSourceLabel(source) {
  return SOURCE_KEYS[String(source || '')] || SOURCE_KEYS.builtin
}

/**
 * 整理电脑端 `sessions.tools` 的返回：补上面向用户的标签，标记不可用原因，
 * 并丢弃没有名字的条目。
 */
export function normalizeSessionTools(raw, limit = SESSION_TOOL_LIMIT) {
  const rows = Array.isArray(raw) ? raw : []
  const out = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const name = String(row.name || '').trim()
    if (!name) continue
    out.push({
      name,
      description: clip(row.description || '', MAX_DESCRIPTION_CHARS),
      risk: String(row.risk || 'exec'),
      riskLabel: toolRiskLabel(row.risk),
      source: String(row.source || 'builtin'),
      sourceLabel: toolSourceLabel(row.source),
      enabled: row.enabled !== false,
      approved: row.approved === true,
      version: Number(row.version) || 0
    })
    if (out.length >= Math.max(1, Math.min(SESSION_TOOL_LIMIT, limit))) break
  }
  return out
}

export { MAX_CONTEXT_CHARS, MAX_DESCRIPTION_CHARS, SESSION_LINK_LIMIT, SESSION_TOOL_LIMIT }