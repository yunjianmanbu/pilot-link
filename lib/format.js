
import { t } from './i18n.js'

/** 展示用的小工具函数。 */

export function relativeTime(value) {
  const time = Number(value) || 0
  if (!time) return ''
  const diff = Date.now() - time
  if (diff < 60_000) return t("刚刚")
  if (diff < 3_600_000) return t("{v1} 分钟前", { v1: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return t("{v1} 小时前", { v1: Math.floor(diff / 3_600_000) })
  if (diff < 7 * 86_400_000) return t("{v1} 天前", { v1: Math.floor(diff / 86_400_000) })
  const date = new Date(time)
  return t("{v1} 月 {v2} 日", { v1: date.getMonth() + 1, v2: date.getDate() })
}

/** 低于这个可用空间时，安装依赖或构建容易因 ENOSPC 失败。 */
export const DISK_LOW_BYTES = 2 * 1024 * 1024 * 1024

/** 与桌面端同一套字节格式；读不到时返回破折号而不是 0。 */
export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '—'
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let scaled = value / 1024
  let unit = 0
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024
    unit += 1
  }
  return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(1)} ${units[unit]}`
}

export function fullTime(value) {
  const time = Number(value) || 0
  if (!time) return '—'
  const date = new Date(time)
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

/**
 * 会话里每条指令和回复的发送时间。
 *
 * 今天的消息只显示时:分；同一年更早的消息补上月-日；跨年再补年份。
 * 不用相对时间，因为滚动阅读历史消息时“3 天前”没法判断具体是哪一刻。
 */
export function messageTime(value, now = Date.now()) {
  const time = typeof value === 'number' ? value : Date.parse(String(value || ''))
  if (!Number.isFinite(time) || time <= 0) return ''
  const date = new Date(time)
  const current = new Date(now)
  const pad = (number) => String(number).padStart(2, '0')
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (
    date.getFullYear() === current.getFullYear() &&
    date.getMonth() === current.getMonth() &&
    date.getDate() === current.getDate()
  ) {
    return clock
  }
  if (date.getFullYear() === current.getFullYear()) {
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`
}

export function hostOf(url) {
  const match = /^(?:wss?|https?):\/\/([^/?#]+)/i.exec(String(url || ''))
  return match ? match[1] : String(url || '')
}

const PREFERRED_FIELDS = [
  'command',
  'file_path',
  'notebook_path',
  'path',
  'pattern',
  'url',
  'query',
  'description',
  'prompt'
]

export function summarizeToolInput(name, input) {
  if (!input) return ''
  let value = input
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input)
    } catch {
      return input.replace(/\s+/g, ' ').trim().slice(0, 140)
    }
  }
  if (!value || typeof value !== 'object') return String(value).slice(0, 140)
  const preferred = {
    Bash: ['command', 'description'],
    Read: ['file_path', 'path'],
    Write: ['file_path', 'path'],
    Edit: ['file_path', 'path'],
    NotebookEdit: ['notebook_path'],
    Glob: ['pattern', 'path'],
    Grep: ['pattern', 'path'],
    WebFetch: ['url'],
    WebSearch: ['query'],
    Agent: ['description', 'prompt'],
    Task: ['description', 'prompt']
  }[name] || []
  for (const key of [...preferred, ...PREFERRED_FIELDS]) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.replace(/\s+/g, ' ').trim().slice(0, 160)
    }
  }
  try {
    return JSON.stringify(value).slice(0, 160)
  } catch {
    return ''
  }
}

export function shortText(value, max = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

export function projectName(session) {
  const cwd = String(session?.cwd || '')
  if (!cwd) return session?.project || t("未分组")
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || session?.project || t("未分组")
}

export const MODE_LABELS = {
  auto: t("全部自动"),
  manual: t("只读自动"),
  ask: t("逐条审批"),
  // 旧数据标签，仅用于兼容历史会话。
  acceptEdits: t("全部自动"),
  plan: t("只读自动"),
  dontAsk: t("只读自动")
}
