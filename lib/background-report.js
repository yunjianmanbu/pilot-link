/**
 * 后台回到前台的诊断记录。
 *
 * 安卓可能「保住进程但断了网络」，也可能直接把进程回收；两种情况在界面上
 * 都表现为「重新连接」，只看界面分不清。这里在 onHide 时同步写一条标记，
 * 回到前台时按「会话 id 是否还是同一个」判断进程有没有活下来，并把结果
 * 落到本地存储，冷启动后仍能查看。
 */

export const BG_HIDE_KEY = 'pilot.background.hide'
export const BG_REPORT_KEY = 'pilot.background.report'

/** 每次 JS 运行时生成一次；进程被回收后重新生成，用来区分热回前台和冷启动。 */
export function createRuntimeSession(now = Date.now(), random = Math.random) {
  return `${now.toString(36)}-${Math.floor(random() * 1e9).toString(36)}`
}

export function readStoredJson(storage, key) {
  try {
    const raw = storage?.getStorageSync?.(key)
    if (!raw) return null
    if (typeof raw === 'object') return raw
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function writeStoredJson(storage, key, value) {
  try {
    storage?.setStorageSync?.(key, value)
    return true
  } catch {
    return false
  }
}

export function removeStoredKey(storage, key) {
  try {
    storage?.removeStorageSync?.(key)
  } catch {
    // 存储不可用时忽略：诊断信息丢失不影响连接。
  }
}

export function buildHideMarker({ session, at, connected, keepAlive }) {
  return {
    v: 1,
    session: String(session || ''),
    at: Number(at) || 0,
    connected: connected === true,
    keepAlive: String(keepAlive || '')
  }
}

/**
 * 返回 { kind, ms, wasConnected, error }：
 * - first：没有后台标记（首次启动，或上次没走 onHide）
 * - kept：同一进程，套接字仍连着
 * - dropped：同一进程，但套接字已经断了
 * - process-gone：JavaScript 运行时换了，说明进程被系统回收或 App 重新加载
 */
export function evaluateBackgroundReturn(
  marker,
  session,
  connected,
  error,
  now = Date.now()
) {
  if (!marker || !marker.session) return { kind: 'first', ms: 0, wasConnected: false }
  const ms = Math.max(0, Number(now) - (Number(marker.at) || 0))
  const wasConnected = marker.connected === true
  if (marker.session !== session) {
    return { kind: 'process-gone', ms, wasConnected }
  }
  if (connected === true) return { kind: 'kept', ms, wasConnected }
  return {
    kind: 'dropped',
    ms,
    wasConnected,
    error: String(error || '')
  }
}

/** 把毫秒拆成分钟/小时，具体文案由页面翻译，避免逻辑层写死中文。 */
export function backgroundDurationParts(ms) {
  const total = Math.max(0, Number(ms) || 0)
  const minutes = Math.floor(total / 60_000)
  if (minutes < 1) return { unit: 'short' }
  if (minutes < 60) return { unit: 'minutes', minutes }
  const hours = Math.floor(minutes / 60)
  return { unit: 'hours', hours, minutes: minutes % 60 }
}
