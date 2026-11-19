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

const LINK_PATTERN = /https?:\/\/[^\s<>"'`）)】\]]+/gi
const MAX_LINKS = 5

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
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') return ''
    return parsed.toString()
  } catch {
    return ''
  }
}

/** 链接按钮上显示的短标题：主机名 + 路径，太长就截断。 */
export function linkLabel(raw, maxLength = 42) {
  const text = String(raw || '').trim()
  if (!text) return ''
  let label = text
  try {
    const parsed = new URL(text)
    const rest = `${parsed.pathname}${parsed.search}`.replace(/\/$/, '')
    label = `${parsed.host}${rest === '/' ? '' : rest}`
  } catch {
    // 保留原样
  }
  if (label.length <= maxLength) return label
  return `${label.slice(0, Math.max(1, maxLength - 1))}…`
}
