/**
 * 视频 / 音乐 / 网页链接的类型识别与文案。
 *
 * 和 files.js 一样不 import Vue：Node 单元测试可以直接跑这些纯函数。
 */

const VIDEO_TYPES = Object.freeze({
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  '3gp': 'video/3gpp'
})

const AUDIO_TYPES = Object.freeze({
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  flac: 'audio/flac',
  amr: 'audio/amr'
})

export function extensionOf(name) {
  const matched = /\.([^./\\]+)$/.exec(String(name || '').trim())
  return matched ? matched[1].toLowerCase() : ''
}

/** 'video' | 'audio' | '' */
export function mediaKindOf(name) {
  const ext = extensionOf(name)
  if (VIDEO_TYPES[ext]) return 'video'
  if (AUDIO_TYPES[ext]) return 'audio'
  return ''
}

export function isMediaName(name) {
  return Boolean(mediaKindOf(name))
}

export function mediaMimeOf(name) {
  const ext = extensionOf(name)
  return VIDEO_TYPES[ext] || AUDIO_TYPES[ext] || ''
}

/** 手机端有没有能力播放这个容器：mkv 之类常见但系统播放器常不支持。 */
export function mediaPlayableOnDevice(name) {
  const ext = extensionOf(name)
  return ext !== 'mkv' && ext !== 'ogv'
}

/**
 * 只收 RFC 3986 允许的 URL 字符（含百分号编码）。
 * 之前用「非空白即链接」的宽口径，中文正文紧跟链接时（例
 * `见 https://a.com/x。继续`）会把「。继续」一并吞进链接，
 * 变成一条打不开的地址。
 */
const LINK_PATTERN = /https?:\/\/[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+/gi
const MAX_LINKS = 5
/** `scheme://` 之后到第一个 `/?#` 之间是主机（可能带 userinfo 与端口）。 */
const URL_PARTS = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]*)([^?#]*)(\?[^#]*)?/i

/**
 * 拆出主机与路径。
 *
 * 刻意不用 `new URL()`：App 的逻辑层跑在 V8 / JSCore 里没有这个全局对象
 * （同 `lib/session-resources.js` 的说明）。这里一旦抛错，`trimUrl` 会把每条
 * 链接都当非法丢掉，手机上的现象就是助手回复下的链接按钮永远不出现。
 */
function urlPartsOf(raw) {
  const matched = URL_PARTS.exec(String(raw || '').trim())
  if (!matched) return null
  const authority = (() => {
    const raw = matched[1] || ''
    const at = raw.lastIndexOf('@')
    return (at >= 0 ? raw.slice(at + 1) : raw).trim()
  })()
  if (!authority || /[\s,;]/.test(authority)) return null
  const colon = authority.lastIndexOf(':')
  const host = (colon > 0 ? authority.slice(0, colon) : authority).toLowerCase()
  if (!host) return null
  return { authority, host, path: matched[2] || '', query: matched[3] || '' }
}

/**
 * 从一段消息里挑出可以直接点的链接。尾部的中文标点常被误当作 URL 的一部分，
 * 这里统一剪掉，并去重、限量，避免一条消息刷出一屏按钮。
 */
export function extractLinks(text, options = {}) {
  const source = String(text || '')
  if (!source || source.length > 40_000) return []
  const limit = Number(options.limit) > 0 ? Number(options.limit) : MAX_LINKS
  const found = []
  const seen = new Set()
  for (const match of source.matchAll(LINK_PATTERN)) {
    const url = trimUrl(match[0])
    if (!url) continue
    const key = url.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    found.push(url)
    if (found.length >= limit) break
  }
  return found
}

/** 去掉链接末尾的标点，并把不成对的右括号剪掉。 */
export function trimUrl(raw) {
  let url = String(raw || '').trim()
  if (!url) return ''
  for (;;) {
    const last = url[url.length - 1]
    if ('.,;:!?、。，；：！？）】」》'.includes(last)) {
      url = url.slice(0, -1)
      continue
    }
    if (last === ')' && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) {
      url = url.slice(0, -1)
      continue
    }
    break
  }
  if (!/^https?:\/\/[^\s]+$/i.test(url)) return ''
  const parts = urlPartsOf(url)
  if (!parts) return ''
  if (!parts.host.includes('.') && parts.host !== 'localhost') return ''
  return url
}

/** 链接按钮上显示的短标题：主机名 + 路径，太长就截断。 */
export function linkLabel(raw, maxLength = 42) {
  const text = String(raw || '').trim()
  if (!text) return ''
  const parts = urlPartsOf(text)
  const rest = `${parts ? parts.path : ''}${parts ? parts.query : ''}`.replace(/\/$/, '')
  const label = parts ? `${parts.authority}${rest}` : text
  if (label.length <= maxLength) return label
  return `${label.slice(0, Math.max(1, maxLength - 1))}…`
}

/**
 * 把一段正文切成「文字 / 链接」片段，供聊天正文内联渲染可点的链接。
 *
 * 剪掉的句末标点仍留在文字片段里，`text` 是原文里的那一段（显示用），
 * `url` 是去掉尾标点后的地址（打开用）。
 */
export function linkifySegments(text) {
  const source = String(text || '')
  if (!source) return []
  // 超长正文不做切分：输入框里的粘贴内容偶尔会是一整篇文章。
  if (source.length > 40_000) return [{ index: 0, kind: 'text', text: source }]
  const segments = []
  let last = 0
  for (const match of source.matchAll(LINK_PATTERN)) {
    const raw = match[0]
    const start = match.index || 0
    const url = trimUrl(raw)
    if (!url) continue
    const shown = raw.slice(0, url.length)
    if (start > last) {
      segments.push({ index: segments.length, kind: 'text', text: source.slice(last, start) })
    }
    segments.push({ index: segments.length, kind: 'link', text: shown, url })
    last = start + shown.length
  }
  if (!segments.length) return [{ index: 0, kind: 'text', text: source }]
  if (last < source.length) {
    segments.push({ index: segments.length, kind: 'text', text: source.slice(last) })
  }
  return segments
}
