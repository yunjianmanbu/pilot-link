/**
 * 本地持久化：配对信息、手机标识、每个会话的执行模式。
 * 配对信息（含端到端密钥与收发序号）保存后，App 重启可自动重连，
 * 不需要再次扫码；只有连续 7 天未使用才会被中继要求重新配对。
 */

import { randomBase64url } from './bytes.js'
import { t } from './i18n.js'

const PAIRING_KEY = 'pilot-app.pairing.v1'
const PAIRINGS_KEY = 'pilot-app.pairings.v2'
const PHONE_ID_KEY = 'pilot-app.phone-id.v1'
const PHONE_NAME_KEY = 'pilot-app.phone-name.v1'
const MODES_KEY = 'pilot-app.session-modes.v1'
const UPDATE_WGT_KEY = 'pilot-app.update-wgt.v1'
const UPDATE_CHECK_KEY = 'pilot-app.update-check.v1'
const THEME_KEY = 'pilot-app.theme.v1'
const FONT_SIZE_KEY = 'pilot-app.font-size.v1'
const CONTRAST_KEY = 'pilot-app.contrast.v1'
const SATURATION_KEY = 'pilot-app.saturation.v1'
const ACCENT_KEY = 'pilot-app.accent.v1'
const BUTTON_SCHEME_KEY = 'pilot-app.button-scheme.v1'
const SESSIONS_CACHE_KEY = 'pilot-app.sessions-cache.v1'
const SESSIONS_CACHE_VERSION = 1
const SESSIONS_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000
const UNREAD_KEY = 'pilot-app.unread.v1'
const UNREAD_VERSION = 1
const UNREAD_LIMIT = 200
const TODOS_CACHE_KEY = 'pilot-app.todos-cache.v1'
const TODOS_CACHE_VERSION = 1
const OFFLINE_TODOS_KEY = 'pilot-app.offline-todos.v1'
const OFFLINE_TODOS_VERSION = 1
const HISTORY_CACHE_KEY = 'pilot-app.history-cache.v1'
const HISTORY_CACHE_VERSION = 1
const KNOWLEDGE_CACHE_KEY = 'pilot-app.knowledge-cache.v1'
const KNOWLEDGE_CACHE_VERSION = 1
const OFFLINE_CACHE_MAX_AGE = SESSIONS_CACHE_MAX_AGE
const TODOS_CACHE_SESSION_LIMIT = 50
const TODOS_CACHE_ITEM_LIMIT = 200
const OFFLINE_TODO_LIMIT = 100
const HISTORY_CACHE_SESSION_LIMIT = 6
const HISTORY_CACHE_MESSAGE_LIMIT = 25
const HISTORY_CACHE_MAX_LENGTH = 2 * 1024 * 1024
const KNOWLEDGE_CACHE_SESSION_LIMIT = 8
const KNOWLEDGE_CACHE_PAIR_LIMIT = 80
const KNOWLEDGE_CACHE_FIELD_LIMIT = 12_000
const KNOWLEDGE_CACHE_MAX_LENGTH = 2 * 1024 * 1024

export const PAIRING_IDLE_MS = 7 * 24 * 60 * 60 * 1000

function readJson(key) {
  try {
    const raw = uni.getStorageSync(key)
    if (!raw) return null
    if (typeof raw === 'object') return raw
    return JSON.parse(String(raw))
  } catch {
    return null
  }
}

