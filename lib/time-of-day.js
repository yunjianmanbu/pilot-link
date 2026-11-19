/**
 * 定时任务使用 HH:mm 字符串保存时间。底部时间选择器把它拆成小时/分钟两列，
 * 这里集中做解析和规范化，避免页面里各写一套补零和越界处理。
 */

const TIME_RE = /^(\d{1,2}):(\d{2})$/

export function parseTimeOfDay(value) {
  const match = TIME_RE.exec(String(value || '').trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

export function formatTimeOfDay(hour, minute) {
  const safeHour = Math.min(23, Math.max(0, Math.trunc(Number(hour) || 0)))
  const safeMinute = Math.min(59, Math.max(0, Math.trunc(Number(minute) || 0)))
  return `${String(safeHour).padStart(2, '0')}:${String(safeMinute).padStart(2, '0')}`
}

export function normalizeTimeOfDay(value, fallback = '09:00') {
  const parsed = parseTimeOfDay(value) || parseTimeOfDay(fallback) || { hour: 9, minute: 0 }
  return formatTimeOfDay(parsed.hour, parsed.minute)
}