function writeJson(key, value) {
  try {
    uni.setStorageSync(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function toSeq(value, fallback) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback
}

/** 旧数据没有 lanUrls 字段时，用私有地址判断这条地址是不是直连。 */
function isLanHost(url) {
  const match = /^wss?:\/\/([^/?#]+)/i.exec(String(url || ''))
  if (!match) return false
  const host = match[1].replace(/^\[|\]$/g, '').split(':')[0]
  if (host === 'localhost' || host.endsWith('.local')) return true
  const parts = host.split('.').map(Number)
  if (parts.length !== 4) return false
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  if (parts[0] === 10 || parts[0] === 127) return true
  if (parts[0] === 192 && parts[1] === 168) return true
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
  return false
}

export function normalizePairing(value) {
  if (!value || typeof value !== 'object') return null
  if (value.v !== 1) return null
  if (typeof value.relayUrl !== 'string' || !value.relayUrl) return null
  if (typeof value.deviceId !== 'string' || !value.deviceId) return null
  if (typeof value.phoneId !== 'string' || !value.phoneId) return null
  if (typeof value.token !== 'string' || value.token.length < 20) return null
  if (!value.keys || typeof value.keys.pcToPhone !== 'string' || typeof value.keys.phoneToPc !== 'string') {
    return null
  }
  // 局域网直连地址单独保存：中继地址会因为切换到直连而被改写，
  // 但下次回到同一网络时仍然需要这些地址优先重连。
  const lanUrls = []
  const addLan = (url) => {
    if (typeof url !== 'string' || !/^wss?:\/\//i.test(url)) return
    if (!lanUrls.includes(url)) lanUrls.push(url)
  }
  // 旧数据没有 relayWrapped 字段：带房间号的地址是云端中继，
  // 没有房间号的私有地址才是直连。
  const primaryWrapped =
    value.relayWrapped === true ||
    (value.relayWrapped === undefined && Boolean(value.room && value.roomKey))
  const primaryDirect =
    !primaryWrapped && (value.relayWrapped === false || isLanHost(value.relayUrl))
  const fallbackDirect =
    value.fallbackWrapped === false ||
    (value.fallbackWrapped === undefined && isLanHost(value.fallbackUrl))
  for (const url of Array.isArray(value.lanUrls) ? value.lanUrls : []) addLan(url)
  if (primaryDirect) addLan(value.relayUrl)
  if (fallbackDirect) addLan(value.fallbackUrl)
  return {
    v: 1,
    relayUrl: value.relayUrl,
    relayWrapped: primaryWrapped,
    fallbackUrl: typeof value.fallbackUrl === 'string' ? value.fallbackUrl : '',
    fallbackWrapped: value.fallbackWrapped === true,
    lanUrls: lanUrls.slice(0, 8),
    room: typeof value.room === 'string' ? value.room : '',
    roomKey: typeof value.roomKey === 'string' ? value.roomKey : '',
    // 中继准入码：没开 STRICT 的中继不需要，旧数据也不会有，缺省为空串。
    access: typeof value.access === 'string' ? value.access : '',
    deviceId: value.deviceId,
    deviceName: typeof value.deviceName === 'string' ? value.deviceName : '',
    phoneId: value.phoneId,
    phoneName: typeof value.phoneName === 'string' ? value.phoneName : '',
    token: value.token,
    keys: { pcToPhone: value.keys.pcToPhone, phoneToPc: value.keys.phoneToPc },
    outSeq: toSeq(value.outSeq, 0),
    inSeq: toSeq(value.inSeq, 1),
    pairedAt: Number(value.pairedAt) || 0,
    lastActiveAt: Number(value.lastActiveAt) || Number(value.pairedAt) || 0
  }
}

/** 多台电脑的配对集合；一台电脑以 deviceId 区分。 */
export function normalizePairingCollection(value) {
  const items = []
  const seen = new Set()
  const list = Array.isArray(value?.items) ? value.items : []
  for (const entry of list) {
    const pairing = normalizePairing(entry)
    if (!pairing || seen.has(pairing.deviceId)) continue
    seen.add(pairing.deviceId)
    items.push(pairing)
  }
  const requested = typeof value?.activeId === 'string' ? value.activeId : ''
  const activeId = items.some((item) => item.deviceId === requested)
    ? requested
    : items[0]?.deviceId || ''
  return { v: 2, activeId, items }
}

export function loadPairings() {
  const stored = readJson(PAIRINGS_KEY)
  if (stored) return normalizePairingCollection(stored)
  // 从 1.0.10 之前的单配对升级：迁移成一台电脑，不丢已有配对。
  const legacy = normalizePairing(readJson(PAIRING_KEY))
  if (!legacy) return { v: 2, activeId: '', items: [] }
  const migrated = { v: 2, activeId: legacy.deviceId, items: [legacy] }
  writeJson(PAIRINGS_KEY, migrated)
  try {
    uni.removeStorageSync(PAIRING_KEY)
  } catch {
    // ignore
  }
  return migrated
}

export function loadPairing() {
  const data = loadPairings()
  return data.items.find((item) => item.deviceId === data.activeId) || null
}

/** 新增或更新一台电脑的配对；不会改变当前激活的电脑。 */
export function savePairing(pairing) {
  const normalized = normalizePairing(pairing)
  if (!normalized) return false
  const data = loadPairings()
  const index = data.items.findIndex((item) => item.deviceId === normalized.deviceId)
  if (index >= 0) data.items[index] = normalized
  else data.items.push(normalized)
  if (!data.activeId) data.activeId = normalized.deviceId
  return writeJson(PAIRINGS_KEY, { v: 2, activeId: data.activeId, items: data.items })
}

/** 切换当前电脑，返回最新的配对集合。 */
export function setActivePairing(deviceId) {
  const data = loadPairings()
  if (data.items.some((item) => item.deviceId === deviceId)) data.activeId = deviceId
  writeJson(PAIRINGS_KEY, data)
  return data
}

/** 移除一台电脑；如果移除的是当前电脑，自动把第一台剩下的设为当前。 */
export function removePairing(deviceId) {
  const data = loadPairings()
  data.items = data.items.filter((item) => item.deviceId !== deviceId)
  if (!data.items.some((item) => item.deviceId === data.activeId)) {
    data.activeId = data.items[0]?.deviceId || ''
  }
  writeJson(PAIRINGS_KEY, data)
  return data
}

export function clearPairing(deviceId) {
  const target = deviceId || loadPairings().activeId
  return removePairing(target)
}

export function clearAllPairings() {
  try {
    uni.removeStorageSync(PAIRINGS_KEY)
    uni.removeStorageSync(PAIRING_KEY)
  } catch {
    // ignore
  }
}

/** 本地先判断 7 天有效期，避免明显过期的配对还去连服务器。 */
export function pairingExpiredLocally(pairing, now = Date.now()) {
  const last = Number(pairing?.lastActiveAt || pairing?.pairedAt || 0)
  if (!last) return false
  return now - last > PAIRING_IDLE_MS
}

export function loadPhoneId() {
  try {
    const stored = String(uni.getStorageSync(PHONE_ID_KEY) || '').trim()
    if (/^[A-Za-z0-9_-]{16,64}$/.test(stored)) return stored
  } catch {
    // ignore
  }
  const generated = randomBase64url(18)
  try {
    uni.setStorageSync(PHONE_ID_KEY, generated)
  } catch {
    // ignore
  }
  return generated
}

export function defaultPhoneName() {
  try {
    const info = uni.getSystemInfoSync()
    const brand = String(info.brand || '').trim()
    const model = String(info.model || '').trim()
    const name = [brand, model].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
    if (name) return name.slice(0, 40)
  } catch {
    // ignore
  }
  return t("我的手机")
}

export function loadPhoneName() {
  try {
    const stored = String(uni.getStorageSync(PHONE_NAME_KEY) || '').trim()
    if (stored) return stored.slice(0, 40)
  } catch {
    // ignore
  }
  return defaultPhoneName()
}

export function savePhoneName(name) {
  const value = String(name || '').trim().slice(0, 40)
  if (!value) return
  try {
    uni.setStorageSync(PHONE_NAME_KEY, value)
  } catch {
    // ignore
  }
}

/** 界面主题：system / light / dark。 */
export function loadThemeMode() {
  try {
    const value = String(uni.getStorageSync(THEME_KEY) || '')
    if (value === 'light' || value === 'dark' || value === 'system') return value
  } catch {
    // ignore
  }
  return 'system'
}

export function saveThemeMode(mode) {
  const value = mode === 'light' || mode === 'dark' ? mode : 'system'
  try {
    uni.setStorageSync(THEME_KEY, value)
  } catch {
    // ignore
  }
}

/** 字号：standard（默认，保持原字号）/ large / xlarge。 */
export function loadFontSize() {
  try {
    const value = String(uni.getStorageSync(FONT_SIZE_KEY) || '')
    if (value === 'standard' || value === 'large' || value === 'xlarge') return value
  } catch {
    // ignore
  }
  return 'standard'
}

export function saveFontSize(size) {
  const value = size === 'large' || size === 'xlarge' ? size : 'standard'
  try {
    uni.setStorageSync(FONT_SIZE_KEY, value)
  } catch {
    // ignore
  }
}

/** 对比度 / 饱和度：low / standard（默认）/ high。 */
function loadLevel(key) {
  try {
    const value = String(uni.getStorageSync(key) || '')
    if (value === 'low' || value === 'standard' || value === 'high') return value
  } catch {
    // ignore
  }
  return 'standard'
}

function saveLevel(key, level) {
  const value = level === 'low' || level === 'high' ? level : 'standard'
  try {
    uni.setStorageSync(key, value)
  } catch {
    // ignore
  }
}

/** 界面对比度：low / standard（默认）/ high。 */
export function loadContrast() {
  return loadLevel(CONTRAST_KEY)
}

export function saveContrast(contrast) {
  saveLevel(CONTRAST_KEY, contrast)
}

/** 界面饱和度：low / standard（默认）/ high。 */
export function loadSaturation() {
  return loadLevel(SATURATION_KEY)
}

export function saveSaturation(saturation) {
  saveLevel(SATURATION_KEY, saturation)
}

/** 主题配色：graphite（默认黑白）/ pine / indigo / clay / celadon / claude，与电脑端一致。 */
export function loadAccent() {
  try {
    const value = String(uni.getStorageSync(ACCENT_KEY) || '')
    if (
      value === 'graphite' ||
      value === 'pine' ||
      value === 'indigo' ||
      value === 'clay' ||
      value === 'ocean' ||
      value === 'moss' ||
      value === 'plum' ||
      value === 'rose' ||
      value === 'sand' ||
      value === 'orange' ||
      value === 'celadon' ||
      value === 'claude'
    ) {
      return value
    }
  } catch {
    // ignore
  }
  return 'graphite'
}

export function saveAccent(accent) {
  const value =
    accent === 'pine' ||
    accent === 'indigo' ||
    accent === 'clay' ||
    accent === 'ocean' ||
    accent === 'moss' ||
    accent === 'plum' ||
    accent === 'rose' ||
    accent === 'sand' ||
    accent === 'orange' ||
    accent === 'celadon' ||
    accent === 'claude'
      ? accent
      : 'graphite'
  try {
    uni.setStorageSync(ACCENT_KEY, value)
  } catch {
    // ignore
  }
}

/** 按钮配色方案：accent（跟随主题）/ mono（黑白）/ soft（柔和）/ outline（分层填充）。 */
export function normalizeButtonScheme(value) {
  return value === 'mono' || value === 'soft' || value === 'outline' ? value : 'accent'
}

export function loadButtonScheme() {
  try {
    return normalizeButtonScheme(String(uni.getStorageSync(BUTTON_SCHEME_KEY) || ''))
  } catch {
    return 'accent'
  }
}

export function saveButtonScheme(scheme) {
  try {
    uni.setStorageSync(BUTTON_SCHEME_KEY, normalizeButtonScheme(scheme))
  } catch {
    // ignore
  }
}

export function loadSessionModes() {
  const value = readJson(MODES_KEY)
  if (!value || typeof value !== 'object') return {}
  const result = {}
  for (const [key, mode] of Object.entries(value)) {
    if (mode === 'auto' || mode === 'readonly' || mode === 'ask') result[key] = mode
  }
  return result
}

export function saveSessionModes(modes) {
  writeJson(MODES_KEY, modes)
}

/* ------------------------------------------------------------------ */
/* 输入框草稿                                                          */
/* ------------------------------------------------------------------ */

const DRAFTS_KEY = 'pilot-app.drafts.v1'
const DRAFT_LIMIT = 50
const DRAFT_TEXT_LIMIT = 20_000
const DRAFT_REFERENCE_LIMIT = 8
const DRAFT_REFERENCE_LENGTH = 500

function normalizeDraft(value) {
  if (!value || typeof value !== 'object') return null
  const text = typeof value.text === 'string' ? value.text.slice(0, DRAFT_TEXT_LIMIT) : ''
  const references = Array.isArray(value.references)
    ? [...new Set(
        value.references
          .filter((item) => typeof item === 'string' && item.trim())
          .map((item) => item.slice(0, DRAFT_REFERENCE_LENGTH))
      )].slice(0, DRAFT_REFERENCE_LIMIT)
    : []
  if (!text.trim() && !references.length) return null
  const at = Number(value.at)
  return {
    text,
    references,
    at: Number.isSafeInteger(at) && at > 0 ? at : Date.now()
  }
}

/** 全部输入框草稿，按会话 / 新建工作区分键。 */
export function loadDrafts() {
  const stored = readJson(DRAFTS_KEY)
  if (!stored || typeof stored !== 'object') return {}
  const drafts = {}
  for (const [key, value] of Object.entries(stored)) {
    if (!key) continue
    const draft = normalizeDraft(value)
    if (draft) drafts[key] = draft
  }
  return drafts
}

/** 读取单个草稿；没有就返回 null。 */
export function loadDraft(key) {
  const name = String(key || '')
  if (!name) return null
  return loadDrafts()[name] || null
}

/**
 * 保存输入框草稿。草稿为空时等同于删除。
 * 只保留最近 50 个有内容的草稿，避免长期使用后无限增长。
 */
export function saveDraft(key, draft) {
  const name = String(key || '')
  if (!name) return false
  const drafts = loadDrafts()
  // 同一毫秒里连续保存多个会话时，用递增时间保证「最后写的」一定最新，
  // 否则淘汰顺序会变成按插入顺序，可能删掉刚写的草稿。
  let at = Date.now()
  for (const item of Object.values(drafts)) {
    if (item.at >= at) at = item.at + 1
  }
  const value = normalizeDraft({ ...draft, at })
  if (!value) delete drafts[name]
  else drafts[name] = value
  const entries = Object.entries(drafts).sort((left, right) => right[1].at - left[1].at)
  for (const [stale] of entries.slice(DRAFT_LIMIT)) delete drafts[stale]
  return writeJson(DRAFTS_KEY, drafts)
}

export function clearDraft(key) {
  const name = String(key || '')
  if (!name) return false
  const drafts = loadDrafts()
  if (!(name in drafts)) return true
  delete drafts[name]
  return writeJson(DRAFTS_KEY, drafts)
}

/** 上次检查更新的时间（毫秒），用于启动时 6 小时节流。 */
export function loadUpdateCheckAt() {
  try {
    const value = Number(uni.getStorageSync(UPDATE_CHECK_KEY))
    return Number.isSafeInteger(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

export function saveUpdateCheckAt(value) {
  try {
    const time = Number(value)
    uni.setStorageSync(UPDATE_CHECK_KEY, String(Number.isSafeInteger(time) && time > 0 ? time : Date.now()))
  } catch {
    // ignore
  }
}

/**
 * 已经通过 wgt 资源热更应用到的版本号。
 *
 * 正常情况下 wgt 安装后 plus.runtime.version 会跟着变成资源包版本，但个别机型
 * 重启后仍读到壳版本，会出现「同一个更新反复提示」。这里记一份本地兜底。
 */
export function loadAppliedWgtVersion() {
  try {
    const value = String(uni.getStorageSync(UPDATE_WGT_KEY) || '').trim()
    return /^[0-9][0-9._-]*$/.test(value) ? value : ''
  } catch {
    return ''
  }
}

export function saveAppliedWgtVersion(version) {
  try {
    const value = String(version || '').trim()
    if (!/^[0-9][0-9._-]*$/.test(value)) return
    uni.setStorageSync(UPDATE_WGT_KEY, value)
  } catch {
    // ignore
  }
}

/**
 * 会话列表缓存：App 冷启动时先把上次的列表画出来，再去后台刷新。
 * 这样“打开 App → 看到列表”不再需要等网络往返，弱网下也不会空白很久。
 */
function deviceStorageKey(base, deviceId) {
  const suffix = String(deviceId || '').trim()
  return suffix ? `${base}.${suffix}` : base
}

function sessionsCacheKey(deviceId) {
  return deviceStorageKey(SESSIONS_CACHE_KEY, deviceId)
}

export function loadSessionsCache(deviceId, now = Date.now()) {
  let value = readJson(sessionsCacheKey(deviceId))
  if (!value && deviceId) {
    // 单电脑时代的缓存迁移给当前电脑，避免升级后第一屏空白。
    const legacy = readJson(SESSIONS_CACHE_KEY)
    if (legacy) {
      value = legacy
      writeJson(sessionsCacheKey(deviceId), legacy)
      try {
        uni.removeStorageSync(SESSIONS_CACHE_KEY)
      } catch {
        // ignore
      }
    }
  }
  if (!value || value.v !== SESSIONS_CACHE_VERSION) return null
  if (!Array.isArray(value.sessions)) return null
  if (Number(value.at) && now - Number(value.at) > SESSIONS_CACHE_MAX_AGE) return null
  return {
    sessions: value.sessions.filter((item) => item && typeof item.id === 'string'),
    roots: Array.isArray(value.roots) ? value.roots.filter((root) => typeof root === 'string') : []
  }
}

export function saveSessionsCache(deviceId, sessions, roots) {
  if (!Array.isArray(sessions) || sessions.length === 0) return
  // 缓存只是首屏加速，字段裁剪到界面用得到的范围，避免写盘过大。
  const rows = sessions.slice(0, 500).map((session) => ({
    id: session.id,
    title: session.title,
    summary: session.summary,
    cwd: session.cwd,
    project: session.project,
    lastModified: session.lastModified,
    createdAt: session.createdAt,
    gitBranch: session.gitBranch,
    tag: session.tag,
    // 断网时列表仍要显示「待办 N」与「已暂停」，把这些状态一起缓存。
    todoPendingCount: Number(session.todoPendingCount) || 0,
    paused: session.paused === true,
    pausedAt: Number(session.pausedAt) || 0,
    // 运行信息不直接展示，只用于冷启动后判断任务是否在 App 不在时结束了。
    running: session.running === true,
    runId: typeof session.runId === 'string' ? session.runId : '',
    runStartedAt: Number(session.runStartedAt) || 0,
    pauseInstruction:
      typeof session.pauseInstruction === 'string' ? session.pauseInstruction : '',
    // 断网冷启动时也能先看到上次的计划和进度。
    plan: session.plan && typeof session.plan === 'object' ? session.plan : null
  }))
  writeJson(sessionsCacheKey(deviceId), {
    v: SESSIONS_CACHE_VERSION,
    at: Date.now(),
    sessions: rows,
    roots: Array.isArray(roots) ? roots : []
  })
}

export function clearSessionsCache(deviceId) {
  try {
    uni.removeStorageSync(sessionsCacheKey(deviceId))
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ */
/* 未查看的完成标记                                                    */
/* ------------------------------------------------------------------ */

/**
 * 任务结束但用户还没打开会话时的标记：sessionId -> { status, at }。
 * 标记按电脑分开保存，查看会话后由调用方删除；最多保留最近 200 条。
 */
function normalizeUnreadEntry(value) {
  if (!value || typeof value !== 'object') return null
  const status = value.status === 'failed' ? 'failed' : value.status === 'done' ? 'done' : ''
  if (!status) return null
  return { status, at: Number(value.at) || 0 }
}

export function loadUnreadSessions(deviceId) {
  const value = readJson(deviceStorageKey(UNREAD_KEY, deviceId))
  if (!value || value.v !== UNREAD_VERSION) return {}
  if (!value.sessions || typeof value.sessions !== 'object') return {}
  const result = {}
  for (const [sessionId, entry] of Object.entries(value.sessions)) {
    if (!sessionId) continue
    const normalized = normalizeUnreadEntry(entry)
    if (normalized) result[sessionId] = normalized
  }
  return result
}

export function saveUnreadSessions(deviceId, sessions) {
  const rows = Object.entries(sessions && typeof sessions === 'object' ? sessions : {})
    .map(([sessionId, entry]) => [String(sessionId), normalizeUnreadEntry(entry)])
    .filter(([sessionId, entry]) => sessionId && entry)
    .sort((left, right) => right[1].at - left[1].at)
    .slice(0, UNREAD_LIMIT)
  if (!rows.length) {
    try {
      uni.removeStorageSync(deviceStorageKey(UNREAD_KEY, deviceId))
    } catch {
      // ignore
    }
    return true
  }
  return writeJson(deviceStorageKey(UNREAD_KEY, deviceId), {
    v: UNREAD_VERSION,
    at: Date.now(),
    sessions: Object.fromEntries(rows)
  })
}

export function clearUnreadSessions(deviceId) {
  try {
    uni.removeStorageSync(deviceStorageKey(UNREAD_KEY, deviceId))
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ */
/* 离线缓存：待办、未同步待办、最近会话记录                            */
/* ------------------------------------------------------------------ */

function normalizeTodoRow(value) {
  if (!value || typeof value !== 'object') return null
  const id = String(value.id || '').trim()
  const text = String(value.text || '').slice(0, 4000)
  if (!id || !text) return null
  return {
    id,
    text,
    status: value.status === 'sent' ? 'sent' : 'pending',
    createdAt: Number(value.createdAt) || 0,
    sentAt: Number(value.sentAt) || 0,
    sentRunId: typeof value.sentRunId === 'string' ? value.sentRunId : '',
    sentQueueId: typeof value.sentQueueId === 'string' ? value.sentQueueId : '',
    source: value.source === 'pc' ? 'pc' : 'phone',
    offline: value.offline === true
  }
}

function readTodosCache(deviceId) {
  const value = readJson(deviceStorageKey(TODOS_CACHE_KEY, deviceId))
  if (!value || value.v !== TODOS_CACHE_VERSION) return {}
  if (!value.sessions || typeof value.sessions !== 'object') return {}
  if (Number(value.at) && Date.now() - Number(value.at) > OFFLINE_CACHE_MAX_AGE) return {}
  const result = {}
  for (const [sessionId, rows] of Object.entries(value.sessions)) {
    if (!sessionId || !Array.isArray(rows)) continue
    const items = rows
      .map(normalizeTodoRow)
      .filter(Boolean)
      .slice(-TODOS_CACHE_ITEM_LIMIT)
    if (items.length) result[sessionId] = items
  }
  return result
}

export function loadTodosCache(deviceId, sessionId) {
  const value = readTodosCache(deviceId)
  return value[String(sessionId || '')] || []
}

export function saveTodosCache(deviceId, sessionId, todos) {
  const key = String(sessionId || '')
  if (!key || !Array.isArray(todos)) return false
  const sessions = readTodosCache(deviceId)
  // 重新插入让最近使用的会话排在末尾，超过上限时从最早的开始丢弃。
  delete sessions[key]
  const rows = todos
    .map(normalizeTodoRow)
    .filter(Boolean)
    .slice(-TODOS_CACHE_ITEM_LIMIT)
  if (rows.length) sessions[key] = rows
  while (Object.keys(sessions).length > TODOS_CACHE_SESSION_LIMIT) {
    delete sessions[Object.keys(sessions)[0]]
  }
  return writeJson(deviceStorageKey(TODOS_CACHE_KEY, deviceId), {
    v: TODOS_CACHE_VERSION,
    at: Date.now(),
    sessions
  })
}

export function clearTodosCache(deviceId) {
  try {
    uni.removeStorageSync(deviceStorageKey(TODOS_CACHE_KEY, deviceId))
  } catch {
    // ignore
  }
}

/** 尚未同步到电脑的待办；联网后按创建顺序逐条补发。 */
export function loadOfflineTodos(deviceId) {
  const value = readJson(deviceStorageKey(OFFLINE_TODOS_KEY, deviceId))
  if (!value || value.v !== OFFLINE_TODOS_VERSION || !Array.isArray(value.items)) return []
  const items = []
  for (const item of value.items) {
    if (!item || typeof item !== 'object') continue
    const id = String(item.id || '').trim()
    const sessionId = String(item.sessionId || '').trim()
    const text = String(item.text || '').slice(0, 4000)
    if (!id || !sessionId || !text) continue
    items.push({
      id,
      sessionId,
      text,
      createdAt: Number(item.createdAt) || 0
    })
    if (items.length >= OFFLINE_TODO_LIMIT) break
  }
  return items
}

export function saveOfflineTodos(deviceId, items) {
  const rows = Array.isArray(items) ? items.slice(0, OFFLINE_TODO_LIMIT) : []
  if (!rows.length) {
    try {
      uni.removeStorageSync(deviceStorageKey(OFFLINE_TODOS_KEY, deviceId))
    } catch {
      // ignore
    }
    return true
  }
  return writeJson(deviceStorageKey(OFFLINE_TODOS_KEY, deviceId), {
    v: OFFLINE_TODOS_VERSION,
    at: Date.now(),
    items: rows
  })
}

export { OFFLINE_TODO_LIMIT }

function readHistoryCache(deviceId) {
  const value = readJson(deviceStorageKey(HISTORY_CACHE_KEY, deviceId))
  if (!value || value.v !== HISTORY_CACHE_VERSION) return {}
  if (!value.sessions || typeof value.sessions !== 'object') return {}
  if (Number(value.at) && Date.now() - Number(value.at) > OFFLINE_CACHE_MAX_AGE) return {}
  const result = {}
  for (const [sessionId, entry] of Object.entries(value.sessions)) {
    if (!sessionId || !entry || typeof entry !== 'object') continue
    if (!Array.isArray(entry.messages) || !entry.messages.length) continue
    result[sessionId] = {
      messages: entry.messages.slice(-HISTORY_CACHE_MESSAGE_LIMIT),
      nextBefore: entry.nextBefore ?? null,
      session: entry.session && typeof entry.session === 'object' ? entry.session : null
    }
  }
  return result
}

export function loadHistoryCache(deviceId, sessionId) {
  const key = String(sessionId || '')
  if (!key) return null
  return readHistoryCache(deviceId)[key] || null
}

/** 这台手机上缓存过的全部会话正文：sessionId -> { messages, nextBefore, session }。 */
export function loadHistoryCacheAll(deviceId) {
  return readHistoryCache(deviceId)
}

/** 缓存最近一页会话正文，断网或冷启动时先显示上次内容。 */
export function saveHistoryCache(deviceId, sessionId, messages, nextBefore, session) {
  const key = String(sessionId || '')
  if (!key || !Array.isArray(messages) || !messages.length) return false
  const sessions = readHistoryCache(deviceId)
  delete sessions[key]
  const at = Date.now()
  sessions[key] = {
    at,
    messages: messages.slice(-HISTORY_CACHE_MESSAGE_LIMIT),
    nextBefore: nextBefore ?? null,
    session: session && typeof session === 'object' ? session : null
  }
  while (Object.keys(sessions).length > HISTORY_CACHE_SESSION_LIMIT) {
    delete sessions[Object.keys(sessions)[0]]
  }
  const build = () => ({
    v: HISTORY_CACHE_VERSION,
    at,
    sessions
  })
  if (JSON.stringify(build()).length > HISTORY_CACHE_MAX_LENGTH) {
    // 图片或超长工具结果可能把单条记录撑得很大，只保留当前会话的最近 10 条。
    for (const name of Object.keys(sessions)) {
      if (name !== key) delete sessions[name]
    }
    sessions[key].messages = sessions[key].messages.slice(-10)
    if (JSON.stringify(build()).length > HISTORY_CACHE_MAX_LENGTH) return false
  }
  return writeJson(deviceStorageKey(HISTORY_CACHE_KEY, deviceId), build())
}

export function clearHistoryCache(deviceId) {
  try {
    uni.removeStorageSync(deviceStorageKey(HISTORY_CACHE_KEY, deviceId))
  } catch {
    // ignore
  }
}

function normalizeKnowledgePair(pair, index) {
  if (!pair || typeof pair !== 'object') return null
  const instruction = String(pair.instruction || '')
  const reply = String(pair.reply || '')
  if (!instruction && !reply) return null
  return {
    key: String(pair.key || `pair-${index + 1}`),
    index: Number(pair.index) || index + 1,
    instructionId: String(pair.instructionId || ''),
    instruction: instruction.slice(0, KNOWLEDGE_CACHE_FIELD_LIMIT),
    instructionAt: pair.instructionAt || '',
    replyId: String(pair.replyId || ''),
    replyAt: pair.replyAt || '',
    reply: reply.slice(0, KNOWLEDGE_CACHE_FIELD_LIMIT),
    replyCount: Number(pair.replyCount) || 0
  }
}

function readKnowledgeCache(deviceId) {
  const value = readJson(deviceStorageKey(KNOWLEDGE_CACHE_KEY, deviceId))
  if (!value || value.v !== KNOWLEDGE_CACHE_VERSION) return {}
  if (!value.sessions || typeof value.sessions !== 'object') return {}
  if (Number(value.at) && Date.now() - Number(value.at) > OFFLINE_CACHE_MAX_AGE) return {}
  const result = {}
  for (const [sessionId, entry] of Object.entries(value.sessions)) {
    if (!sessionId || !entry || typeof entry !== 'object') continue
    if (!Array.isArray(entry.pairs) || !entry.pairs.length) continue
    result[sessionId] = {
      pairs: entry.pairs.slice(-KNOWLEDGE_CACHE_PAIR_LIMIT),
      total: Number(entry.total) || entry.pairs.length,
      hasMore: entry.hasMore === true,
      at: Number(entry.at) || 0
    }
  }
  return result
}

/** 这台手机上缓存过的会话知识库：sessionId -> { pairs, total, hasMore, at }。 */
export function loadKnowledgeCache(deviceId, sessionId) {
  const key = String(sessionId || '')
  if (!key) return null
  return readKnowledgeCache(deviceId)[key] || null
}

/**
 * 缓存电脑端整理好的知识库配对，断网时直接翻看。
 * 搜索关键词命中的局部结果不写入缓存，避免把完整列表覆盖成几行搜索结果。
 */
export function saveKnowledgeCache(deviceId, sessionId, data) {
  const key = String(sessionId || '')
  if (!key || !data || !Array.isArray(data.pairs)) return false
  const at = Date.now()
  const pairs = data.pairs
    .slice(-KNOWLEDGE_CACHE_PAIR_LIMIT)
    .map((pair, index) => normalizeKnowledgePair(pair, index))
    .filter(Boolean)
  if (!pairs.length) return false
  const sessions = readKnowledgeCache(deviceId)
  delete sessions[key]
  sessions[key] = {
    at,
    pairs,
    total: Number(data.total) || pairs.length,
    hasMore: data.hasMore === true
  }
  const trim = () => {
    while (Object.keys(sessions).length > KNOWLEDGE_CACHE_SESSION_LIMIT) {
      const oldest = Object.keys(sessions).sort((a, b) => sessions[a].at - sessions[b].at)[0]
      delete sessions[oldest]
    }
  }
  trim()
  const build = () => ({ v: KNOWLEDGE_CACHE_VERSION, at, sessions })
  if (JSON.stringify(build()).length > KNOWLEDGE_CACHE_MAX_LENGTH) {
    // 超长回复可能把缓存撑大：只留当前会话，并缩小到最近 20 对。
    for (const name of Object.keys(sessions)) {
      if (name !== key) delete sessions[name]
    }
    sessions[key].pairs = sessions[key].pairs.slice(-20)
    sessions[key].total = sessions[key].pairs.length
    sessions[key].hasMore = false
    if (JSON.stringify(build()).length > KNOWLEDGE_CACHE_MAX_LENGTH) return false
  }
  return writeJson(deviceStorageKey(KNOWLEDGE_CACHE_KEY, deviceId), build())
}

export function clearKnowledgeCache(deviceId) {
  try {
    uni.removeStorageSync(deviceStorageKey(KNOWLEDGE_CACHE_KEY, deviceId))
  } catch {
    // ignore
  }
}

/** 移除或解绑电脑时清掉这台电脑的全部离线数据。 */
export function clearOfflineCache(deviceId) {
  clearTodosCache(deviceId)
  clearHistoryCache(deviceId)
  clearKnowledgeCache(deviceId)
  clearUnreadSessions(deviceId)
  try {
    uni.removeStorageSync(deviceStorageKey(OFFLINE_TODOS_KEY, deviceId))
  } catch {
    // ignore
  }
}

export { PAIRING_KEY }
