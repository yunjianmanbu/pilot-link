/**
 * 全局状态与连接管理。
 *
 * 页面只读写这里的状态；WebSocket 连接保存在模块内，
 * 切换页面不会断开，锁屏或切到后台后回到前台会自动重连。
 */

import { reactive } from 'vue'
import { LONG_TIMEOUT, RelayClient } from '../lib/client.js'
import { initI18n, t } from '../lib/i18n.js'
import {
  buildKnowledgePairs,
  filterKnowledgePairs,
  searchLocalKnowledge
} from '../lib/knowledge.js'
import {
  extractSessionLinks,
  normalizeSessionLinks,
  normalizeSessionTools,
  SESSION_LINK_LIMIT,
  SESSION_TOOL_LIMIT
} from '../lib/session-resources.js'
import { mergeSessionsSnapshot } from '../lib/live-state.js'
import { createKeyPair, exportKey } from '../lib/pair-crypto.js'
import { joinPairing } from '../lib/pairing.js'
import { normalizePlan } from '../lib/plan.js'
import { decideTailSync } from '../lib/tail-sync.js'
import { earlierContinue } from '../lib/history-page.js'
import { keepLinkAlive, releaseLinkKeepAlive } from '../lib/background-link.js'
import {
  BG_HIDE_KEY,
  BG_REPORT_KEY,
  buildHideMarker,
  createRuntimeSession,
  evaluateBackgroundReturn,
  readStoredJson,
  removeStoredKey,
  writeStoredJson
} from '../lib/background-report.js'
import { isBatteryUnrestricted } from '../lib/background-settings.js'
import {
  getKeepAliveStatus,
  startKeepAliveService,
  stopKeepAliveService
} from '../lib/keepalive-service.js'
import { applyNavBarColor, themeBackground } from '../lib/nav-bar.js'
import {
  OFFLINE_TODO_LIMIT,
  clearDraft,
  clearOfflineCache,
  clearSessionsCache,
  loadAccent,
  loadButtonScheme,
  loadContrast,
  loadFontSize,
  loadHistoryCache,
  loadHistoryCacheAll,
  loadKnowledgeCache,
  loadOfflineTodos,
  loadPairings,
  loadPhoneId,
  loadPhoneName,
  loadSessionModes,
  loadSaturation,
  loadSessionsCache,
  loadSessionMemoryCache,
  loadThemeMode,
  loadTodosCache,
  loadUnreadSessions,
  normalizeButtonScheme,
  pairingExpiredLocally,
  removePairing,
  saveAccent,
  saveButtonScheme,
  saveContrast,
  saveFontSize,
  saveHistoryCache,
  saveKnowledgeCache,
  saveOfflineTodos,
  savePairing,
  savePhoneName,
  saveSessionModes,
  saveSaturation,
  saveSessionsCache,
  saveSessionMemoryCache,
  saveThemeMode,
  saveTodosCache,
  saveUnreadSessions,
  setActivePairing
} from '../lib/storage.js'

// 会话页首屏只取最近这么多条消息；更早的记录按需加载。
// App 端的逻辑层和视图层是分开的，一次塞给视图太多消息会明显卡顿。
const HISTORY_PAGE_SIZE = 25
// 流式回复的增量按时间片合并后再更新界面，避免每个 token 都跨层刷新一次。
const STREAM_FLUSH_MS = 80
// 资源面板（链接/工具/记忆/知识库）的请求超时：这些数据都在电脑端内存里，
// 正常是一瞬间返回。用默认的 20s / 60s 会在「中继连着但电脑端没响应」时
// 把页面钉在 loading 上一分多钟，用户看到的就是「点了没反应、一直空」。
const RESOURCE_TIMEOUT = 8_000
// `sessions.get` 兜底要读会话正文，比纯清单慢一点。
const RESOURCE_FALLBACK_TIMEOUT = 12_000
const SESSIONS_CACHE_SAVE_MS = 5_000
// 回到前台后定期对账：中继事件偶尔丢失时，几秒内也能自动恢复运行状态和待办。
const FOREGROUND_SYNC_MS = 20_000
const FOREGROUND_PROBE_TIMEOUT = 5_000
// 前台服务启动失败时的重试间隔（毫秒）。plus 刚就绪、页面刚回前台时
// 偶尔会拿不到 Activity，重试几次比只试一次稳。
const KEEPALIVE_RETRY_MS = [1_000, 3_000, 8_000]
// 每次 JS 运行时生成一次；冷启动后会变，用来判断后台期间进程有没有被回收。
const runtimeSession = createRuntimeSession()

export const store = reactive({
  ready: false,
  booting: false,
  needPair: false,
  pairing: null,
  pairings: [],
  phoneName: '',
  deviceName: '',
  // 电脑端 App 版本，用于「电脑端更新」卡片；旧版电脑端没有该字段时为空。
  agentVersion: '',
  // 电脑端应用内更新状态（status/version/progress…），由 update.changed 推送。
  desktopUpdate: null,
  // null 表示还没探测过；false 表示电脑端确实不认识 update.* 操作（旧版）。
  desktopUpdateSupported: null,
  // 手机端自进化面板：所选工作区、状态快照、个人源码状态。
  evolution: null,
  evolutionLoading: false,
  evolutionError: '',
  evolutionWorkspace: '',
  evolutionAction: '',
  evolutionSupported: null,
  evolutionPersonal: null,
  evolutionPersonalHasKey: false,
  evolutionPersonalLoading: false,
  evolutionPersonalError: '',
  evolutionPersonalBusy: null,
  // 反思（自问）：配置与报告都留在电脑端，手机只读写同一份并手动触发一次。
  // null 表示还没读过；reflectSupported=false 表示电脑端版本太旧。
  reflect: null,
  reflectLoading: false,
  reflectError: '',
  reflectSupported: null,
  // 正在进行的动作（saving / running / testing / clearing），用于禁用按钮。
  reflectAction: '',
  reflectReport: null,
  reflectReportLoading: false,
  themeMode: 'system',
  theme: 'dark',
  // 字号：standard（默认原字号）/ large / xlarge，页面根节点切换 font-* class。
  fontSize: 'standard',
  // 对比度 / 饱和度：standard（默认）/ low / high，页面根节点切换对应 class。
  contrast: 'standard',
  saturation: 'standard',
  // 主题色：graphite（默认纯黑白）/ pine / indigo / clay / ocean /
  // moss / plum / rose / sand / orange / claude。
  accent: 'graphite',
  // 按钮配色：accent（跟随主题）/ mono（黑白）/ soft（柔和）/ outline（分层填充）。
  buttonScheme: 'accent',
  connectionState: 'idle',
  connectionMessage: '',
  // 当前连接方式：'lan' 局域网直连；'relay' 云端中继。
  connectionTransport: '',
  agentOnline: false,
  serverError: '',
  pairBusy: false,
  pairError: '',
  // 后台保持的诊断：前台服务是否启动、系统是否还限制后台、上次后台回来的结果。
  keepAliveState: 'off',
  keepAliveError: '',
  batteryUnrestricted: null,
  backgroundReport: null,

  sessions: [],
  roots: [],
  // 电脑端授权的目录：手机可以在这些目录下新建工作区。
  workspaceRoots: [],
  defaultMode: 'auto',
  sessionModes: {},
  activeRuns: {},
  // 任务结束但用户还没打开会话：sessionId -> { status: 'done' | 'failed', at }。
  unreadSessions: {},
  queue: [],
  // 当前会话的待办：只暂存在电脑端，点「发送」才会真正提交。
  todos: [],
  todosSessionId: '',
  todosLoading: false,
  todoBusy: false,
  // 当前会话的定时任务；只在电脑端保存和执行。
  scheduled: [],
  scheduledSessionId: '',
  scheduledLoading: false,
  scheduledBusy: false,
  // 首页「全部定时任务」的跨会话分组，只读缓存：打开首页时静默拉一次。
  scheduledAllGroups: [],
  scheduledAllAt: '',
  // 会话列表的待办数量：sessionId -> 未发送条数。
  todoCounts: {},
  permissions: [],
  respondingPermissions: {},

  currentSessionId: '',
  currentSession: null,
  newChat: null,
  messages: [],
  messageIds: {},
  historyBefore: null,
  // 知识库命中后定位到的消息；页面据此高亮并滚动到对应位置。
  focusMessageId: '',
  // 当前窗口是从旧消息加载的，后面还有更新的消息，用「回到最新」补齐。
  historyNewer: false,
  historyLoading: false,
  historyToken: 0,
  // 上次拉取尾部时电脑端记录的 messageCount；和会话列表里的最新值比较，
  // 用来发现「运行结束事件丢了、本地还停在上一页」的情况。
  tailCount: 0,
  pendingHistoryReload: '',
  streamRunId: '',
  streamText: '',
  streamReasoning: '',
  sending: false,
  stopBusy: false,
  pauseBusy: false,
  loadingSessions: false
})

let client = null
let initialized = false
let lastActiveHint = 0
// 本地事实时间：请求响应晚到且内容更旧时，用它判断是否保留本地状态。
const todoFactsAt = {}
const runFactsAt = {}
const planFactsAt = {}
// 已知在运行的会话：结束事件丢失时（App 被后台回收等），
// 下一次会话快照发现它已不在运行，也能补上「已完成」标记。
const runningWatch = new Map()
let foreground = true
let foregroundTimer = null
let foregroundProbe = null
let keepAliveRetryTimer = null
let liveRefreshPromise = null
let networkListenerBound = false
// 「最后一条是我的指令但没有回答」这个备选信号最多每 30 秒用一次。
let tailFallbackAt = 0

function toast(message, icon = 'none', duration = 2200) {
  try {
    uni.showToast({ title: String(message).slice(0, 120), icon, duration })
  } catch {
    // ignore
  }
}

export function notify(message) {
  toast(message)
}

/* ------------------------------------------------------------------ */
/* 主题                                                                */
/* ------------------------------------------------------------------ */

let latestSystemTheme = ''
let themeListenerBound = false

function detectSystemTheme() {
  try {
    const info = uni.getSystemInfoSync()
    if (info?.theme === 'light' || info?.theme === 'dark') return info.theme
  } catch {
    // ignore
  }
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    }
  } catch {
    // ignore
  }
  return 'dark'
}

let systemBarRetryTimers = []

/** 立刻按当前主题同步一次状态栏与底部导航栏。 */
function syncSystemBarsNow() {
  const resolved = store.theme === 'light' ? 'light' : 'dark'
  const background = themeBackground(resolved, store.accent, store.contrast)
  try {
    if (typeof uni !== 'undefined' && typeof uni.setBackgroundColor === 'function') {
      uni.setBackgroundColor({
        backgroundColor: background,
        backgroundColorTop: background,
        backgroundColorBottom: background,
        fail: () => {}
      })
    }
  } catch {
    // ignore
  }
  try {
    if (typeof plus !== 'undefined' && plus?.navigator?.setStatusBarBackground) {
      plus.navigator.setStatusBarBackground(background)
    }
  } catch {
    // ignore
  }
  try {
    if (typeof plus !== 'undefined' && plus?.navigator?.setStatusBarStyle) {
      plus.navigator.setStatusBarStyle(resolved === 'light' ? 'dark' : 'light')
    }
  } catch {
    // ignore
  }
  // 底部导航栏同样跟着主题走：鸿蒙默认浅色，深色页面底部会留白。
  applyNavBarColor(resolved, null, store.accent, store.contrast)
}

/**
 * 系统状态栏和底部导航栏一起对齐当前主题。
 *
 * 只调 setStatusBarStyle 不够：浅色模式下如果原生状态栏底色还是黑的，
 * 深色图标会直接消失。页面 onShow 里也调用一次，避免页面切换或 ROM
 * 回到前台后把原生配色重置掉。
 *
 * 页面切换动画、键盘弹出和部分 ROM 会在 onShow 之后再把状态栏恢复成
 * 主题默认的白色文字（会话页最明显）。这里补几次延迟同步，始终读取
 * 当时的 store.theme，页面已经切走也只是重复设置同一套颜色。
 */
export function applySystemBars() {
  syncSystemBarsNow()
  if (typeof plus === 'undefined' || !plus) return
  for (const timer of systemBarRetryTimers) clearTimeout(timer)
  systemBarRetryTimers = [80, 350, 900].map((delay) => {
    const timer = setTimeout(() => {
      systemBarRetryTimers = systemBarRetryTimers.filter((item) => item !== timer)
      syncSystemBarsNow()
    }, delay)
    // Node 测试环境不阻止进程退出。
    if (typeof timer?.unref === 'function') timer.unref()
    return timer
  })
}

function applyTheme() {
  const mode = store.themeMode
  const resolved =
    mode === 'light' || mode === 'dark' ? mode : latestSystemTheme || detectSystemTheme()
  store.theme = resolved
  applySystemBars()
}

function initTheme() {
  store.themeMode = loadThemeMode()
  store.fontSize = loadFontSize()
  store.contrast = loadContrast()
  store.saturation = loadSaturation()
  store.accent = loadAccent()
  store.buttonScheme = loadButtonScheme()
  latestSystemTheme = detectSystemTheme()
  applyTheme()
  if (themeListenerBound || typeof uni.onThemeChange !== 'function') return
  themeListenerBound = true
  uni.onThemeChange((event) => {
    latestSystemTheme = event?.theme === 'light' ? 'light' : 'dark'
    if (store.themeMode === 'system') applyTheme()
  })
}

/** 外观设置：system（跟随系统）/ light / dark。 */
export function setThemeMode(mode) {
  store.themeMode = mode === 'light' || mode === 'dark' ? mode : 'system'
  saveThemeMode(store.themeMode)
  applyTheme()
}

/** 字号：standard（默认）/ large / xlarge。 */
export function setFontSize(size) {
  store.fontSize = size === 'large' || size === 'xlarge' ? size : 'standard'
  saveFontSize(store.fontSize)
}

/** 对比度：standard（默认）/ low / high。 */
export function setContrast(contrast) {
  store.contrast = contrast === 'low' || contrast === 'high' ? contrast : 'standard'
  saveContrast(store.contrast)
  applySystemBars()
}

/** 饱和度：standard（默认）/ low / high。 */
export function setSaturation(saturation) {
  store.saturation = saturation === 'low' || saturation === 'high' ? saturation : 'standard'
  saveSaturation(store.saturation)
}

/** 主题配色：graphite（默认黑白）及十款低饱和预设。 */
export function setAccent(accent) {
  store.accent =
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
  saveAccent(store.accent)
  // 每套配色都会改窗口底色，重新应用一次状态栏与系统导航栏。
  applyTheme()
}

/** 按钮配色方案：accent（跟随主题）/ mono（黑白）/ soft（柔和）/ outline（分层填充）。 */
export function setButtonScheme(scheme) {
  store.buttonScheme = normalizeButtonScheme(scheme)
  saveButtonScheme(store.buttonScheme)
}

function currentRoute() {
  try {
    const pages = getCurrentPages()
    const last = pages[pages.length - 1]
    return last?.route || ''
  } catch {
    return ''
  }
}

function goPair(message) {
  store.needPair = true
  store.pairError = message || ''
  if (currentRoute() !== 'pages/pair/index') {
    try {
      uni.reLaunch({ url: '/pages/pair/index' })
    } catch {
      // ignore
    }
  }
}

function goSessions() {
  store.needPair = false
  if (currentRoute() !== 'pages/sessions/index') {
    try {
      uni.reLaunch({ url: '/pages/sessions/index' })
    } catch {
      // ignore
    }
  }
}

/* ------------------------------------------------------------------ */
/* 会话与事件                                                          */
/* ------------------------------------------------------------------ */

let lastSessionsCacheSaveAt = 0

function storageDeviceId() {
  return store.pairing?.deviceId || ''
}

/** 用户是否正停留在这个会话的聊天页；只有这种情况下结束时不需要留标记。 */
function isViewingSession(sessionId) {
  const key = String(sessionId || '')
  return Boolean(
    key &&
      foreground &&
      store.currentSessionId === key &&
      currentRoute() === 'pages/chat/index'
  )
}

function markSessionUnread(sessionId, status) {
  const key = String(sessionId || '')
  if (!key) return
  store.unreadSessions[key] = {
    status: status === 'failed' ? 'failed' : 'done',
    at: Date.now()
  }
  saveUnreadSessions(storageDeviceId(), store.unreadSessions)
}

function clearSessionUnread(sessionId) {
  const key = String(sessionId || '')
  if (!key || !store.unreadSessions[key]) return
  delete store.unreadSessions[key]
  saveUnreadSessions(storageDeviceId(), store.unreadSessions)
}

function watchRunning(sessionId, runId, at = Date.now()) {
  const key = String(sessionId || '')
  if (!key) return
  runningWatch.set(key, { runId: String(runId || ''), at: Number(at) || 0 })
}

function unwatchRunning(sessionId, runId = '') {
  const key = String(sessionId || '')
  const entry = runningWatch.get(key)
  if (!entry) return
  // runId 对不上说明已经开始新一轮，旧运行结束不能清掉新的观察记录。
  if (!runId || !entry.runId || entry.runId === String(runId)) runningWatch.delete(key)
}

function settleRunningWatch(rows, requestedAt = 0) {
  if (!runningWatch.size) return
  for (const [sessionId, entry] of [...runningWatch]) {
    // 请求发出后才开始的运行，不能用更旧的快照判断它已经结束。
    if (requestedAt && entry.at > requestedAt) continue
    const row = rows.find((item) => item.id === sessionId)
    if (!row) {
      runningWatch.delete(sessionId)
      continue
    }
    if (row.running) {
      if (row.runId) watchRunning(sessionId, row.runId, entry.at)
      continue
    }
    runningWatch.delete(sessionId)
    if (row.paused) continue
    if (isViewingSession(sessionId) || store.unreadSessions[sessionId]) continue
    markSessionUnread(sessionId, 'done')
  }
}

/** 会话列表写盘做节流：只用于下次冷启动秒开，不需要每次都写。 */
// 缓存会保留运行信息，仅用于冷启动后判断任务是否已经结束；展示前仍会去掉，
// 避免断网时把上次的「运行中」显示成假状态。
function withoutRunState(session) {
  if (!session || typeof session !== 'object') return session
  const { running, runId, runInstruction, runStartedAt, ...rest } = session
  return rest
}

/* ------------------------------------------------------------------ */
/* Pilot 数据适配                                                      */
/* ------------------------------------------------------------------ */

// Pilot 的三种执行模式。手机端沿用同一套取值，切换时直接写回电脑端的会话。
// auto = 全部自动，manual = 只读自动，ask = 逐条审批。
export const APPROVAL_MODES = ['auto', 'manual', 'ask']
export const DEFAULT_APPROVAL_MODE = 'auto'

const LEGACY_APPROVAL_MODES = {
  acceptEdits: 'auto',
  plan: 'manual',
  dontAsk: 'manual'
}

export function normalizeApprovalMode(mode) {
  if (LEGACY_APPROVAL_MODES[mode]) return LEGACY_APPROVAL_MODES[mode]
  return APPROVAL_MODES.includes(mode) ? mode : DEFAULT_APPROVAL_MODE
}

function toMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const time = Date.parse(String(value || ''))
  return Number.isFinite(time) ? time : 0
}

const DESKTOP_UPDATE_STATUSES = new Set([
  'idle',
  'disabled',
  'checking',
  'up-to-date',
  'available',
  'downloading',
  'ready',
  'installing',
  'error'
])

/** 电脑端 UpdateState -> 手机界面状态；不认识的新状态一律当 idle。 */
export function normalizeDesktopUpdate(state) {
  if (!state || typeof state !== 'object') return null
  const status = DESKTOP_UPDATE_STATUSES.has(state.status) ? state.status : 'idle'
  const release =
    state.release && typeof state.release === 'object'
      ? {
          version: String(state.release.version || ''),
          date: String(state.release.date || ''),
          size: Number(state.release.size) || 0,
          notes: String(state.release.notes || '')
        }
      : null
  const total = Number(state.total) || 0
  const transferred = Number(state.transferred) || 0
  // 电脑端进度是 0–1，手机界面统一用百分比。
  const raw = Number(state.progress)
  const progress = Number.isFinite(raw)
    ? Math.max(0, Math.min(100, Math.round(raw * 100)))
    : total > 0
      ? Math.min(100, Math.round((transferred / total) * 100))
      : 0
  return {
    status,
    currentVersion: String(state.currentVersion || ''),
    release,
    progress,
    transferred,
    total,
    message: String(state.message || ''),
    checkedAt: state.checkedAt || null,
    canInstall: state.canInstall !== false,
    // 电脑装在 Program Files 这类目录时，安装会触发 Windows UAC。
    elevationRequired: state.elevationRequired === true,
    // 新电脑端会改成装到当前用户目录，从而绕过 UAC；旧电脑端不会带这个字段。
    relocatingToUserDir: state.relocatingToUserDir === true
  }
}

function applySessionPlan(sessionId, plan) {
  const key = String(sessionId || '')
  if (!key) return
  const next = normalizePlan(plan)
  planFactsAt[key] = Date.now()
  const listed = store.sessions.find((item) => item.id === key)
  if (listed) listed.plan = next
  if (store.currentSessionId !== key) return
  if (!store.currentSession) store.currentSession = { id: key, title: t("会话") }
  store.currentSession.plan = next
}

/** Pilot 的 SessionSummary -> 手机界面使用的会话字段。 */
function normalizeSession(session) {
  if (!session || typeof session !== 'object' || typeof session.id !== 'string') return session
  const workspacePath = String(session.workspacePath || session.cwd || '')
  const workspaceName = String(session.workspaceName || session.project || '')
  const todoCount = Number(session.todoCount ?? session.todoPendingCount) || 0
  return {
    ...session,
    cwd: workspacePath,
    workspacePath,
    project: workspaceName,
    workspaceName,
    createdAt: toMillis(session.createdAt),
    lastModified: toMillis(session.updatedAt) || toMillis(session.createdAt),
    updatedAt: session.updatedAt || '',
    running: session.running === true,
    paused: session.paused === true,
    runId: typeof session.runId === 'string' ? session.runId : '',
    runInstruction: String(session.runInstruction || ''),
    runStartedAt: toMillis(session.runStartedAt),
    // 旧版电脑端没有这个字段：保持 null，列表中就不显示，避免出现假的 0。
    instructionCount: Number.isFinite(Number(session.instructionCount))
      ? Math.max(0, Math.round(Number(session.instructionCount)))
      : null,
    queueCount: Number(session.queueCount) || 0,
    todoCount,
    // 旧界面用 todoPendingCount 统计会话列表上的待办角标。
    todoPendingCount: todoCount,
    approvalMode: normalizeApprovalMode(session.approvalMode),
    // 旧版电脑端没有任务级模型字段；空串表示跟随项目/全局。
    sessionModelId:
      typeof session.sessionModelId === 'string' ? session.sessionModelId : '',
    plan: normalizePlan(session.plan)
  }
}

/** Pilot 的 StoredMessage -> blocks 结构，复用手机端已有的消息渲染。 */
function normalizeMessage(message) {
  if (!message || typeof message !== 'object') return message
  const role = ['user', 'assistant', 'system', 'tool'].includes(message.role)
    ? message.role
    : 'assistant'
  const blocks = []
  if (role === 'user' || role === 'system') {
    if (message.content) blocks.push({ type: 'text', text: String(message.content) })
    if (role === 'user') {
      if (Array.isArray(message.references)) {
        for (const path of message.references) {
          if (path) blocks.push({ type: 'reference', path: String(path) })
        }
      }
      if (Array.isArray(message.images)) {
        for (const url of message.images) {
          if (typeof url === 'string' && url.startsWith('data:image/')) {
            blocks.push({ type: 'image', url })
          }
        }
      }
    }
  } else if (role === 'assistant') {
    if (message.reasoning) blocks.push({ type: 'thinking', text: String(message.reasoning) })
    if (message.content) blocks.push({ type: 'text', text: String(message.content) })
    for (const call of Array.isArray(message.toolCalls) ? message.toolCalls : []) {
      if (!call || typeof call !== 'object') continue
      blocks.push({
        type: 'tool_use',
        name: String(call.name || t("工具")),
        input: call.arguments && typeof call.arguments === 'object' ? call.arguments : {},
        id: String(call.id || '')
      })
    }
  } else if (role === 'tool') {
    blocks.push({
      type: 'tool_result',
      content: String(message.content || ''),
      isError: message.isError === true
    })
  }
  return {
    ...message,
    role,
    blocks,
    // 消息时间字段：手机端按 createdAt 展示每条指令和回复的发送时间。
    timestamp: message.createdAt || ''
  }
}

function queuePreview(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 100)
}

function normalizeQueue(sessionId, queue) {
  return (Array.isArray(queue) ? queue : [])
    .filter((task) => task && typeof task.id === 'string')
    .map((task) => ({
      queueId: task.id,
      id: task.id,
      sessionId,
      prompt: String(task.content || ''),
      preview: queuePreview(task.content),
      createdAt: task.createdAt || ''
    }))
}

function normalizeTodo(todo, offline = false) {
  if (!todo || typeof todo !== 'object') return null
  return {
    ...todo,
    id: String(todo.id || ''),
    status: todo.status === 'sent' ? 'sent' : 'pending',
    offline: offline === true || todo.offline === true
  }
}

const APPROVAL_FIELDS = [
  'command',
  'path',
  'file_path',
  'pattern',
  'query',
  'url',
  'description',
  'prompt'
]

function summarizeArguments(name, input) {
  const value = input && typeof input === 'object' ? input : {}
  if (Array.isArray(value.edits)) {
    return t("{v1} · {v2} 处修改", { v1: name || t('工具'), v2: value.edits.length })
  }
  for (const key of APPROVAL_FIELDS) {
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

/** Pilot 的 ApprovalRequest -> 审批卡片。事件里带的是 call，列表接口里带的是 arguments。 */
export function normalizeApproval(item) {
  if (!item || typeof item !== 'object') return null
  const source =
    item.call && typeof item.call === 'object' && !item.callId
      ? item.call
      : null
  const callId = String(item.callId || source?.id || item.id || '')
  if (!callId) return null
  const tool = String(item.tool || item.toolName || source?.name || t("工具"))
  const args =
    item.arguments && typeof item.arguments === 'object'
      ? item.arguments
      : source?.arguments && typeof source.arguments === 'object'
        ? source.arguments
        : {}
  const reason = String(item.reason || item.decisionReason || '')
  return {
    requestId: callId,
    callId,
    runId: String(item.runId || ''),
    sessionId: String(item.sessionId || ''),
    tool,
    toolName: tool,
    risk: String(item.risk || ''),
    arguments: args,
    summary: summarizeArguments(tool, args),
    reason,
    decisionReason: reason,
    rule: String(item.rule || ''),
    hasSuggestions: true,
    expiresAt: String(item.expiresAt || '')
  }
}

function cacheSessions() {
  if (!store.pairing?.deviceId) return
  const now = Date.now()
  if (now - lastSessionsCacheSaveAt < SESSIONS_CACHE_SAVE_MS) return
  lastSessionsCacheSaveAt = now
  saveSessionsCache(store.pairing.deviceId, store.sessions, store.roots)
}

/**
 * 会话行本身也带运行信息。即使 chat.started / runs.list 丢了，
 * 只要会话列表拿到了 running，也补一条本地 run，界面就能显示「执行中」。
 */
function adoptRunsFromSessions(rows, requestedAt = 0) {
  const now = Date.now()
  for (const session of rows) {
    if (!session || typeof session.id !== 'string') continue
    if (!session.running || typeof session.runId !== 'string' || !session.runId) continue
    if (!requestedAt) runFactsAt[session.id] = now
    watchRunning(session.id, session.runId, requestedAt || now)
    const existing = store.activeRuns[session.runId]
    if (!existing) {
      store.activeRuns[session.runId] = {
        runId: session.runId,
        sessionId: session.id,
        cwd: session.cwd || '',
        startedAt: Number(session.runStartedAt) || 0,
        source: 'pc',
        mode: '',
        instruction: session.runInstruction || '',
        _eventAt: requestedAt || now,
        // 标记这条 run 来自会话行；下一份会话快照说它不在运行时就应立即清掉。
        _fromSession: true
      }
    } else {
      existing.sessionId = session.id
      if (session.runInstruction) existing.instruction = session.runInstruction
    }
  }
}

/**
 * 会话快照已经不带运行的会话，移除对应的本地 run。
 * 请求发出后才收到 run.started 的会话保留，避免旧快照把新任务抹掉。
 */
function reconcileSessionRuns(rows, requestedAt = 0) {
  const runningSessionIds = new Set()
  for (const session of rows) {
    if (session?.running) runningSessionIds.add(session.id)
  }
  for (const [runId, run] of Object.entries(store.activeRuns)) {
    if (!run) continue
    if (requestedAt && Number(run._eventAt) > requestedAt) continue
    if (!runningSessionIds.has(run.sessionId)) delete store.activeRuns[runId]
  }
}

function applySessions(list, options = {}) {
  if (!Array.isArray(list)) return
  const requestedAt = Number(options.requestedAt) || 0
  const normalized = list.map(normalizeSession)
  // 请求响应可能比事件晚到：本地在请求发出后又更新过待办、运行或计划时以本地为准。
  const localPlans = {}
  for (const session of store.sessions) {
    if (session?.id) localPlans[session.id] = session.plan
  }
  const rows = requestedAt
    ? mergeSessionsSnapshot(normalized, {
        requestedAt,
        activeRuns: store.activeRuns,
        todoCounts: store.todoCounts,
        todoFactsAt,
        runFactsAt,
        plans: localPlans,
        planFactsAt
      })
    : normalized
  adoptRunsFromSessions(rows, requestedAt)
  reconcileSessionRuns(rows, requestedAt)
  store.sessions = rows
  settleRunningWatch(rows, requestedAt)
  const found = rows.find((item) => item.id === store.currentSessionId)
  if (found) store.currentSession = found
  rebuildTodoCounts()
  cacheSessions()
}

// 最近打开过的会话记录缓存在内存里，返回同一个会话时可以立刻显示。
const historyCache = new Map()
const HISTORY_CACHE_SIZE = 6

function rememberHistory(sessionId, messages, nextBefore, session) {
  if (!sessionId) return
  const rows = Array.isArray(messages) ? messages : []
  historyCache.delete(sessionId)
  historyCache.set(sessionId, {
    messages: rows,
    nextBefore: nextBefore ?? null,
    session: session || null
  })
  while (historyCache.size > HISTORY_CACHE_SIZE) {
    historyCache.delete(historyCache.keys().next().value)
  }
  // 同时写入手机本地，断网或冷启动时仍能打开最近看过的会话。
  saveHistoryCache(storageDeviceId(), sessionId, rows.slice(-25), nextBefore, session)
}

function applyHistory(entry) {
  store.messages = entry.messages
  store.messageIds = {}
  for (const message of store.messages) {
    if (message?.id) store.messageIds[message.id] = true
  }
  store.historyBefore = entry.nextBefore
  if (entry.session) store.currentSession = entry.session
}

function applySessionUpdate(raw) {
  const session = normalizeSession(raw)
  if (!session || typeof session.id !== 'string') return
  const hasPlan = Boolean(
    raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'plan')
  )
  const index = store.sessions.findIndex((item) => item.id === session.id)
  if (hasPlan) {
    planFactsAt[session.id] = Date.now()
  } else {
    // 部分接口（例如切换执行模式）只回传变更字段，不能因此把已有计划清掉。
    const previousPlan =
      index >= 0
        ? store.sessions[index]?.plan
        : store.currentSessionId === session.id
          ? store.currentSession?.plan
          : undefined
    if (previousPlan !== undefined) session.plan = previousPlan
  }
  if (index >= 0) store.sessions[index] = session
  else store.sessions.unshift(session)
  if (store.currentSessionId === session.id) store.currentSession = session
  if (session.todoPendingCount !== undefined) {
    setTodoCount(session.id, session.todoPendingCount)
    todoFactsAt[session.id] = Date.now()
  }
  adoptRunsFromSessions([session])
}

function setSessionPaused(sessionId, paused) {
  const key = String(sessionId || '')
  if (!key) return
  const session = store.sessions.find((item) => item.id === key)
  if (session) session.paused = Boolean(paused)
  if (store.currentSessionId === key && store.currentSession) {
    store.currentSession.paused = Boolean(paused)
  }
}

function removeSession(sessionId) {
  store.sessions = store.sessions.filter((item) => item.id !== sessionId)
  historyCache.delete(sessionId)
  delete todoFactsAt[sessionId]
  delete runFactsAt[sessionId]
  delete planFactsAt[sessionId]
  for (const [runId, run] of Object.entries(store.activeRuns)) {
    if (run.sessionId === sessionId) delete store.activeRuns[runId]
  }
  if (store.currentSessionId === sessionId) {
    store.currentSessionId = ''
    store.currentSession = null
    store.messages = []
    store.messageIds = {}
    store.focusMessageId = ''
    store.historyNewer = false
    if (currentRoute() === 'pages/chat/index') {
      try {
        uni.reLaunch({ url: '/pages/sessions/index' })
      } catch {
        // ignore
      }
    }
  }
}

let streamBuffer = ''
let reasoningBuffer = ''
let streamTimer = null

function resetStream(runId = '') {
  clearTimeout(streamTimer)
  streamTimer = null
  streamBuffer = ''
  reasoningBuffer = ''
  store.streamRunId = runId
  store.streamText = ''
  store.streamReasoning = ''
}

function flushStream() {
  streamTimer = null
  if (streamBuffer) {
    store.streamText += streamBuffer
    streamBuffer = ''
  }
  if (reasoningBuffer) {
    store.streamReasoning += reasoningBuffer
    reasoningBuffer = ''
  }
}

function scheduleStreamFlush() {
  if (streamTimer) return
  streamTimer = setTimeout(flushStream, STREAM_FLUSH_MS)
}

function pushMessage(message) {
  if (!message || !message.id || store.messageIds[message.id]) return false
  store.messages.push(message)
  store.messageIds[message.id] = true
  return true
}

/** 记录一次运行；同一 runId 的后续事件只更新时间和会话。 */
function trackRun(event) {
  const runId = typeof event?.runId === 'string' ? event.runId : ''
  if (!runId) return null
  const now = Date.now()
  let run = store.activeRuns[runId]
  if (!run) {
    run = {
      runId,
      sessionId: typeof event.sessionId === 'string' ? event.sessionId : '',
      cwd: '',
      startedAt: now,
      source: 'pc',
      mode: '',
      instruction: '',
      _eventAt: now,
      _fromSession: false
    }
    store.activeRuns[runId] = run
  } else {
    run._eventAt = now
    run._fromSession = false
    if (typeof event.sessionId === 'string' && event.sessionId) run.sessionId = event.sessionId
  }
  if (event.sessionId) {
    runFactsAt[event.sessionId] = now
    watchRunning(event.sessionId, runId, now)
  }
  return run
}

function onRunStarted(event) {
  if (!event) return
  const sessionId = typeof event.sessionId === 'string' ? event.sessionId : ''
  const run = trackRun(event)
  if (!run) return
  if (event.mode) {
    const mode = normalizeApprovalMode(event.mode)
    run.mode = mode
    if (sessionId) {
      store.sessionModes[sessionId] = mode
      const session = store.sessions.find((item) => item.id === sessionId)
      if (session) session.approvalMode = mode
    }
  }
  if (sessionId) setSessionPaused(sessionId, false)

  if (sessionId && sessionId === store.currentSessionId) {
    resetStream(event.runId)
    if (store.pendingHistoryReload === sessionId) store.pendingHistoryReload = ''
    // 电脑端在 run.started 之前已经把用户消息写进会话；重新拉一页，
    // 排队任务开始执行时也能立即出现在对话里。
    void reloadHistory()
  }
  void refreshSessions(true)
}

/**
 * 记下当前步号。
 *
 * run 记录先由 trackRun 建立（run.started 通常先到）；事件乱序时也能补建一条，
 * 否则「第 N 步」会因为缺 run 而整段丢失。
 */
function onStepStarted(event) {
  const run = trackRun(event)
  if (!run) return
  const step = Number(event.step)
  if (Number.isFinite(step) && step > 0) run.step = Math.floor(step)
}

function onRunDelta(event, reasoning = false) {
  if (!event || typeof event.text !== 'string' || !event.text) return
  const runId = typeof event.runId === 'string' ? event.runId : ''
  if (!runId) return
  trackRun(event)
  if (store.currentSessionId !== event.sessionId) return
  if (store.streamRunId !== runId) resetStream(runId)
  if (reasoning) reasoningBuffer += event.text
  else streamBuffer += event.text
  scheduleStreamFlush()
}

function onToolCall(event) {
  if (!event?.call || typeof event.call !== 'object') return
  trackRun(event)
  if (!event.sessionId || event.sessionId !== store.currentSessionId) return
  if (store.streamRunId !== event.runId) resetStream(event.runId)
  // 工具调用先以临时消息进入执行过程；run 结束后 reloadHistory 会用
  // 电脑端持久化的完整消息替换掉这些临时行。
  pushMessage(
    normalizeMessage({
      id: `live-tool-${event.call.id}`,
      role: 'assistant',
      toolCalls: [event.call],
      createdAt: new Date().toISOString()
    })
  )
}

function onToolResult(event) {
  if (!event || typeof event.callId !== 'string' || !event.callId) return
  trackRun(event)
  if (!event.sessionId || event.sessionId !== store.currentSessionId) return
  if (store.streamRunId !== event.runId) resetStream(event.runId)
  const result = event.result && typeof event.result === 'object' ? event.result : {}
  const ok = result.ok !== false
  const content = ok
    ? String(result.output || '')
    : String(result.error || result.output || t("工具执行失败"))
  pushMessage(
    normalizeMessage({
      id: `live-result-${event.callId}`,
      role: 'tool',
      content,
      isError: !ok,
      createdAt: new Date().toISOString()
    })
  )
}

function onApprovalRequired(event) {
  trackRun(event)
  const approval = normalizeApproval(event)
  if (!approval) return
  if (!store.permissions.some((item) => item.requestId === approval.requestId)) {
    store.permissions.push(approval)
    try {
      uni.vibrateShort?.()
    } catch {
      // ignore
    }
  }
}

function onApprovalResolved(event) {
  const requestId = String(event?.callId || '')
  if (!requestId) return
  // 手机上还挂着这张审批卡时，如果是超时或任务中断导致自动拒绝，卡片会
  // 「自己消失」。补一句原因，避免用户以为自己误触或网络丢了请求。
  const wasPending = store.permissions.some((item) => item.requestId === requestId)
  store.permissions = store.permissions.filter((item) => item.requestId !== requestId)
  delete store.respondingPermissions[requestId]
  if (wasPending && event.decidedBy === 'timeout') {
    toast(t('审批超时，已自动拒绝'))
  } else if (wasPending && event.decidedBy === 'interrupted') {
    toast(t('任务已中断，待审批操作已取消'))
  }
}

function finishRun(event) {
  const runId = event?.runId || ''
  const sessionId = event?.sessionId || ''
  // 结束事件已经到达，不再需要靠会话快照兜底判断。
  if (sessionId) unwatchRunning(sessionId, runId)
  // 用户没在看这个会话时留一个标记，回到列表能看出哪条任务已经结束。
  // 手动停止和主动暂停都不算「有新结果没看」。
  if (sessionId && !isViewingSession(sessionId)) {
    if (event?.type === 'run.failed') markSessionUnread(sessionId, 'failed')
    else if (
      event?.type === 'run.completed' &&
      event.status !== 'cancelled' &&
      event.status !== 'paused'
    ) {
      markSessionUnread(sessionId, 'done')
    }
  }
  if (runId) delete store.activeRuns[runId]
  store.sending = false
  store.stopBusy = false
  store.pauseBusy = false
  if (sessionId) {
    runFactsAt[sessionId] = Date.now()
    if (event.type === 'run.completed') {
      setSessionPaused(sessionId, event.status === 'paused')
    }
  }
  if (runId) {
    store.permissions = store.permissions.filter((item) => item.runId !== runId)
  }
  if (store.currentSessionId && (!sessionId || store.currentSessionId === sessionId)) {
    resetStream()
    if (store.pendingHistoryReload === store.currentSessionId) store.pendingHistoryReload = ''
    void reloadHistory()
  }
  void refreshSessions(true)
  void refreshQueue()
  void refreshPermissions()
}

function onRunCompleted(event) {
  finishRun(event)
  if (event?.status === 'cancelled') toast(t("任务已停止"))
  if (event?.status === 'max_steps') {
    toast(t("已达到单次任务的最大步数，可以继续发送指令接着做"), 'none', 3000)
  }
}

function onRunFailed(event) {
  const message = String(event?.message || t("运行失败")).slice(0, 4000)
  toast(message, 'none', 4000)
  if (!event?.sessionId || event.sessionId === store.currentSessionId) {
    resetStream()
    pushMessage({
      id: `error-${Date.now()}`,
      role: 'system',
      error: true,
      blocks: [{ type: 'text', text: message }],
      timestamp: new Date().toISOString()
    })
  }
  finishRun(event)
}

export function onEvent(event) {
  if (!event || typeof event.type !== 'string') return
  switch (event.type) {
    case 'run.started':
      onRunStarted(event)
      break
    // 步号：电脑端每进入新一轮工具循环就报一次。手机端只用来在等待行显示
    // 「第 N 步」，所以记在 run 上，不单独进消息流。
    case 'step.started':
      onStepStarted(event)
      break
    case 'message.delta':
      onRunDelta(event, false)
      break
    case 'reasoning.delta':
      onRunDelta(event, true)
      break
    case 'tool.call':
      onToolCall(event)
      break
    case 'tool.result':
      onToolResult(event)
      break
    case 'tool.approval_required':
      onApprovalRequired(event)
      break
    case 'tool.approval_resolved':
      onApprovalResolved(event)
      break
    // 上下文压缩只影响历史消息裁剪，用户无需即时反馈；弹吐司会打断正在进行的输入。
    // 桌面端（App.tsx）也是记在运行态 banner 里而非 toast，这里保持一致：静默处理。
    case 'context.compacted':
      break
    case 'run.completed':
      onRunCompleted(event)
      break
    case 'run.failed':
      onRunFailed(event)
      break
    case 'session.changed':
      if (event.sessionId) {
        // 计划更新跟着事件一起到，先本地生效；列表刷新只负责其它会话字段。
        if (event.plan !== undefined) applySessionPlan(event.sessionId, event.plan)
        void refreshSessions(true)
      }
      break
    case 'queue.changed':
      if (event.sessionId) applyQueue(event.sessionId, event.queue)
      break
    case 'todos.changed':
      if (event.sessionId) applyTodoEvent(event.sessionId, event.todos)
      break
    case 'scheduled.changed':
      if (event.sessionId) void loadScheduled(event.sessionId)
      // 首页的「全部定时」汇总条与弹层用的是跨会话缓存，改完要跟着更新。
      void loadAllScheduled()
      break
    case 'update.changed': {
      const state = normalizeDesktopUpdate(event.state)
      if (state) store.desktopUpdate = state
      break
    }
    case 'notice':
      if (event.message) {
        toast(String(event.message), event.level === 'error' ? 'none' : 'none', 3000)
      }
      break
    case 'memory.changed':
      break
    case 'profile.changed':
    case 'evolution.changed':
      if (store.evolution) void refreshEvolution(true)
      break
    case 'settings.changed':
      if (event.settings && store.evolution) {
        store.evolution.autoEvolve = event.settings.autoEvolve === true
      }
      // 反思也会由电脑端定时或运行失败触发，跑完推一条 settings.changed；
      // 只有打开过反思面板才顺手刷新，避免每台手机都跟着拉一次报告。
      if (store.reflect) void loadReflect()
      break
    case 'workspace.changed':
      // 手机端新建个人源码工作区后，会话页要能马上看到它。
      void refreshSessions(true)
      break
    default:
      break
  }
}

/* ------------------------------------------------------------------ */
/* 请求                                                                */
/* ------------------------------------------------------------------ */

export function request(method, params, timeout) {
  if (!client) return Promise.reject(new Error(t("尚未连接电脑")))
  return client.request(method, params, timeout)
}

/** 电脑端不认识 update.* 时的两种错误文案（未知方法 / 未接更新器）。 */
function unsupportedDesktopUpdate(error) {
  const message = error instanceof Error ? error.message : String(error || '')
  return (
    message.includes('不支持该操作') ||
    message.includes('不支持手机控制更新')
  )
}

/** 电脑端更新：旧版电脑端不认识这些操作时静默忽略，不影响其它功能。 */
export async function refreshDesktopUpdate() {
  if (!client?.isConnected()) return null
  try {
    const data = await client.request('update.state')
    const state = normalizeDesktopUpdate(data?.state)
    if (state) store.desktopUpdate = state
    store.desktopUpdateSupported = true
    return state
  } catch (error) {
    // 网络抖动的失败不能误判成「版本不支持」，只认明确的协议错误。
    if (unsupportedDesktopUpdate(error)) store.desktopUpdateSupported = false
    return null
  }
}

export async function checkDesktopUpdate() {
  try {
    const data = await request('update.check', {}, 30_000)
    const state = normalizeDesktopUpdate(data?.state)
    if (state) store.desktopUpdate = state
    store.desktopUpdateSupported = true
    return state
  } catch (error) {
    if (unsupportedDesktopUpdate(error)) store.desktopUpdateSupported = false
    throw error
  }
}

export async function downloadDesktopUpdate() {
  const data = await request('update.download', {}, 20_000)
  const state = normalizeDesktopUpdate(data?.state)
  if (state) store.desktopUpdate = state
  return state
}

export async function installDesktopUpdate() {
  await request('update.install', {}, 30_000)
}

/* ------------------------------------------------------------------ */
/* 自进化                                                              */
/* ------------------------------------------------------------------ */

/** 电脑端不认识 evolution.* 时的错误文案（旧版 / 未接自进化适配器）。 */
function unsupportedEvolution(error) {
  const message = error instanceof Error ? error.message : String(error || '')
  return message.includes('不支持该操作') || message.includes('不支持手机控制自进化')
}

/** 当前自进化面板对应的工作区；优先用户手选，其次当前会话。 */
export function evolutionWorkspacePath() {
  return (
    store.evolutionWorkspace ||
    store.currentSession?.workspacePath ||
    store.sessions[0]?.workspacePath ||
    store.roots[0] ||
    ''
  )
}

/**
 * 读取一个工作区的自进化快照。手机只拿面板需要的字段；完整运行记录、
 * 记忆和会话正文都留在电脑端。
 */
export async function refreshEvolution(force = false) {
  if (!client?.isConnected()) return null
  const path = evolutionWorkspacePath()
  if (!path) {
    store.evolution = null
    store.evolutionError = ''
    return null
  }
  if (!force && store.evolution && store.evolution.workspacePath === path) {
    return store.evolution
  }
  if (evolutionRefreshPromise && evolutionRefreshPath === path) {
    return evolutionRefreshPromise
  }
  // 切换工作区时先等旧请求结束，避免旧响应覆盖新工作区的快照。
  if (evolutionRefreshPromise) await evolutionRefreshPromise
  if (evolutionWorkspacePath() !== path) return refreshEvolution(force)
  store.evolutionLoading = true
  const promise = (async () => {
    try {
      const data = await request('evolution.state', { workspacePath: path }, LONG_TIMEOUT)
      if (evolutionWorkspacePath() !== path) return null
      if (data && typeof data === 'object' && data.workspacePath) {
        store.evolution = data
        store.evolutionSupported = true
        store.evolutionError = ''
        return data
      }
      return null
    } catch (error) {
      if (evolutionWorkspacePath() !== path) return null
      if (unsupportedEvolution(error)) {
        store.evolutionSupported = false
        store.evolutionError = ''
      } else {
        store.evolutionError =
          error instanceof Error ? error.message : String(error || t("读取失败"))
      }
      return null
    } finally {
      if (evolutionRefreshPromise === promise) {
        store.evolutionLoading = false
        evolutionRefreshPromise = null
        evolutionRefreshPath = ''
      }
    }
  })()
  evolutionRefreshPromise = promise
  evolutionRefreshPath = path
  return promise
}

/** 切换要查看的工作区；快照立即清空，避免短暂显示上一项目的数据。 */
export function setEvolutionWorkspace(path) {
  const next = String(path || '')
  if (next === store.evolutionWorkspace) return refreshEvolution(true)
  store.evolutionWorkspace = next
  store.evolution = null
  store.evolutionError = ''
  return refreshEvolution(true)
}

/** 个人源码状态：版本、官方更新合并与贡献包。 */
export async function loadEvolutionPersonal(force = false) {
  if (!client?.isConnected()) return null
  if (!force && store.evolutionPersonal) return store.evolutionPersonal
  const seq = ++evolutionPersonalSeq
  store.evolutionPersonalLoading = true
  try {
    const data = await request('evolution.personal', {}, LONG_TIMEOUT)
    if (seq !== evolutionPersonalSeq) return null
    if (data && data.state) {
      store.evolutionPersonal = data.state
      store.evolutionPersonalHasKey = data.hasKey === true
      store.evolutionPersonalBusy = data.busy || null
      store.evolutionPersonalError = ''
      store.evolutionSupported = true
      return data.state
    }
    return null
  } catch (error) {
    if (seq !== evolutionPersonalSeq) return null
    if (unsupportedEvolution(error)) {
      store.evolutionSupported = false
      store.evolutionPersonalError = ''
    } else {
      store.evolutionPersonalError =
        error instanceof Error ? error.message : String(error || t("读取失败"))
    }
    return null
  } finally {
    if (seq === evolutionPersonalSeq) store.evolutionPersonalLoading = false
  }
}

/** 执行一个自进化操作；长任务在电脑端后台跑，通过事件推送状态。 */
export async function evolutionAction(action, params = {}) {
  const name = String(action || '')
  if (!name) throw new Error(t("缺少操作名称"))
  const slow =
    name === 'review' ||
    name === 'personalSubmit' ||
    name === 'personalUpgradeValidate'
  const medium =
    name === 'propose' ||
    name === 'personalSave' ||
    name === 'personalUpgradePlan' ||
    name === 'personalUpgradeApply'
  store.evolutionAction = name
  try {
    const data = await request(
      'evolution.action',
      { action: name, ...params },
      slow ? 300_000 : medium ? 120_000 : LONG_TIMEOUT
    )
    store.evolutionSupported = true
    if (name === 'auto' && store.evolution) {
      store.evolution.autoEvolve = params.value === true
    }
    return data
  } catch (error) {
    if (unsupportedEvolution(error)) store.evolutionSupported = false
    throw error
  } finally {
    store.evolutionAction = ''
  }
}

/* ------------------------------------------------------------------ */
/* 反思（自问）                                                        */
/* ------------------------------------------------------------------ */

// 反思设置就是一份 store 快照，读一次几毫秒；不做缓存反而避免手机显示陈旧开关。
const REFLECT_TIMEOUT = 20_000
let reflectPromise = null

/** 电脑端不认识 reflect.* 时（旧版本）返回 true，页面据此收起整个面板。 */
function unsupportedReflect(error) {
  const message = error instanceof Error ? error.message : String(error || '')
  return message.includes('不支持该操作') || message.includes('不支持手机控制反思')
}

function offlineReflect() {
  store.reflect = null
  store.reflectSupported = null
  store.reflectError = ''
  store.reflectReport = null
  return null
}

export async function loadReflect() {
  if (!client?.isConnected()) return offlineReflect()
  if (reflectPromise) return reflectPromise
  store.reflectLoading = true
  const promise = (async () => {
    try {
      const data = await request('reflect.state', {}, REFLECT_TIMEOUT)
      if (data && typeof data === 'object' && data.settings) {
        store.reflect = data
        store.reflectSupported = true
        store.reflectError = ''
        return data
      }
      store.reflectError = t('电脑端返回的数据不完整。')
      return null
    } catch (error) {
      if (unsupportedReflect(error)) {
        store.reflectSupported = false
        store.reflectError = ''
      } else {
        store.reflectError =
          error instanceof Error ? error.message : String(error || t('读取失败'))
      }
      return null
    } finally {
      store.reflectLoading = false
      reflectPromise = null
    }
  })()
  reflectPromise = promise
  return promise
}

/**
 * 保存反思设置。字段名与电脑端 `SettingsUpdate` 一致（`enabled`/`emailTo`…），
 * 授权码留空表示保留原值，不传或传 null 才清除。
 */
export async function saveReflectSettings(patch) {
  if (!client?.isConnected()) throw new Error(t('尚未连接电脑'))
  store.reflectAction = 'saving'
  try {
    const data = await request('reflect.settings', { settings: patch }, REFLECT_TIMEOUT)
    if (data && typeof data === 'object' && data.settings) {
      store.reflect = data
      store.reflectSupported = true
      store.reflectError = ''
      return data
    }
    return null
  } finally {
    store.reflectAction = ''
  }
}

/** 手动触发一次反思。电脑端后台跑几十秒，结果通过 settings.changed 推回来。 */
export async function runReflectNow() {
  if (!client?.isConnected()) throw new Error(t('尚未连接电脑'))
  store.reflectAction = 'running'
  try {
    const data = await request('reflect.now', {}, REFLECT_TIMEOUT)
    if (data?.state?.settings) store.reflect = data.state
    return data
  } finally {
    store.reflectAction = ''
  }
}

/** 发一封测试邮件，返回 { ok, error }。失败不抛，交给页面显示具体原因。 */
export async function sendReflectTestMail(to) {
  if (!client?.isConnected()) throw new Error(t('尚未连接电脑'))
  store.reflectAction = 'mail'
  try {
    const data = await request('reflect.mail.test', { to }, 60_000)
    return { ok: data?.ok === true, error: data?.error || '' }
  } finally {
    store.reflectAction = ''
  }
}

export async function clearReflectReports() {
  if (!client?.isConnected()) throw new Error(t('尚未连接电脑'))
  store.reflectAction = 'clearing'
  try {
    const data = await request('reflect.reports.clear', {}, REFLECT_TIMEOUT)
    if (data && typeof data === 'object' && data.settings) store.reflect = data
    store.reflectReport = null
    return data
  } finally {
    store.reflectAction = ''
  }
}

/** 报告详情：列表只带概要，点开才取发现与依据正文。 */
export async function loadReflectReport(reportId) {
  const id = String(reportId || '')
  if (!id) return null
  if (!client?.isConnected()) return null
  store.reflectReportLoading = true
  try {
    const data = await request('reflect.report', { reportId: id }, REFLECT_TIMEOUT)
    store.reflectReport = data?.report || null
    return store.reflectReport
  } finally {
    store.reflectReportLoading = false
  }
}

export function closeReflectReport() {
  store.reflectReport = null
}

/**
 * 标记一条结论的处理状态：`open` / `done`（已处理）/ `dismissed`（不打算做）。
 *
 * 电脑端已有同一份状态字段，手机端以前只能看不能改；现在在详情页就地标记，
 * 两次读写存的是同一条记录，因此以服务端回包为准重写详情。
 */
export async function setReflectFindingStatus(reportId, findingId, status) {
  const id = String(reportId || '')
  const finding = String(findingId || '')
  if (!id || !finding) throw new Error(t('缺少结论标识'))
  if (!client?.isConnected()) throw new Error(t('尚未连接电脑'))
  const data = await request(
    'reflect.finding',
    { reportId: id, findingId: finding, status },
    REFLECT_TIMEOUT
  )
  const report = data?.report || null
  // 只有正在看的那一份被改时才覆盖详情，避免把别的报告显示到当前弹层里。
  if (report && (store.reflectReport?.id === report.id || !store.reflectReport)) {
    store.reflectReport = report
  }
  return report
}

export async function refreshSessions(force = false) {
  if (!client?.isConnected() || store.loadingSessions) return false
  if (!force && store.sessions.length > 0) return true
  store.loadingSessions = true
  const requestedAt = Date.now()
  try {
    const data = await client.request('sessions.list')
    applySessions(data?.sessions || [], { requestedAt })
    if (Array.isArray(data?.workspaces)) {
      // Pilot 的工作区是对象数组；新建对话的选择器只需要路径。
      store.roots = data.workspaces.map((workspace) => workspace?.path).filter(Boolean)
      applyWorkspaceRoots(data)
      cacheSessions()
    }
    return true
  } catch {
    return false
  } finally {
    store.loadingSessions = false
  }
}

export async function refreshQueue() {
  const sessionId = store.currentSessionId
  if (!client?.isConnected() || !sessionId) return
  try {
    const data = await client.request('sessions.get', { sessionId, limit: 1 })
    if (data?.session) applyQueue(sessionId, data.session.queue)
  } catch {
    // ignore
  }
}

function applyQueue(sessionId, queue) {
  const key = String(sessionId || '')
  if (!key) return
  const rows = normalizeQueue(key, queue)
  const session = store.sessions.find((item) => item.id === key)
  if (session) session.queueCount = rows.length
  if (key === store.currentSessionId) store.queue = rows
}

async function refreshPermissions() {
  if (!client?.isConnected()) return
  try {
    const data = await client.request('approvals.list')
    const rows = (Array.isArray(data?.approvals) ? data.approvals : [])
      .map(normalizeApproval)
      .filter(Boolean)
    store.permissions = rows
    for (const requestId of Object.keys(store.respondingPermissions)) {
      if (!rows.some((item) => item.requestId === requestId)) {
        delete store.respondingPermissions[requestId]
      }
    }
  } catch {
    // ignore
  }
}

async function refreshAgentInfo() {
  if (!client?.isConnected()) return
  try {
    const data = await client.request('device.info')
    if (typeof data?.deviceName === 'string' && data.deviceName) {
      store.deviceName = data.deviceName
    }
    store.agentVersion = typeof data?.appVersion === 'string' ? data.appVersion : ''
  } catch {
    // ignore
  }
  // 旧版电脑端没有 update.state，失败时静默保留「—」。
  void refreshDesktopUpdate()
}

/** 当前会话的完整快照：消息、队列、待办、审批和运行状态一次带回。 */
function applySessionSnapshot(data, sessionId) {
  const session = normalizeSession(data?.session)
  if (!session) return null
  store.currentSession = session
  applySessionUpdate(session)
  if (Array.isArray(session.queue)) applyQueue(sessionId, session.queue)
  if (Array.isArray(session.todos)) applyTodoRows(sessionId, session.todos)
  if (Array.isArray(data?.pendingApprovals)) {
    const rows = data.pendingApprovals.map(normalizeApproval).filter(Boolean)
    // 保留其它会话的审批卡片，只替换当前会话的部分。
    store.permissions = [
      ...store.permissions.filter((item) => item.sessionId !== sessionId),
      ...rows
    ]
  }
  const activeRun = data?.activeRun
  if (activeRun && typeof activeRun.runId === 'string') {
    const now = Date.now()
    store.activeRuns[activeRun.runId] = {
      ...(store.activeRuns[activeRun.runId] || {}),
      runId: activeRun.runId,
      sessionId,
      cwd: session.cwd || '',
      startedAt: toMillis(activeRun.startedAt) || now,
      source: 'pc',
      mode: session.approvalMode,
      instruction: session.runInstruction || '',
      _eventAt: now,
      _fromSession: false
    }
    runFactsAt[sessionId] = now
    watchRunning(sessionId, activeRun.runId, now)
  }
  return session
}

let refreshAllPromise = null
let evolutionRefreshPromise = null
let evolutionRefreshPath = ''
let evolutionPersonalSeq = 0
let lastRefreshAllAt = 0

/**
 * 刷新全部状态。连上连接、电脑端 relay.ready 事件等会几乎同时触发，
 * 这里做一次去重 + 1 秒内的合并，避免同一时刻发两套请求把手机排队堵住。
 */
export function refreshAll() {
  if (refreshAllPromise) return refreshAllPromise
  if (Date.now() - lastRefreshAllAt < 1000) return Promise.resolve()
  lastRefreshAllAt = Date.now()
  // 先把断网时暂存的待办补发，再拉列表，避免手机上的待办被服务端结果覆盖。
  const run = (async () => {
    await syncOfflineTodos()
    await Promise.all([
      refreshAgentInfo(),
      refreshSessions(true),
      refreshQueue(),
      refreshPermissions(),
      // 首页「全部定时任务」的汇总条：顺手取一次跨会话清单，失败不影响其它对账。
      loadAllScheduled()
    ])
    await loadTodos()
  })().finally(() => {
    // 切换电脑时会重置 refreshAllPromise；只在仍是自己时清空，避免把新请求的锁清掉。
    if (refreshAllPromise === run) refreshAllPromise = null
  })
  refreshAllPromise = run
  return run
}

/**
 * 轻量对账：只补运行状态、会话列表和当前会话待办。
 * 中继事件偶尔会丢（例如 App 刚从后台恢复），定期跑一次即可自动恢复。
 */
function refreshLiveState() {
  if (refreshAllPromise) return refreshAllPromise
  if (liveRefreshPromise) return liveRefreshPromise
  if (!client?.isConnected() || !store.agentOnline) return Promise.resolve()
  const run = Promise.all([
    refreshSessions(true),
    refreshQueue(),
    store.currentSessionId ? loadTodos(store.currentSessionId) : Promise.resolve()
  ])
    // 对账后如果电脑端的消息数比本地这一页多，说明收尾事件可能丢了，立刻补一页尾部。
    .then(() => syncSessionTail())
    .finally(() => {
      if (liveRefreshPromise === run) liveRefreshPromise = null
    })
  liveRefreshPromise = run
  return run
}

/**
 * 前台探活：App 从后台回来时 WebSocket 可能已经变成「假在线」，
 * 发一个短超时 ping；失败就重连，成功后立即对账一次。
 */
function probeConnection() {
  if (foregroundProbe) return foregroundProbe
  const active = client
  if (!active?.isConnected()) return Promise.resolve()
  const run = active
    .request('ping', {}, FOREGROUND_PROBE_TIMEOUT)
    .then(() => refreshLiveState())
    .catch(() => {
      // 探活只负责刷新数据，不在这里拆连接：电脑忙、弱网或中继抖动都可能
      // 让一次 5 秒 ping 超时，直接把仍然健康的套接字重连，用户看到的就是
      // 「每次回到前台都重建连接」。真正的失效交给心跳判断：连续两次心跳
      // 没有回帧才收尾重连。
    })
    .finally(() => {
      if (foregroundProbe === run) foregroundProbe = null
    })
  foregroundProbe = run
  return run
}

function startForegroundSync() {
  if (foregroundTimer) return
  foregroundTimer = setInterval(() => {
    if (!foreground || !client?.isConnected() || !store.agentOnline) return
    void refreshLiveState()
  }, FOREGROUND_SYNC_MS)
}

function stopForegroundSync() {
  if (!foregroundTimer) return
  clearInterval(foregroundTimer)
  foregroundTimer = null
}

export async function refreshRoots() {
  if (!client?.isConnected()) return
  try {
    const data = await client.request('workspaces.list')
    if (Array.isArray(data?.workspaces)) {
      store.roots = data.workspaces.map((workspace) => workspace?.path).filter(Boolean)
    }
    applyWorkspaceRoots(data)
  } catch (error) {
    toast(error?.message || t("读取工作目录失败"), 'none', 3000)
  }
}

function applyWorkspaceRoots(data) {
  if (!data || !Array.isArray(data.roots)) return
  store.workspaceRoots = data.roots.filter((root) => typeof root === 'string' && root)
}

/**
 * 列出授权目录下某个子目录里的文件夹，path 为空表示根目录。
 * 只返回文件夹，手机可以逐层进入，选任意层级的子文件夹作为工作区。
 */
export async function browseWorkspaceFolders(root, path = '') {
  if (!root) throw new Error(t("请选择创建位置"))
  const data = await request('workspaces.browse', { root, path: String(path || '') })
  return {
    directory: typeof data?.directory === 'string' ? data.directory : '',
    parent: typeof data?.parent === 'string' ? data.parent : '',
    entries: Array.isArray(data?.entries)
      ? data.entries
          .filter((entry) => entry && typeof entry.name === 'string')
          .map((entry) => ({ name: entry.name, path: String(entry.path || entry.name) }))
      : [],
    truncated: Boolean(data?.truncated)
  }
}

/**
 * 把授权目录里已有的子文件夹注册为工作区（不改变电脑端当前选中的工作区）。
 */
export async function openWorkspaceFolder(root, path) {
  if (!root) throw new Error(t("请选择创建位置"))
  const target = String(path || '').trim()
  if (!target) throw new Error(t("请选择一个文件夹"))
  const workspace = await request('workspaces.open', { root, path: target })
  await refreshRoots()
  return workspace
}

/**
 * 让电脑端在授权目录里新建一个子文件夹并注册为工作区。
 * path 是当前浏览到的子目录（可为空），name 是单层文件夹名；
 * 电脑端会校验授权范围。
 */
export async function createWorkspace(root, name, path = '') {
  const directory = String(name || '').trim()
  if (!directory) throw new Error(t("请输入工作区名称"))
  if (!root) throw new Error(t("请选择创建位置"))
  const workspace = await request('workspaces.create', {
    root,
    name: directory,
    path: String(path || '')
  })
  await refreshRoots()
  return workspace
}

export async function reloadHistory() {
  const sessionId = store.currentSessionId
  if (!sessionId) return
  // 重新加载最新一页，之前的知识库定位窗口不再适用。
  store.focusMessageId = ''
  store.historyNewer = false
  if (!client?.isConnected()) {
    // 断网时只读本地缓存，不清空已经显示的内容。
    if (!store.messages.length) {
      const cached = loadHistoryCache(storageDeviceId(), sessionId)
      if (cached) {
        applyHistory(cached)
      } else {
        store.messages = [
          {
            id: `offline-${sessionId}`,
            role: 'system',
            blocks: [
              {
                type: 'text',
                text: t("当前离线，这台手机上还没有这个会话的缓存。联网后会自动加载。")
              }
            ]
          }
        ]
        store.messageIds = {}
        store.historyBefore = null
      }
    }
    store.historyLoading = false
    return
  }
  const token = ++store.historyToken
  store.historyLoading = true
  // 刚进入会话时先用内存里的上一次记录占位，网络回来后再替换。
  if (store.messages.length === 0) {
    const cached = historyCache.get(sessionId)
    if (cached) applyHistory(cached)
  }
  try {
    const data = await client.request('sessions.get', {
      sessionId,
      limit: HISTORY_PAGE_SIZE
    })
    if (token !== store.historyToken || store.currentSessionId !== sessionId) return
    const messages = (Array.isArray(data?.session?.messages) ? data.session.messages : [])
      .map(normalizeMessage)
      .filter(Boolean)
    store.messages = messages
    store.messageIds = {}
    for (const message of messages) {
      if (message?.id) store.messageIds[message.id] = true
    }
    const session = applySessionSnapshot(data, sessionId)
    store.historyBefore = data?.hasMore && messages.length ? messages[0].id : null
    // 记下这一页对应的电脑端消息总数，供 syncSessionTail 判断尾部是否过期。
    // 电脑端没报计数时置 0，宁可不补也不要每个对账周期重拉一遍。
    store.tailCount = Number(data?.session?.messageCount) || 0
    rememberHistory(sessionId, messages, store.historyBefore, session)
  } catch (error) {
    if (token !== store.historyToken) return
    // 已经用缓存铺过内容时不要把界面清空，只提示刷新失败。
    if (store.messages.length > 0) {
      toast(t("刷新会话记录失败：{v1}", { v1: error?.message || error }), 'none', 3000)
      return
    }
    store.messages = [
      {
        id: `error-${Date.now()}`,
        role: 'system',
        error: true,
        blocks: [{ type: 'text', text: t("加载会话记录失败：{v1}", { v1: error?.message || error }) }]
      }
    ]
    store.messageIds = {}
  } finally {
    if (token === store.historyToken) store.historyLoading = false
  }
}

/**
 * 选中会话（同步完成），历史记录由页面自行加载。
 * 会话页点开时可以先跳转、再加载，用户不用盯着列表等网络。
 */
export function selectSession(sessionId) {
  if (!sessionId) return
  const same = store.currentSessionId === sessionId
  // 打开会话即视为已查看，完成标记立刻消失。
  clearSessionUnread(sessionId)
  store.currentSessionId = sessionId
  store.currentSession = store.sessions.find((item) => item.id === sessionId) || {
    id: sessionId,
    title: t("会话")
  }
  store.newChat = null
  store.pendingHistoryReload = ''
  if (!same) {
    store.messages = []
    store.messageIds = {}
    store.historyBefore = null
    store.tailCount = 0
    tailFallbackAt = 0
    store.focusMessageId = ''
    store.historyNewer = false
    store.todos = []
    store.todosSessionId = ''
    store.scheduled = []
    store.scheduledSessionId = ''
    resetStream()
    // 先显示这台手机上次缓存的正文，网络回来后再由 reloadHistory 覆盖。
    const cachedHistory = loadHistoryCache(storageDeviceId(), sessionId)
    if (cachedHistory) applyHistory(cachedHistory)
  }
  void loadTodos(sessionId)
  void loadScheduled(sessionId)
}

export async function openSession(sessionId) {
  if (!sessionId) return
  selectSession(sessionId)
  await reloadHistory()
}

/**
 * 从知识库打开某条历史消息：请求以命中项为中心的一页，
 * 更早的消息继续用「加载更早」补齐，更新的消息用「回到最新」回到末尾。
 */
export async function openSessionAt(sessionId, messageId) {
  if (!sessionId) return
  const focusId = String(messageId || '')
  selectSession(sessionId)
  store.historyNewer = false
  store.focusMessageId = focusId
  if (!focusId) {
    await reloadHistory()
    return
  }

  if (!client?.isConnected()) {
    // 离线时只能在缓存里定位；缓存没有这一页就保持普通历史视图。
    if (!store.messages.length) {
      const cached = loadHistoryCache(storageDeviceId(), sessionId)
      if (cached) applyHistory(cached)
    }
    if (!store.messages.some((message) => message?.id === focusId)) {
      store.focusMessageId = ''
    }
    return
  }

  const token = ++store.historyToken
  store.historyLoading = true
  try {
    const data = await client.request('sessions.get', {
      sessionId,
      around: focusId,
      limit: HISTORY_PAGE_SIZE
    })
    if (token !== store.historyToken || store.currentSessionId !== sessionId) return
    const messages = (Array.isArray(data?.session?.messages) ? data.session.messages : [])
      .map(normalizeMessage)
      .filter(Boolean)
    if (!messages.some((message) => message?.id === focusId)) {
      // 电脑端找不到这条消息（例如已被上下文压缩），退回最新一页。
      store.focusMessageId = ''
      await reloadHistory()
      return
    }
    store.messages = messages
    store.messageIds = {}
    for (const message of messages) {
      if (message?.id) store.messageIds[message.id] = true
    }
    const session = applySessionSnapshot(data, sessionId)
    store.historyBefore = data?.hasMore && messages.length ? messages[0].id : null
    store.historyNewer = data?.hasNewer === true
    rememberHistory(sessionId, messages, store.historyBefore, session)
  } catch (error) {
    toast(t("定位历史消息失败：{v1}", { v1: error?.message || error }), 'none', 3000)
    store.focusMessageId = ''
    await reloadHistory()
  } finally {
    if (token === store.historyToken) store.historyLoading = false
  }
}

/** 从知识库定位窗口回到最新一页。 */
export async function backToLatest() {
  if (!store.currentSessionId) return
  await reloadHistory()
}

/**
 * 补齐会话尾部：中继丢帧、App 切到后台、局域网/中继切换都可能让
 * run.completed 收不到，此时手机会停在上一页，最后一轮问答看起来「消失」，
 * 而知识库每次都是重新请求，所以仍然能看到。
 * 用电脑端会话列表里的 messageCount 和上次拉取时的计数比较，只有确实多了消息
 * 才重新拉一页，避免每次前台对账都重复传输整页历史。
 */
export function syncSessionTail() {
  const sessionId = store.currentSessionId
  const listed = sessionId ? store.sessions.find((item) => item.id === sessionId) : null
  const decision = decideTailSync({
    connected: Boolean(client?.isConnected()),
    agentOnline: store.agentOnline,
    sessionId,
    loading: store.historyLoading,
    focusMessageId: store.focusMessageId,
    historyNewer: store.historyNewer,
    running:
      store.currentSession?.running === true ||
      listed?.running === true ||
      Boolean(sessionId && runForSession(sessionId)),
    remoteCount: Math.max(
      Number(listed?.messageCount) || 0,
      Number(store.currentSession?.messageCount) || 0
    ),
    knownCount: store.tailCount,
    streaming: Boolean(store.streamText || store.streamReasoning),
    fallbackAt: tailFallbackAt,
    now: Date.now(),
    last: store.messages.length ? store.messages[store.messages.length - 1] : null
  })
  if (!decision.sync || !sessionId) return Promise.resolve()
  if (decision.fallback) tailFallbackAt = Date.now()
  // 运行已经结束：清掉可能残留的流式占位，否则界面会一直停在「执行中…」。
  if (store.streamText || store.streamReasoning || store.streamRunId) resetStream()
  return reloadHistory()
}

/**
 * 会话知识库检索。
 * 联网时用电脑端的全量检索；电脑离线时退回本机缓存，结果里带上 source。
 */
export async function searchKnowledge(query, options = {}) {
  const needle = String(query || '').trim()
  if (!needle) return { hits: [], source: 'none' }
  const limit = Math.max(1, Math.min(120, Math.round(Number(options.limit) || 60)))
  const filter = options.filter && typeof options.filter === 'object' ? options.filter : {}
  const online = Boolean(client?.isConnected()) && store.agentOnline
  if (online) {
    try {
      const data = await client.request('sessions.search', {
        query: needle,
        limit,
        ...(filter.workspacePath ? { workspacePath: filter.workspacePath } : {}),
        ...(filter.sessionId ? { sessionId: filter.sessionId } : {}),
        ...(filter.role ? { role: filter.role } : {}),
        ...(filter.since ? { since: filter.since } : {})
      })
      return {
        hits: Array.isArray(data?.hits) ? data.hits : [],
        source: 'pc'
      }
    } catch {
      // 旧版电脑端可能还没有 sessions.search，继续用本机缓存。
    }
  }
  return {
    hits: searchLocalKnowledge(store.sessions, loadHistoryCacheAll(storageDeviceId()), needle, {
      limit,
      filter
    }),
    source: 'cache'
  }
}

const KNOWLEDGE_PAGE_SIZE = 25
const KNOWLEDGE_MAX_PAGES = 20
const KNOWLEDGE_MESSAGE_CACHE_SIZE = 6
// 旧版电脑端没有 sessions.knowledge 时，分页拉下来的会话正文按会话缓存，
// 搜索时直接复用，避免每输入一个字就把整段会话重新拉一遍。
const knowledgeMessageCache = new Map()

function stripKnowledgeImages(message) {
  // 知识库只需要知道这条消息带过图片，不把 base64 正文留在内存里。
  const blocks = Array.isArray(message.blocks) ? message.blocks : []
  return {
    id: message.id,
    role: message.role,
    createdAt: message.createdAt,
    timestamp: message.createdAt || '',
    blocks: blocks.map((block) =>
      block && block.type === 'image' ? { type: 'image' } : block
    )
  }
}

async function loadKnowledgeMessages(sessionId) {
  const session = store.sessions.find((item) => item.id === sessionId) || null
  const stamp = String((session && (session.lastModified || session.updatedAt)) || '')
  const cached = knowledgeMessageCache.get(sessionId)
  if (stamp && cached && cached.stamp === stamp) return cached
  let messages = []
  let before = ''
  let truncated = false
  for (let page = 0; page < KNOWLEDGE_MAX_PAGES; page += 1) {
    const data = await client.request('sessions.get', {
      sessionId,
      limit: KNOWLEDGE_PAGE_SIZE,
      ...(before ? { before } : {})
    }, RESOURCE_FALLBACK_TIMEOUT)
    const normalized = (Array.isArray(data?.session?.messages) ? data.session.messages : [])
      .map(normalizeMessage)
      .filter(Boolean)
    const raw = normalized.map(conversationOnly).filter(Boolean).map(stripKnowledgeImages)
    messages = [...raw, ...messages]
    if (!data?.hasMore || normalized.length === 0) break
    // 下一页以原始消息里的最早一条为锚点：工具消息被过滤掉也不影响分页。
    const nextBefore = normalized[0] && normalized[0].id
    if (!nextBefore || nextBefore === before) break
    before = nextBefore
    if (page === KNOWLEDGE_MAX_PAGES - 1) truncated = true
  }
  const entry = { messages, truncated, stamp }
  knowledgeMessageCache.delete(sessionId)
  knowledgeMessageCache.set(sessionId, entry)
  while (knowledgeMessageCache.size > KNOWLEDGE_MESSAGE_CACHE_SIZE) {
    knowledgeMessageCache.delete(knowledgeMessageCache.keys().next().value)
  }
  return entry
}

/**
 * 读取某个会话的知识库：电脑端把整段会话整理成「我的指令 → Pilot 回复」返回；
 * 旧版电脑端没有 sessions.knowledge 时分页拉取会话正文本地整理；
 * 电脑离线时用本机缓存的会话正文整理。
 */
export async function loadSessionKnowledge(sessionId, options = {}) {
  const id = String(sessionId || store.currentSessionId || '')
  if (!id) return { pairs: [], total: 0, hasMore: false, source: 'none' }
  const query = String(options.query || '').trim()
  const limit = Math.max(1, Math.min(200, Math.round(Number(options.limit) || 60)))
  const deviceId = storageDeviceId()
  const online = Boolean(client?.isConnected()) && store.agentOnline
  if (online) {
    try {
      const data = await client.request('sessions.knowledge', {
        sessionId: id,
        limit,
        ...(query ? { query } : {})
      }, RESOURCE_TIMEOUT)
      if (Array.isArray(data?.pairs)) {
        const result = {
          pairs: data.pairs,
          total: Number(data.total) || data.pairs.length,
          hasMore: data.hasMore === true,
          source: 'pc'
        }
        // 只有完整列表值得缓存；搜索结果只覆盖本次展示。
        if (!query) saveKnowledgeCache(deviceId, id, result)
        return result
      }
    } catch {
      // 旧版电脑端可能还没有 sessions.knowledge，改用分页读取。
    }
    try {
      const entry = await loadKnowledgeMessages(id)
      const all = filterKnowledgePairs(buildKnowledgePairs(entry.messages), query)
      const pairs = all.slice(-limit)
      const result = {
        pairs,
        total: all.length,
        hasMore: entry.truncated === true || all.length > pairs.length,
        source: 'pc'
      }
      if (!query) saveKnowledgeCache(deviceId, id, result)
      return result
    } catch {
      // 分页也失败时退回本机缓存。
    }
  }
  // 电脑端整理好的知识库比本地历史缓存完整，优先使用。
  const knowledge = loadKnowledgeCache(deviceId, id)
  if (knowledge && knowledge.pairs.length) {
    const matched = filterKnowledgePairs(knowledge.pairs, query)
    const pairs = matched.slice(-limit)
    return {
      pairs,
      total: query ? matched.length : knowledge.total || knowledge.pairs.length,
      // 缓存本来就可能只覆盖最近若干条；搜索时也要说明更早内容没有缓存。
      hasMore: knowledge.hasMore || matched.length > pairs.length,
      source: 'cache'
    }
  }
  const cached = loadHistoryCacheAll(deviceId)
  const entry = cached && typeof cached === 'object' ? cached[id] : null
  const cachedMessages = entry && Array.isArray(entry.messages) ? entry.messages : []
  const liveMessages =
    store.currentSessionId === id && Array.isArray(store.messages) ? store.messages : []
  const messages = cachedMessages.length >= liveMessages.length ? cachedMessages : liveMessages
  const all = filterKnowledgePairs(buildKnowledgePairs(messages), query)
  const pairs = all.slice(-limit)
  return {
    pairs,
    total: all.length,
    hasMore: all.length > pairs.length,
    source: 'cache'
  }
}

/**
 * 中继连着不等于电脑端在线：电脑端 Pilot 退出后中继仍会保持会话。
 * 资源类请求都按这个口径判断，避免「有连接但读不到内容」。
 */
export function isAgentOnline() {
  return Boolean(client?.isConnected()) && store.agentOnline
}

/**
 * 读取某个会话里出现过的链接（任务卡片上的「链接」预览）。
 *
 * 只读会话正文，不访问网络：电脑端返回它整理好的列表；旧版电脑端没有
 * `sessions.links`、或电脑离线时，依次退回 `sessions.get` 的正文与手机缓存正文。
 */
export async function loadSessionLinks(sessionId, options = {}) {
  const id = String(sessionId || store.currentSessionId || '')
  if (!id) return { links: [], total: 0, hasMore: false, source: 'none' }
  const limit = Math.max(1, Math.min(SESSION_LINK_LIMIT, Math.round(Number(options.limit)) || SESSION_LINK_LIMIT))
  const online = isAgentOnline()
  let remote = null
  if (online) {
    try {
      const data = await client.request('sessions.links', { sessionId: id, limit }, RESOURCE_TIMEOUT)
      if (Array.isArray(data?.links)) {
        const links = normalizeSessionLinks(data.links, limit)
        const total = Number(data.total) || links.length
        // 「还有更多」按电脑端给出的总数与本次上限比较：用 links.length 比较会在
        // 有条目被过滤时误报成「只显示最近 0 条」。
        remote = { links, total, hasMore: data.hasMore === true || total > limit, source: 'pc' }
        // 电脑端正文还没加载时它会返回空表（旧会话/刚重启），
        // 这时先别把它当结论：本地还有缓存正文就先用着。
        if (links.length > 0) return remote
      }
    } catch {
      // 旧版电脑端没有这个方法，或这中间断线：下面用正文自己整理。
    }
    // 兜底①：`sessions.get` 是最早就有的方法，旧版电脑端也能拿到正文。
    // 没有这一步，电脑端版本稍旧的人点「链接」永远是一片空。
    try {
      const data = await client.request('sessions.get', { sessionId: id, limit: 300 }, RESOURCE_FALLBACK_TIMEOUT)
      const messages = Array.isArray(data?.session?.messages) ? data.session.messages : []
      const links = extractSessionLinks(messages, limit)
      if (links.length > 0) {
        return { links, total: links.length, hasMore: false, source: 'pc' }
      }
    } catch {
      // 会话不存在或断线：继续走缓存。
    }
  }
  const liveMessages =
    store.currentSessionId === id && Array.isArray(store.messages) ? store.messages : []
  const cachedAll = loadHistoryCacheAll(storageDeviceId())
  const entry = cachedAll && typeof cachedAll === 'object' ? cachedAll[id] : null
  const cachedMessages = entry && Array.isArray(entry.messages) ? entry.messages : []
  const messages = cachedMessages.length >= liveMessages.length ? cachedMessages : liveMessages
  const links = extractSessionLinks(messages, limit)
  if (links.length === 0 && remote) return remote
  return { links, total: links.length, hasMore: false, source: 'cache' }
}

/**
 * 只读本机缓存，立即返回这个会话里出现过的链接。
 *
 * 页面先用它上一次屏幕，再在后台等电脑端结果：中继假在线时（`sessions.links`
 * 和 `sessions.get` 都要等到超时）用户不必对着空列表干等十几秒。
 */
export function cachedSessionLinks(sessionId, options = {}) {
  const id = String(sessionId || store.currentSessionId || '')
  if (!id) return []
  const limit = Math.max(1, Math.min(SESSION_LINK_LIMIT, Math.round(Number(options.limit)) || SESSION_LINK_LIMIT))
  const liveMessages =
    store.currentSessionId === id && Array.isArray(store.messages) ? store.messages : []
  const cachedAll = loadHistoryCacheAll(storageDeviceId())
  const entry = cachedAll && typeof cachedAll === 'object' ? cachedAll[id] : null
  const cachedMessages = entry && Array.isArray(entry.messages) ? entry.messages : []
  const messages = cachedMessages.length >= liveMessages.length ? cachedMessages : liveMessages
  return extractSessionLinks(messages, limit)
}

/**
 * 读取这个任务的工作区在一次运行里会拿到哪些工具。
 *
 * 工具清单只在电脑端成立（取决于 shell 模式、学习策略、MCP 开关和工作区里
 * 自写的工具），手机本地无法可靠重建，所以电脑离线时返回空列表由页面提示。
 */
export async function loadSessionTools(sessionId, options = {}) {
  const id = String(sessionId || store.currentSessionId || '')
  if (!id) return { tools: [], total: 0, hasMore: false, mcpEnabled: false, source: 'none' }
  const limit = Math.max(
    1,
    Math.min(SESSION_TOOL_LIMIT, Math.round(Number(options.limit)) || SESSION_TOOL_LIMIT)
  )
  const online = Boolean(client?.isConnected()) && store.agentOnline
  if (!online) return { tools: [], total: 0, hasMore: false, mcpEnabled: false, source: 'offline' }
  try {
    const data = await client.request('sessions.tools', { sessionId: id, limit }, RESOURCE_FALLBACK_TIMEOUT)
    const tools = normalizeSessionTools(data?.tools, limit)
    const total = Number(data?.total) || tools.length
    return {
      tools,
      total,
      hasMore: data?.hasMore === true || total > tools.length,
      mcpEnabled: data?.mcpEnabled === true,
      source: 'pc'
    }
  } catch (error) {
    // 旧版电脑端没有 sessions.tools：明确告诉用户需要升级，而不是空列表装死。
    const message = String(error?.message || '')
    const unsupported = /unknown method|unsupported|not found|方法不存在|不支持/i.test(message)
    return {
      tools: [],
      total: 0,
      hasMore: false,
      mcpEnabled: false,
      source: unsupported ? 'unsupported' : 'error',
      message
    }
  }
}

/**
 * 更早的消息只保留会话正文（文字与图片），
 * 思考过程、工具调用和工具结果不再带进来，避免历史分页把执行过程越堆越多。
 */
function conversationOnly(message) {
  if (!message || typeof message !== 'object') return null
  const blocks = Array.isArray(message.blocks)
    ? message.blocks.filter(
        (block) => block && (block.type === 'text' || block.type === 'image')
      )
    : []
  if (!blocks.length) return null
  return { ...message, blocks }
}

export async function loadEarlier() {
  if (store.historyLoading || !store.historyBefore || !store.currentSessionId) return
  const sessionId = store.currentSessionId
  const token = store.historyToken
  store.historyLoading = true
  try {
    // 一页「加载更早」必须落回一页真正的问答正文。
    // 电脑端认 conversation 参数时一页就是 25 条正文；旧版电脑端会忽略它、
    // 仍返回 25 条原始消息（其中绝大多数是工具调用与工具结果），过滤后常常
    // 一条正文都没有，所以这一次点击里继续往前补页。
    let before = store.historyBefore
    let rows = []
    let nextBefore = null
    for (let round = 0; ; round += 1) {
      const data = await request('sessions.get', {
        sessionId,
        before,
        limit: HISTORY_PAGE_SIZE,
        conversation: true
      })
      if (token !== store.historyToken || store.currentSessionId !== sessionId) return
      const raw = (Array.isArray(data?.session?.messages) ? data.session.messages : [])
        .map(normalizeMessage)
        .filter(Boolean)
      const pageRows = raw.map(conversationOnly).filter(Boolean)
      rows = [...pageRows, ...rows]
      const hasMore = data?.hasMore === true
      nextBefore = hasMore && raw.length ? raw[0].id : null
      if (!nextBefore) break
      if (!earlierContinue({
        round,
        received: raw.length,
        conversationCount: pageRows.length,
        hasMore
      })) {
        break
      }
      before = nextBefore
    }
    const fresh = rows.filter((message) => message?.id && !store.messageIds[message.id])
    store.messages = [...fresh, ...store.messages]
    for (const message of fresh) store.messageIds[message.id] = true
    store.historyBefore = nextBefore
    rememberHistory(sessionId, store.messages, store.historyBefore, store.currentSession || null)
  } catch (error) {
    toast(error?.message || t("加载更早消息失败"), 'none', 3000)
  } finally {
    store.historyLoading = false
  }
}

/* ------------------------------------------------------------------ */
/* 连接与配对                                                          */
/* ------------------------------------------------------------------ */

function handleState(info) {
  store.connectionState = info.state
  if (info.message) store.connectionMessage = info.message
  if (info.state === 'connected') {
    store.connectionMessage = ''
    store.connectionTransport = info.transport === 'lan' ? 'lan' : 'relay'
    // Pilot 的电脑端就是 WebSocket 服务本身：连接成功即代表电脑在线。
    store.agentOnline = true
  } else {
    store.agentOnline = false
    store.connectionTransport = ''
  }
  if (info.state === 'expired' || info.state === 'auth' || info.state === 'revoked') {
    store.serverError = info.message || ''
  }
}

function stopClient() {
  const current = client
  client = null
  try {
    current?.stop()
  } catch {
    // ignore
  }
  // 后台掉线且配对已失效时没有可重连的对象，不必继续持有唤醒锁。
  if (!foreground) releaseLinkKeepAlive()
}

/** 清空当前电脑的会话/运行状态；切换电脑时保留配对列表。 */
function resetSessionState() {
  historyCache.clear()
  resetStream()
  lastSessionsCacheSaveAt = 0
  // 刚切到另一台电脑：清掉上一次刷新的合并窗口，否则新连接的首次刷新
  // 可能被 1 秒去重直接吞掉，列表会一直空着。
  lastRefreshAllAt = 0
  refreshAllPromise = null
  liveRefreshPromise = null
  foregroundProbe = null
  for (const key of Object.keys(todoFactsAt)) delete todoFactsAt[key]
  for (const key of Object.keys(runFactsAt)) delete runFactsAt[key]
  for (const key of Object.keys(planFactsAt)) delete planFactsAt[key]
  store.sessions = []
  store.roots = []
  store.messages = []
  store.messageIds = {}
  store.currentSessionId = ''
  store.currentSession = null
  store.newChat = null
  store.activeRuns = {}
  store.unreadSessions = {}
  runningWatch.clear()
  store.queue = []
  store.todos = []
  store.todosSessionId = ''
  store.todosLoading = false
  store.todoBusy = false
  store.scheduled = []
  store.scheduledSessionId = ''
  store.scheduledLoading = false
  store.scheduledBusy = false
  store.scheduledAllGroups = []
  store.scheduledAllAt = ''
  store.todoCounts = {}
  store.evolution = null
  store.evolutionLoading = false
  store.evolutionError = ''
  store.evolutionWorkspace = ''
  store.evolutionAction = ''
  store.evolutionSupported = null
  store.evolutionPersonal = null
  store.evolutionPersonalHasKey = false
  store.evolutionPersonalLoading = false
  store.evolutionPersonalError = ''
  store.evolutionPersonalBusy = null
  evolutionRefreshPromise = null
  evolutionRefreshPath = ''
  evolutionPersonalSeq += 1
  store.permissions = []
  store.respondingPermissions = {}
  store.streamText = ''
  store.streamReasoning = ''
  store.streamRunId = ''
  store.sending = false
  store.stopBusy = false
  store.pauseBusy = false
  store.historyBefore = null
  store.focusMessageId = ''
  store.historyNewer = false
  store.historyLoading = false
  store.historyToken += 1
  store.pendingHistoryReload = ''
  store.loadingSessions = false
  store.agentOnline = false
  store.desktopUpdate = null
  store.desktopUpdateSupported = null
  store.agentVersion = ''
  store.serverError = ''
  store.connectionMessage = ''
  store.connectionState = 'idle'
  store.connectionTransport = ''
  lastActiveHint = 0
}

function activatePairing(pairing) {
  if (!pairing) return
  store.pairing = pairing
  store.deviceName = pairing.deviceName || t("我的电脑")
  store.needPair = false
  store.pairError = ''
  store.unreadSessions = loadUnreadSessions(pairing.deviceId)
  runningWatch.clear()
  const cached = loadSessionsCache(pairing.deviceId)
  if (cached) {
    // 缓存里的运行信息不直接展示，但先记下来：连上电脑后如果它已经不在运行，
    // 说明 App 不在前台时任务结束了，要补一个「已完成」标记。
    for (const session of cached.sessions) {
      if (session?.running && session.id) watchRunning(session.id, session.runId, 0)
    }
    // 旧缓存可能带着上次的运行中标记，冷启动时先全部清掉，等连上电脑再刷新。
    store.sessions = cached.sessions.map(withoutRunState)
    if (cached.roots.length) store.roots = cached.roots
    // 断网冷启动也要显示上次的待办数量，并补上还没同步的离线待办。
    rebuildTodoCounts()
  }
  startClient()
}

/** 当前电脑的配对失效（被解除、过期、鉴权失败）时，尝试切换到另一台。 */
function handlePairingLost(message) {
  const lostId = store.pairing?.deviceId || ''
  stopClient()
  if (lostId) {
    removePairing(lostId)
    clearSessionsCache(lostId)
    clearOfflineCache(lostId)
  }
  resetSessionState()
  store.pairing = null
  store.deviceName = ''
  const data = loadPairings()
  store.pairings = data.items
  const next = data.items.find((item) => !pairingExpiredLocally(item))
  if (next) {
    setActivePairing(next.deviceId)
    activatePairing(next)
    toast(t("已切换到 {v1}", { v1: next.deviceName || t('另一台电脑') }))
    goSessions()
    return
  }
  for (const item of [...data.items]) {
    removePairing(item.deviceId)
    clearSessionsCache(item.deviceId)
    clearOfflineCache(item.deviceId)
  }
  store.pairings = []
  store.needPair = true
  clearKeepAliveRetry()
  stopKeepAliveService()
  refreshKeepAliveDiagnostics()
  store.pairError = message || ''
  goPair(message || '')
}

/** 切换到另一台已配对的电脑；不改变当前页面。 */
export function switchToDevice(deviceId) {
  const target = String(deviceId || '')
  if (!target || target === store.pairing?.deviceId) return false
  const data = setActivePairing(target)
  const pairing = data.items.find((item) => item.deviceId === target)
  if (!pairing) {
    store.pairings = data.items
    return false
  }
  if (pairingExpiredLocally(pairing)) {
    removePairing(target)
    clearSessionsCache(target)
    clearOfflineCache(target)
    store.pairings = loadPairings().items
    toast(t("这台电脑的配对已超过 7 天未使用，请重新扫码"))
    return false
  }
  stopClient()
  resetSessionState()
  store.pairings = data.items
  activatePairing(pairing)
  toast(t("已切换到 {v1}", { v1: pairing.deviceName || t('另一台电脑') }))
  return true
}

/** 移除一台电脑；移除当前电脑时自动切换到剩下的第一台。 */
export function removeDevice(deviceId) {
  const target = String(deviceId || '')
  if (!target) return false
  if (target === store.pairing?.deviceId) {
    unpair()
    return true
  }
  removePairing(target)
  clearSessionsCache(target)
  clearOfflineCache(target)
  // 保持当前电脑的配对对象引用不变，避免 RelayClient 与界面短暂指向不同对象。
  store.pairings = store.pairings.filter((item) => item.deviceId !== target)
  toast(t("已移除该电脑"))
  return true
}

/**
 * 系统网络恢复（Wi-Fi 与移动网络切换、飞行模式关闭）时立即重连，不必等
 * 指数退避自然到期。只绑定一次；回调里始终引用当前的 client。
 */
function bindNetworkEvents() {
  if (networkListenerBound) return
  try {
    if (typeof uni === 'undefined' || typeof uni.onNetworkStatusChange !== 'function') return
    networkListenerBound = true
    uni.onNetworkStatusChange((event) => {
      if (event?.isConnected !== true) return
      if (!store.pairing) return
      if (!client) {
        startClient()
        return
      }
      if (!client.isConnected()) client.onNetworkOnline()
      else void probeConnection()
    })
  } catch {
    networkListenerBound = false
  }
}

function clearKeepAliveRetry() {
  if (keepAliveRetryTimer) clearTimeout(keepAliveRetryTimer)
  keepAliveRetryTimer = null
}

function refreshKeepAliveDiagnostics() {
  const status = getKeepAliveStatus()
  store.keepAliveState = status.started ? 'service' : 'off'
  store.keepAliveError = status.error || ''
}

/**
 * 启动壳里的前台服务，并在失败时重试。
 * `force` 用于回到前台：ROM 可能已经把服务清掉，但 JS 里还记着「已启动」。
 */
function ensureKeepAlive(options = {}) {
  if (!store.pairing) {
    clearKeepAliveRetry()
    stopKeepAliveService()
    refreshKeepAliveDiagnostics()
    return false
  }
  const ok = startKeepAliveService(undefined, { force: options.force === true })
  refreshKeepAliveDiagnostics()
  if (ok || options.retry === false) return ok
  if (keepAliveRetryTimer) return false
  let attempt = 0
  const retry = () => {
    keepAliveRetryTimer = null
    if (!store.pairing || !foreground) return
    if (startKeepAliveService(undefined, { force: true })) {
      refreshKeepAliveDiagnostics()
      return
    }
    refreshKeepAliveDiagnostics()
    attempt += 1
    if (attempt < KEEPALIVE_RETRY_MS.length) {
      keepAliveRetryTimer = setTimeout(retry, KEEPALIVE_RETRY_MS[attempt])
    }
  }
  keepAliveRetryTimer = setTimeout(retry, KEEPALIVE_RETRY_MS[0])
  return false
}

function refreshBatteryState() {
  const value = isBatteryUnrestricted()
  if (typeof value === 'boolean') store.batteryUnrestricted = value
}

function startClient() {
  if (!store.pairing) return
  // 新壳里用前台服务托住进程；旧壳没有这个类，调用会静默失败并退回
  // onAppHide 里的 PARTIAL_WAKE_LOCK。
  ensureKeepAlive({ force: true })
  refreshBatteryState()
  client?.stop()
  client = new RelayClient(store.pairing, {
    onState: handleState,
    onWelcome(frame) {
      store.deviceName = frame.deviceName || store.pairing?.deviceName || t("我的电脑")
      store.agentOnline = true
      store.serverError = ''
      if (store.pairing && frame.deviceName && store.pairing.deviceName !== frame.deviceName) {
        store.pairing.deviceName = frame.deviceName
        savePairing(store.pairing)
      }
      void refreshAll()
      if (store.currentSessionId) {
        // 重连后保持知识库定位：仍在原来那条命中消息附近，而不是跳回末尾。
        if (store.focusMessageId) {
          void openSessionAt(store.currentSessionId, store.focusMessageId)
        } else {
          void reloadHistory()
        }
      }
    },
    onEvent,
    onServerError(message) {
      store.serverError = message
    },
    onFatal(kind, message) {
      if (kind === 'replaced') {
        store.connectionMessage = t("这个配对正在另一处使用，请稍后重试")
        return
      }
      handlePairingLost(message)
    }
  })
  // 网络恢复事件可能在 App 已经退到后台时补建客户端，创建后对齐前后台状态。
  client.setForeground(foreground)
  client.connect()
}

export function init() {
  if (initialized) return
  // 先置位避免页面 onLoad/onShow 重入，但任一步抛错都要复位：
  // 否则 initialized 已为 true，后续 init() 全部直接返回，App 永远停在半初始化状态
  // （store.pairing 与 store.ready 不一致，页面渲染不出内容，看起来就是黑屏）。
  initialized = true
  try {
    initI18n()
    bindNetworkEvents()
    store.phoneName = loadPhoneName()
    store.sessionModes = loadSessionModes()
    initTheme()
    // 上次后台回来的结果要跨冷启动保留：进程被回收时，结果只能写在存储里。
    const savedBackgroundReport = readStoredJson(uni, BG_REPORT_KEY)
    store.backgroundReport =
      savedBackgroundReport && typeof savedBackgroundReport === 'object'
        ? savedBackgroundReport
        : null
    const data = loadPairings()
    store.pairings = data.items
    store.ready = true
    if (!data.items.length) {
      store.needPair = true
      return
    }

    let active = data.items.find((item) => item.deviceId === data.activeId) || data.items[0]
    if (pairingExpiredLocally(active)) {
      removePairing(active.deviceId)
      clearSessionsCache(active.deviceId)
      clearOfflineCache(active.deviceId)
      const remaining = loadPairings()
      // 顺手清掉其它已过期的电脑，避免切换列表里出现永远连不上的条目。
      for (const item of [...remaining.items]) {
        if (!pairingExpiredLocally(item)) continue
        removePairing(item.deviceId)
        clearSessionsCache(item.deviceId)
        clearOfflineCache(item.deviceId)
      }
      store.pairings = loadPairings().items
      active = store.pairings.find((item) => !pairingExpiredLocally(item))
      if (!active) {
        store.needPair = true
        store.pairError = t("已超过 7 天未使用，请在电脑上重新生成配对二维码")
        return
      }
    }

    setActivePairing(active.deviceId)
    store.pairings = loadPairings().items
    // 先用上次的会话列表把界面铺满，再在后台刷新（弱网/冷启动体感差别很大）。
    activatePairing(
      store.pairings.find((item) => item.deviceId === active.deviceId) || active
    )
  } catch (err) {
    // 初始化中途失败：复位标记让下次进入页面能重试，同时把界面引向可操作的状态，
    // 绝不能把用户停在一片只有背景色的空页上。
    initialized = false
    store.ready = true
    if (!store.pairing) store.needPair = true
    console.error('[pilot] init 失败', err)
  }
}
export function needsPair() {
  return !store.pairing
}

/**
 * 向已连接的电脑申请一张换机二维码。
 *
 * 二维码只在当前页面内存里停留，不写存储；离开页面或刷新后旧码立即丢弃。
 * 电脑端只接受已认证手机的这个请求，二维码短时有效且只能使用一次。
 */
export async function createConnectQr() {
  if (!client?.isConnected()) throw new Error(t('尚未连接电脑'))
  const data = await request('pairing.transfer', {}, LONG_TIMEOUT)
  const qrDataUrl = String(data?.qrDataUrl || '')
  if (!qrDataUrl.startsWith('data:image/')) throw new Error(t('电脑没有返回连接二维码'))
  return {
    qrDataUrl,
    expiresAt: String(data?.expiresAt || ''),
    mode: data?.mode === 'cloud' ? 'cloud' : 'lan'
  }
}

/** 用扫描/粘贴得到的配对载荷完成配对。 */
export async function pairWithPayload(payload) {
  if (store.pairBusy) return false
  store.pairBusy = true
  store.pairError = ''
  try {
    const keyPair = createKeyPair()
    const phoneId = loadPhoneId()
    const phoneName = loadPhoneName()
    const result = await joinPairing({ payload, keyPair, phoneId, phoneName })
    const now = Date.now()
    const pairing = {
      v: 1,
      relayUrl: result.relayUrl || payload.relayUrl,
      relayWrapped: result.relayWrapped === true,
      fallbackUrl: result.fallbackUrl || '',
      fallbackWrapped: result.fallbackWrapped === true,
      lanUrls: Array.isArray(result.lanUrls) ? result.lanUrls : [],
      room: result.room || payload.room || '',
      roomKey: result.roomKey || payload.roomKey || '',
      access: payload.access || '',
      deviceId: payload.deviceId,
      deviceName: result.deviceName || payload.deviceName,
      phoneId,
      phoneName,
      token: result.token,
      keys: {
        pcToPhone: exportKey(result.keys.pcToPhone),
        phoneToPc: exportKey(result.keys.phoneToPc)
      },
      // 配对确认占用电脑端 outSeq=1，之后的业务消息从 2 开始；
      // 手机发出的第一条请求从 1 开始。
      outSeq: 0,
      inSeq: 1,
      pairedAt: now,
      lastActiveAt: now
    }
    stopClient()
    resetSessionState()
    savePairing(pairing)
    const data = setActivePairing(pairing.deviceId)
    store.pairings = data.items
    store.phoneName = phoneName
    store.needPair = false
    activatePairing(
      data.items.find((item) => item.deviceId === pairing.deviceId) || pairing
    )
    return true
  } catch (error) {
    store.pairError = error?.message || String(error)
    return false
  } finally {
    store.pairBusy = false
  }
}

export function updatePhoneName(name) {
  const value = String(name || '').trim().slice(0, 40)
  if (!value) return
  store.phoneName = value
  savePhoneName(value)
  // 多台电脑都保存同一部手机的名字，连接任何一台时电脑端显示一致。
  for (const item of store.pairings) item.phoneName = value
  if (store.pairing) store.pairing.phoneName = value
  for (const item of loadPairings().items) {
    if (item.phoneName !== value) savePairing({ ...item, phoneName: value })
  }
}

/** 解除当前电脑；若还有其它电脑则自动切换过去。 */
export function unpair() {
  const deviceId = store.pairing?.deviceId || ''
  stopClient()
  if (deviceId) {
    removePairing(deviceId)
    clearSessionsCache(deviceId)
    clearOfflineCache(deviceId)
  }
  resetSessionState()
  store.pairing = null
  store.deviceName = ''
  store.pairError = ''
  const data = loadPairings()
  store.pairings = data.items
  const next = data.items.find((item) => !pairingExpiredLocally(item))
  if (next) {
    setActivePairing(next.deviceId)
    activatePairing(next)
    toast(t("已解除当前电脑，切换到 {v1}", { v1: next.deviceName || t('另一台电脑') }))
    return
  }
  for (const item of [...data.items]) {
    removePairing(item.deviceId)
    clearSessionsCache(item.deviceId)
    clearOfflineCache(item.deviceId)
  }
  store.pairings = []
  store.needPair = true
  clearKeepAliveRetry()
  stopKeepAliveService()
  refreshKeepAliveDiagnostics()
  goPair('')
}

export function reconnect() {
  if (!store.pairing) return
  if (client) client.reconnect()
  else startClient()
}

/** 读取上次进入后台时写的标记，判断进程和连接是否活过了后台。 */
function recordBackgroundReturn() {
  const marker = readStoredJson(uni, BG_HIDE_KEY)
  if (!marker) return
  const report = evaluateBackgroundReturn(
    marker,
    runtimeSession,
    client?.isConnected() === true,
    client?.lastError || '',
    Date.now()
  )
  removeStoredKey(uni, BG_HIDE_KEY)
  if (report.kind === 'first') return
  // 后台明细：回帧数、断开时刻/原因。报告说「连接被断开」时，这几项能直接
  // 区分是系统掉了网络、ROM 掐断，还是回到前台被我们自己探活重建。
  const trace = client?.backgroundTrace?.() || null
  const hiddenAt = Number(marker.at) || 0
  const closeAt = Number(trace?.closeAt) || 0
  const closedInBackground = closeAt > hiddenAt && report.kind !== 'process-gone'
  const stored = {
    ...report,
    at: Date.now(),
    frames: Number(trace?.frames) || 0,
    closedInBackground,
    closeReason: closedInBackground ? String(trace?.closeReason || '') : '',
    probe: trace?.probe || null
  }
  store.backgroundReport = stored
  writeStoredJson(uni, BG_REPORT_KEY, stored)
}

export function onAppShow() {
  foreground = true
  // 先记下后台期间到底发生了什么，再动连接：这份结果要告诉用户（也告诉我们）
  // 是「连接保持」「连接断了」还是「App 被系统回收」。
  recordBackgroundReturn()
  releaseLinkKeepAlive()
  // 前台服务可能已在后台被 ROM 杀掉（而 JS 里仍缓存着「在跑」），回到前台
  // 无条件重发一次；服务在运行时只是重复走 onStartCommand。
  if (store.pairing) ensureKeepAlive({ force: true })
  refreshBatteryState()
  // 前后台切换后链路可能已经是假的。setForeground(true) 会按「距上一帧多久」
  // 决定是否短探活，失效就零退避重建，而不是靠心跳等满 45 秒静默超时。
  client?.setForeground(true)
  // 探活是异步的：等它落定后把结果补进后台报告，设置页才能看到这次回前台
  // 到底是探活成功复用了旧连接，还是探活失败才重建的。
  const shownReport = store.backgroundReport
  const shownProbe = client?.linkProbe
  if (shownReport && shownProbe && typeof shownProbe.then === 'function') {
    void shownProbe.then(() => {
      if (store.backgroundReport !== shownReport) return
      const next = { ...shownReport, probe: client?.lastProbe || null }
      store.backgroundReport = next
      writeStoredJson(uni, BG_REPORT_KEY, next)
    })
  }
  // 回到前台时正停在某个会话里，说明用户已经看到了它的新结果。
  if (currentRoute() === 'pages/chat/index' && store.currentSessionId) {
    clearSessionUnread(store.currentSessionId)
  }
  startForegroundSync()
  if (!store.pairing) return
  if (!client) {
    startClient()
    return
  }
  if (client.state === 'connecting') return
  if (client.isConnected()) {
    // 连接可能只是「看起来还在」：探活成功再对账，失败则重连。
    void probeConnection()
    return
  }
  client.reconnect()
}

export function onAppHide() {
  // 进入后台前先写标记：如果进程随后被系统回收，下次启动还能知道上一次
  // 后台期间套接字是不是还连着。存储写入是同步的，onHide 结束后也不会丢。
  writeStoredJson(
    uni,
    BG_HIDE_KEY,
    buildHideMarker({
      session: runtimeSession,
      at: Date.now(),
      connected: client?.isConnected() === true,
      keepAlive: store.keepAliveState
    })
  )
  // 趁着还在前台再拉起一次服务（Android 12+ 不允许后台随便启动前台服务）。
  if (store.pairing) ensureKeepAlive({ force: true, retry: false })
  // 保持连接：新壳里前台服务（keepalive-service.js）已经把进程托住；这里的
  // CPU 唤醒锁是旧壳或服务启动失败时的兜底。回到前台立即释放。
  foreground = false
  client?.setForeground(false)
  if (client) keepLinkAlive()
  stopForegroundSync()
  lastActiveHint = Date.now()
}

/* ------------------------------------------------------------------ */
/* 发送、停止、审批                                                    */
/* ------------------------------------------------------------------ */

function canSend() {
  if (!client?.isConnected()) {
    toast(t("尚未连接电脑"))
    return false
  }
  if (!store.agentOnline) {
    toast(t("电脑端离线，请确认电脑已打开工具箱"))
    return false
  }
  return true
}

export function runForSession(sessionId) {
  if (!sessionId) return null
  const active = Object.values(store.activeRuns).find((run) => run.sessionId === sessionId)
  if (active) return active
  // 事件暂时没到时，会话行自带的 running 也能让界面显示「执行中」并允许停止。
  const session = store.sessions.find((item) => item.id === sessionId)
  if (!session?.running) return null
  return {
    runId: session.runId || `session-${sessionId}`,
    sessionId,
    cwd: session.cwd || '',
    startedAt: Number(session.runStartedAt) || 0,
    source: 'pc',
    mode: session.approvalMode || '',
    instruction: session.runInstruction || ''
  }
}

export function sessionMode(sessionId) {
  if (!sessionId) return store.defaultMode || DEFAULT_APPROVAL_MODE
  const session = store.sessions.find((item) => item.id === sessionId)
  return normalizeApprovalMode(
    store.sessionModes[sessionId] || session?.approvalMode || store.defaultMode
  )
}

export async function setSessionMode(sessionId, mode) {
  const value = normalizeApprovalMode(mode)
  if (!sessionId) {
    store.defaultMode = value
    return
  }
  store.sessionModes[sessionId] = value
  saveSessionModes(store.sessionModes)
  if (!client?.isConnected()) return
  try {
    const updated = await request('sessions.approvalMode', {
      sessionId,
      approvalMode: value
    })
    if (updated) applySessionUpdate(updated)
  } catch (error) {
    toast(error?.message || t("切换执行模式失败"), 'none', 3000)
  }
}

/**
 * 给单个任务指定会话模型；空串清除，回到项目/全局。
 * 只影响下一次请求，运行中的这一轮不会被换掉。
 */
export async function setSessionModel(sessionId, modelId) {
  if (!sessionId) throw new Error(t("请先打开一个任务"))
  if (!client?.isConnected()) throw new Error(t("电脑端离线，暂时无法切换模型"))
  const value = typeof modelId === 'string' ? modelId.trim() : ''
  const updated = await request('sessions.model', { sessionId, modelId: value })
  if (updated) applySessionUpdate(updated)
  return updated
}

/**
 * 修改任务名称：只动会话标题，不碰工作区、计划、队列和消息。
 * 电脑端离线时直接报错，避免本地改完、下次刷新又被电脑端旧标题覆盖。
 */
export async function renameSession(sessionId, title) {
  const id = String(sessionId || '')
  const next = String(title || '').trim().slice(0, 120)
  if (!id) throw new Error(t("没有选中的任务"))
  if (!next) throw new Error(t("任务名称不能为空"))
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  const updated = await request('sessions.rename', { sessionId: id, title: next })
  if (updated) {
    applySessionUpdate(updated)
    return next
  }
  // 旧版电脑端没有回传会话摘要时，至少先改本地标题；刷新列表会以电脑端为准。
  const index = store.sessions.findIndex((item) => item.id === id)
  if (index >= 0) store.sessions[index] = { ...store.sessions[index], title: next }
  if (store.currentSessionId === id && store.currentSession) store.currentSession.title = next
  return next
}

/**
 * 复制任务：电脑端会保留原会话，新建一条从头开始但继承工作区的会话。
 * 成功后刷新列表并把新会话返回给页面跳转。
 */
export async function forkSession(sessionId) {
  const id = String(sessionId || '')
  if (!id) throw new Error(t("没有选中的任务"))
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  const created = await request('sessions.fork', { sessionId: id })
  if (created) applySessionUpdate(created)
  await refreshSessions(true)
  return created || null
}

/**
 * 删除任务：电脑端会同时清掉它的回退点。删除的是当前会话时，
 * 手机端把正文、待办、队列和运行态一起复位，避免继续显示已不存在的任务。
 */
export async function deleteSession(sessionId) {
  const id = String(sessionId || '')
  if (!id) throw new Error(t("没有选中的任务"))
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  await request('sessions.delete', { sessionId: id })
  store.sessions = store.sessions.filter((item) => item.id !== id)
  clearSessionUnread(id)
  clearDraft(`session:${id}`)
  delete store.todoCounts[id]
  delete store.sessionModes[id]
  if (store.currentSessionId === id) {
    store.currentSessionId = ''
    store.currentSession = null
    store.messages = []
    store.messageIds = {}
    store.historyBefore = null
    store.historyNewer = false
    store.tailCount = 0
    store.queue = []
    store.todos = []
    store.todosSessionId = ''
    store.scheduled = []
    store.scheduledSessionId = ''
    resetStream()
  }
  await refreshSessions(true)
  return true
}

/** 失败/中断后从最后一条指令重新跑一次。 */
export async function retrySession(sessionId = store.currentSessionId) {
  const id = String(sessionId || '')
  if (!id) throw new Error(t("没有选中的任务"))
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  await request('run.retry', { sessionId: id })
  return true
}

/** 回退点：列出、手动创建、恢复文件或对话。 */
export async function loadCheckpoints(sessionId = store.currentSessionId) {
  const id = String(sessionId || '')
  if (!id) return []
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  const data = await request('checkpoints.list', { sessionId: id })
  return Array.isArray(data?.checkpoints) ? data.checkpoints : []
}

export async function createCheckpoint(sessionId = store.currentSessionId, label = '') {
  const id = String(sessionId || '')
  if (!id) throw new Error(t("没有选中的任务"))
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  const data = await request('checkpoints.create', { sessionId: id, label }, LONG_TIMEOUT)
  return data?.checkpoint || null
}

export async function restoreCheckpoint(
  sessionId,
  checkpointId,
  mode = 'code'
) {
  const id = String(sessionId || '')
  if (!id) throw new Error(t("没有选中的任务"))
  if (!checkpointId) throw new Error(t("没有选中的回退点"))
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  const data = await request(
    'checkpoints.restore',
    { sessionId: id, checkpointId, mode },
    LONG_TIMEOUT
  )
  await refreshSessions(true)
  if (store.currentSessionId === id) await reloadHistory()
  return data?.result || null
}

/** 变更审阅：列出本次会话改过的文件，并支持逐个还原。 */
export async function loadChanges(sessionId = store.currentSessionId) {
  const id = String(sessionId || '')
  if (!id) return []
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  const data = await request('changes.list', { sessionId: id }, LONG_TIMEOUT)
  return Array.isArray(data?.changes) ? data.changes : []
}

export async function revertChange(sessionId, path) {
  const id = String(sessionId || '')
  if (!id || !path) throw new Error(t("没有选中的文件"))
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  const data = await request('changes.revert', { sessionId: id, path }, LONG_TIMEOUT)
  return data?.result || null
}

/**
 * 「会话记忆」：这个会话注入过 / 写下的条目。
 *
 * 选条目的规则在电脑端（shared/memory.ts 的 sessionMemories），手机端只负责展示，
 * 避免两边各写一份排序逻辑后挑选结果不一致。
 *
 * 返回值带 `source`：`pc` / `cache` / `offline` / `error`。记忆只存在电脑端，
 * 离线时用手机上一次在线读到的快照，否则「记忆」点进去就是一张空白页。
 */
export async function loadSessionMemoryDetails(sessionId) {
  const id = String(sessionId || '')
  if (!id) return { memory: [], source: 'none' }
  const deviceId = storageDeviceId()
  if (!client?.isConnected() || !store.agentOnline) {
    const cached = loadSessionMemoryCache(deviceId, id)
    return { memory: cached, source: cached.length ? 'cache' : 'offline' }
  }
  try {
    const data = await request('memory.session', { sessionId: id }, RESOURCE_TIMEOUT)
    const memory = Array.isArray(data?.memory) ? data.memory : []
    // 空列表也写一次：下次离线就能确定「那次确实没有」，不用白等。
    saveSessionMemoryCache(deviceId, id, memory)
    return { memory, source: 'pc' }
  } catch (error) {
    const cached = loadSessionMemoryCache(deviceId, id)
    if (cached.length) return { memory: cached, source: 'cache' }
    throw error
  }
}

export async function loadSessionMemory(sessionId) {
  const result = await loadSessionMemoryDetails(sessionId)
  return result.memory
}

/** 本机缓存里的会话记忆，同步返回，供页面立即上屏。 */
export function cachedSessionMemory(sessionId) {
  const id = String(sessionId || '')
  if (!id) return []
  return loadSessionMemoryCache(storageDeviceId(), id)
}

/** 工作区长期记忆：只操作当前工作区，内容仍只存在电脑端。 */
export async function loadMemory(workspacePath) {
  const path = String(workspacePath || '')
  if (!path) return []
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  const data = await request('memory.list', { workspacePath: path }, RESOURCE_TIMEOUT)
  return Array.isArray(data?.memory) ? data.memory : []
}

export async function addMemory(workspacePath, content) {
  const path = String(workspacePath || '')
  const text = String(content || '').trim()
  if (!path) throw new Error(t("没有选中的项目"))
  if (!text) throw new Error(t("记忆内容不能为空"))
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  const data = await request('memory.add', { workspacePath: path, content: text })
  return data?.entry || null
}

export async function removeMemory(workspacePath, memoryId) {
  const path = String(workspacePath || '')
  const id = String(memoryId || '')
  if (!path || !id) throw new Error(t("没有选中的记忆"))
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  await request('memory.remove', { workspacePath: path, memoryId: id })
  return true
}

/** 编辑历史指令并让电脑端从这一条重新生成。 */
export async function editMessage(sessionId, messageId, content) {
  const id = String(sessionId || '')
  const text = String(content || '').trim()
  if (!id || !messageId) throw new Error(t("没有选中的消息"))
  if (!text) throw new Error(t("消息不能为空"))
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  await request('chat.edit', { sessionId: id, messageId, content: text }, LONG_TIMEOUT)
  await reloadHistory()
  await refreshSessions(true)
  return true
}

/** 删除一条还没有回复的指令；电脑端会再校验它仍是最后一条消息。 */
export async function deleteMessage(sessionId, messageId) {
  const id = String(sessionId || '')
  const target = String(messageId || '')
  if (!id || !target) throw new Error(t("没有选中的消息"))
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  await request('chat.deleteMessage', { sessionId: id, messageId: target })
  await reloadHistory()
  await refreshSessions(true)
  return true
}

/** 丢掉最后一条回答，用同一条指令重新生成。 */
export async function regenerateMessage(sessionId = store.currentSessionId) {
  const id = String(sessionId || '')
  if (!id) throw new Error(t("没有选中的任务"))
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  await request('chat.regenerate', { sessionId: id }, LONG_TIMEOUT)
  await reloadHistory()
  await refreshSessions(true)
  return true
}

/** 快捷指令：电脑端返回 null 表示用户还没改过预设。 */
export async function loadQuickCommands() {
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  const data = await request('quickCommands.get')
  return Array.isArray(data?.commands) ? data.commands : null
}

export async function saveQuickCommands(commands) {
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  const rows = (Array.isArray(commands) ? commands : [])
    .map((item) => ({
      ...(item && item.id ? { id: String(item.id) } : {}),
      content: String(item?.content || '').trim()
    }))
    .filter((item) => item.content)
    .slice(0, 8)
  const data = await request('quickCommands.save', { commands: rows })
  return Array.isArray(data?.commands) ? data.commands : rows
}

/** 设置页只读展示：动态工具清单与沙箱状态。 */
export async function loadTools(workspacePath) {
  const path = String(workspacePath || '')
  if (!path) return []
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  const data = await request('tools.list', { workspacePath: path })
  return Array.isArray(data?.tools) ? data.tools : []
}

export async function loadSandboxStatus() {
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  const data = await request('sandbox.status')
  return data?.status || null
}

/** 设置页只读展示：电脑端系统、CPU、内存、磁盘与运行时。 */
export async function loadSystemInfo() {
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  const data = await request('system.info')
  return data?.info || null
}

/**
 * 内视：只读采样电脑端正在运行的服务实例，不接受任何路径参数。
 * 报告只用于展示与复制，手机端不提供任何「按它改」的入口。
 */
export async function loadSelfCheck() {
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  const data = await request('selfCheck.run', {}, LONG_TIMEOUT)
  return data?.report || null
}

/**
 * 模块自检：扫描只读、报告只回传最新一份和有限条风险。
 * 真正修改仍由电脑端创建一个普通会话完成，手机只负责选择与确认。
 */
export async function loadModuleCheckState() {
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  const data = await request('moduleCheck.state', {}, LONG_TIMEOUT)
  return data?.state || null
}

export async function discoverModuleCheckModules() {
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  const data = await request('moduleCheck.discover', {}, LONG_TIMEOUT)
  return {
    // 自检已只扫内置源码：`source` 是新字段，`workspace` 保留给旧电脑端。
    workspace: String(data?.source || data?.workspace || ''),
    modules: Array.isArray(data?.modules) ? data.modules.filter(Boolean) : []
  }
}

export async function runModuleCheck(moduleIds = []) {
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  const ids = (Array.isArray(moduleIds) ? moduleIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean)
    .slice(0, 200)
  // 扫描要读完整份源码，网络慢或项目大时明显超过普通请求的 60 秒。
  const data = await request(
    'moduleCheck.run',
    ids.length ? { moduleIds: ids } : {},
    180_000
  )
  return data?.report || null
}

export async function saveModuleCheckSettings(settings) {
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  const input = settings && typeof settings === 'object' ? settings : {}
  const payload = {}
  if (typeof input.enabled === 'boolean') payload.enabled = input.enabled
  if (Number.isFinite(Number(input.intervalHours))) {
    payload.intervalHours = Number(input.intervalHours)
  }
  if (Array.isArray(input.modules)) {
    payload.modules = input.modules
      .map((id) => String(id || '').trim())
      .filter(Boolean)
      .slice(0, 200)
  }
  const data = await request('moduleCheck.settings', { settings: payload }, LONG_TIMEOUT)
  return data?.state || null
}

/**
 * 自主探索学习：开关与来源白名单是电脑端全局设置，账本按工作区读取。
 * 手机只做开关、白名单和账本展示；真正的抓取仍由电脑端守门层执行。
 */
export async function loadLearningState(workspacePath) {
  const path = String(workspacePath || '')
  if (!path) throw new Error(t('尚未打开工作区'))
  if (!client?.isConnected()) throw new Error(t('尚未连接电脑'))
  const data = await request('learning.state', { workspacePath: path }, LONG_TIMEOUT)
  return data?.state || null
}

export async function saveLearningSettings(workspacePath, settings) {
  const path = String(workspacePath || '')
  if (!path) throw new Error(t('尚未打开工作区'))
  if (!client?.isConnected()) throw new Error(t('尚未连接电脑'))
  const input = settings && typeof settings === 'object' ? settings : {}
  const payload = {}
  if (typeof input.enabled === 'boolean') payload.enabled = input.enabled
  if (Array.isArray(input.hosts)) {
    payload.hosts = input.hosts
      .map((host) => String(host || '').trim())
      .filter(Boolean)
      .slice(0, 50)
  }
  const data = await request(
    'learning.settings',
    { workspacePath: path, settings: payload },
    LONG_TIMEOUT
  )
  return data?.state || null
}

export async function acceptModuleCheck(reportId, riskIds, selfModify = false) {
  const id = String(reportId || '')
  const risks = (Array.isArray(riskIds) ? riskIds : [])
    .map((riskId) => String(riskId || '').trim())
    .filter(Boolean)
    .slice(0, 200)
  if (!id) throw new Error(t("没有选中的自检报告"))
  if (!risks.length) throw new Error(t("请先勾选要优化的风险点"))
  if (!client?.isConnected()) throw new Error(t("尚未连接电脑"))
  const data = await request(
    'moduleCheck.accept',
    { reportId: id, riskIds: risks, selfModify: selfModify === true },
    LONG_TIMEOUT
  )
  const sessionId = String(data?.sessionId || '')
  if (sessionId) await refreshSessions(true)
  return {
    sessionId,
    queued: data?.queued === true,
    selfModify: data?.selfModify === true,
    proposalId: String(data?.proposalId || '')
  }
}

function removeLocalMessage(id) {
  if (!id) return
  store.messages = store.messages.filter((message) => message?.id !== id)
  delete store.messageIds[id]
}

export async function sendMessage(text, options = {}) {
  const prompt = String(text || '').trim()
  const images = Array.isArray(options.images)
    ? options.images.filter((url) => typeof url === 'string' && url.startsWith('data:image/')).slice(0, 3)
    : []
  const references = Array.isArray(options.references)
    ? options.references.filter((path) => typeof path === 'string' && path.trim()).slice(0, 8)
    : []
  if ((!prompt && images.length === 0) || store.sending) return false
  if (!canSend()) return false

  const newChat = store.newChat
  let sessionId = store.currentSessionId
  if (!sessionId && !newChat) {
    toast(t("请先选择或新建会话"))
    return false
  }

  const mode = normalizeApprovalMode(
    options.mode || (sessionId ? sessionMode(sessionId) : store.defaultMode)
  )
  const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  let createdSession = false
  store.sending = true
  try {
    if (!sessionId) {
      const created = await request('sessions.create', {
        workspacePath: newChat.cwd || ''
      })
      if (!created?.id) throw new Error(t("创建会话失败"))
      sessionId = created.id
      createdSession = true
      store.currentSessionId = sessionId
      store.currentSession = normalizeSession({
        ...created,
        title: created.title || prompt.slice(0, 24) || (images.length ? t("图片") : t("新对话")),
        workspaceName: newChat.workspaceName || ''
      })
      store.sessions.unshift(store.currentSession)
      store.newChat = null
      store.pendingHistoryReload = sessionId
      // 新会话刚拿到 ID，队列和待办都要切到它自己的清单。
      store.queue = []
      store.todos = []
      store.todosSessionId = ''
      store.scheduled = []
      store.scheduledSessionId = ''
      void loadTodos(sessionId)
      void loadScheduled(sessionId)
    }

    const listed = store.sessions.find((item) => item.id === sessionId)
    if (listed && listed.approvalMode !== mode) {
      try {
        const updated = await request('sessions.approvalMode', {
          sessionId,
          approvalMode: mode
        })
        if (updated) applySessionUpdate(updated)
      } catch (error) {
        toast(t("切换执行模式失败：{v1}", { v1: error?.message || error }), 'none', 3000)
      }
    }
    store.sessionModes[sessionId] = mode
    saveSessionModes(store.sessionModes)

    // 先乐观显示用户消息；如果被排队或发送失败再撤回。
    const blocks = []
    if (prompt) blocks.push({ type: 'text', text: prompt })
    for (const path of references) blocks.push({ type: 'reference', path })
    for (const url of images) blocks.push({ type: 'image', url })
    pushMessage({
      id: localId,
      role: 'user',
      blocks,
      timestamp: new Date().toISOString()
    })

    const data = await request(
      'chat.send',
      {
        sessionId,
        content: prompt,
        delivery: 'queue',
        ...(images.length ? { images } : {}),
        ...(references.length ? { references } : {})
      },
      LONG_TIMEOUT
    )

    if (data?.queued) {
      removeLocalMessage(localId)
      toast(t("已加入排队，当前任务结束后执行"))
      void refreshQueue()
      void refreshSessions(true)
      return true
    }

    // 电脑端已接受新指令，之前暂停的任务视为恢复。
    setSessionPaused(sessionId, false)
    if (!createdSession) store.streamRunId = ''
    void refreshSessions(true)
    return true
  } catch (error) {
    removeLocalMessage(localId)
    if (createdSession) {
      store.currentSessionId = ''
      store.currentSession = null
      store.sessions = store.sessions.filter((item) => item.id !== sessionId)
      store.messages = []
      store.messageIds = {}
    }
    const message = String(error?.message || t("发送失败"))
    toast(
      references.length > 0 && message.includes(t("相对路径"))
        ? t("电脑端还不支持参照其他项目，请先升级电脑端 Pilot")
        : message,
      'none',
      4000
    )
    return false
  } finally {
    store.sending = false
  }
}

export async function stopRun() {
  const sessionId = store.currentSessionId
  if (!sessionId || store.stopBusy) return
  store.stopBusy = true
  try {
    await request('chat.stop', { sessionId })
    toast(t("已请求停止"))
  } catch (error) {
    toast(error?.message || t("停止失败"), 'none', 3000)
  } finally {
    store.stopBusy = false
  }
}

/** 暂停当前任务：电脑端在安全位置中断并保留会话，稍后可以用「继续」恢复。 */
export async function pauseRun() {
  const sessionId = store.currentSessionId
  if (!sessionId || store.pauseBusy) return
  store.pauseBusy = true
  try {
    await request('chat.pause', { sessionId })
    toast(t("已暂停，可点「继续」接着做"), 'none', 3000)
  } catch (error) {
    toast(error?.message || t("暂停失败"), 'none', 3000)
  } finally {
    store.pauseBusy = false
  }
}

/** 继续被暂停的任务：电脑端用会话里保存的中断指令续跑。 */
export async function resumeSession() {
  const sessionId = store.currentSessionId
  if (!sessionId || store.sending) return false
  const listed = store.sessions.find((item) => item.id === sessionId)
  if (!store.currentSession?.paused && !listed?.paused) return false
  setSessionPaused(sessionId, false)
  store.sending = true
  try {
    const data = await request('chat.resume', { sessionId }, LONG_TIMEOUT)
    if (data?.queued) toast(t("已加入排队，当前任务结束后执行"))
    void refreshSessions(true)
    return true
  } catch (error) {
    setSessionPaused(sessionId, true)
    toast(error?.message || t("继续失败"), 'none', 3000)
    return false
  } finally {
    store.sending = false
  }
}

export async function respondPermission(requestId, behavior) {
  if (!requestId || store.respondingPermissions[requestId]) return
  const requestItem = store.permissions.find((item) => item.requestId === requestId)
  if (!requestItem) return
  store.respondingPermissions[requestId] = true
  try {
    if (behavior === 'allow_always') {
      await request('approval.allowSession', {
        callId: requestId,
        sessionId: requestItem.sessionId
      })
    } else {
      await request('approval.decide', {
        callId: requestId,
        approved: behavior !== 'deny',
        reason: behavior === 'deny' ? t("用户在手机上拒绝") : undefined
      })
    }
    store.permissions = store.permissions.filter((item) => item.requestId !== requestId)
    delete store.respondingPermissions[requestId]
    toast(
      behavior === 'deny'
        ? t("已拒绝该操作")
        : behavior === 'allow_always'
          ? t("已允许，本会话后续自动执行")
          : t("已允许该操作"),
      'none',
      1600
    )
  } catch (error) {
    delete store.respondingPermissions[requestId]
    toast(error?.message || t("审批失败"), 'none', 3000)
  }
}

export async function insertQueueItem(queueId) {
  const sessionId = store.currentSessionId
  if (!sessionId) return
  try {
    await request('queue.insert', { sessionId, taskId: queueId })
    toast(t("已插入当前任务，下一步生效"))
    void refreshQueue()
  } catch (error) {
    toast(error?.message || t("插入失败"), 'none', 3000)
  }
}

/** 调整排队顺序：把某条排队消息上移或下移一位，超出边界时什么也不做。 */
export async function moveQueueItem(queueId, direction) {
  const sessionId = store.currentSessionId
  if (!sessionId || !queueId) return false
  if (direction !== 'up' && direction !== 'down') return false
  const rows = visibleQueue(sessionId)
  const index = rows.findIndex((item) => item.queueId === queueId)
  if (index < 0) return false
  if (direction === 'up' ? index === 0 : index === rows.length - 1) return false
  try {
    await request('queue.move', { sessionId, taskId: queueId, direction })
    // 电脑端会广播 queue.changed，这里只做一次纠正性刷新，避免顺序回跳。
    void refreshQueue()
    return true
  } catch (error) {
    toast(error?.message || t("调整顺序失败"), 'none', 3000)
    void refreshQueue()
    return false
  }
}

export async function removeQueueItem(queueId) {
  const sessionId = store.currentSessionId
  if (!sessionId) return
  try {
    await request('queue.remove', { sessionId, taskId: queueId })
    void refreshQueue()
  } catch (error) {
    toast(error?.message || t("移除失败"), 'none', 3000)
  }
}

/** 原地修改排队消息内容，不改变它在队列里的位置。 */
export async function updateQueueItem(queueId, prompt) {
  const sessionId = store.currentSessionId
  const value = String(prompt || '').trim()
  if (!sessionId || !queueId || !value) {
    toast(t("排队消息内容不能为空"))
    return false
  }
  try {
    await request('queue.update', { sessionId, taskId: queueId, content: value })
    await refreshQueue()
    toast(t("排队消息已更新"))
    return true
  } catch (error) {
    toast(error?.message || t("修改排队消息失败"), 'none', 3000)
    void refreshQueue()
    return false
  }
}

/** 排队消息转入所属会话的待办；内容只暂存，不会自动发送。 */
export async function convertQueueItemToTodo(queueId) {
  const sessionId = store.currentSessionId
  const item = store.queue.find((entry) => entry.queueId === queueId)
  if (!sessionId || !item) return false
  if (!todosOnline()) {
    toast(t("电脑端离线，暂时无法转入待办"), 'none', 3000)
    return false
  }
  try {
    await request('queue.toTodo', { sessionId, taskId: queueId })
    await refreshQueue()
    await loadTodos(sessionId)
    toast(t("已从队列转入待办，确认后再发送"))
    return true
  } catch (error) {
    toast(error?.message || t("转入待办失败"), 'none', 3500)
    void refreshQueue()
    return false
  }
}

/* ------------------------------------------------------------------ */
/* 定时任务                                                            */
/* ------------------------------------------------------------------ */

let scheduledToken = 0

function scheduledOnline() {
  return Boolean(client?.isConnected()) && store.agentOnline
}

export async function loadScheduled(sessionId = store.currentSessionId) {
  const key = String(sessionId || '')
  if (!key || !scheduledOnline()) return
  const token = ++scheduledToken
  store.scheduledLoading = true
  try {
    const data = await request('schedules.list', { sessionId: key })
    if (token !== scheduledToken || store.currentSessionId !== key) return
    store.scheduled = Array.isArray(data?.tasks) ? data.tasks : []
    store.scheduledSessionId = key
  } catch {
    // 定时任务面板按需重试，这里不打扰用户。
  } finally {
    if (token === scheduledToken) store.scheduledLoading = false
  }
}

let scheduledAllToken = 0

/**
 * `schedules.listAll` 的可选增强：旧版电脑端没有这个接口，失败就当没有。
 *
 * 返回分组数组；被后发的读取抢占时返回 SCHEDULED_ALL_STALE，让调用方直接放弃。
 */
async function requestAllScheduledQuietly(token) {
  try {
    const data = await request('schedules.listAll')
    if (token !== scheduledAllToken) return SCHEDULED_ALL_STALE
    if (!Array.isArray(data?.groups)) return []
    return data.groups.filter((group) => Array.isArray(group?.tasks) && group.tasks.length)
  } catch {
    if (token !== scheduledAllToken) return SCHEDULED_ALL_STALE
    return []
  }
}

/**
 * 被后发的一次读取抢占时返回它。
 *
 * token 只是「最后一次读取算数」，但调用方（首页弹层）拿到空数组分不清
 * 「真的没有任务」和「这次读取作废了」，会把已有列表错清成空。groups 为 null
 * 就是告诉调用方：保留你手上的那份。
 */
const SCHEDULED_ALL_STALE = Object.freeze({ groups: null, offline: false, stale: true })

/**
 * 首页「全部任务」：按会话汇总定时任务，和「全部待办」走同一条链路。
 *
 * 早先这里只调电脑端 `schedules.listAll` 一次取回全部分组，但那是桌面端后来才有的
 * 接口：旧电脑端直接回「手机端不支持该操作」，返回结构一旦不符又会静默当成空数组，
 * 手机上表现成「点开什么都没有」。现在主路径改成拿首页已有的会话列表逐个会话读
 * `schedules.list`（与 loadPendingTodosBySession 同一套做法），listAll 只在可用时
 * 额外补上其它工作区/已删除会话的任务，不再依赖某个可选接口存在。
 * 返回值：{ groups, offline, stale }——offline 为真时页面提示「电脑端离线」，
 * stale 为真时 groups 为 null，调用方不要覆盖已有列表。
 */
export async function loadAllScheduled() {
  const token = ++scheduledAllToken
  if (!scheduledOnline()) {
    // 离线：把上一次读到的分组原样带回去，页面据此说「离线」，而不是「没有任务」。
    return { groups: store.scheduledAllGroups.slice(), offline: true, stale: false }
  }
  const cached = new Map()
  for (const group of store.scheduledAllGroups || []) {
    if (group?.sessionId) cached.set(String(group.sessionId), group)
  }
  const sessions = store.sessions.filter((session) => session?.id)
  if (!sessions.length) {
    // 会话列表还没拉到：保留缓存，别让首页入口的数量凭空归零。
    return { groups: store.scheduledAllGroups.slice(), offline: false, stale: false }
  }
  // 会话多时一次并发几十个请求会把中继挤满，按 4 个一批顺序发。
  const results = []
  for (let index = 0; index < sessions.length; index += 4) {
    const batch = sessions.slice(index, index + 4)
    results.push(
      ...(await Promise.allSettled(
        batch.map((session) => request('schedules.list', { sessionId: session.id }))
      ))
    )
    if (token !== scheduledAllToken) return SCHEDULED_ALL_STALE
  }
  if (token !== scheduledAllToken) return SCHEDULED_ALL_STALE
  const groups = []
  let answered = 0
  results.forEach((result, index) => {
    const session = sessions[index]
    const sessionId = String(session.id)
    const base = {
      sessionId,
      sessionTitle: session.title || '',
      workspacePath: session.cwd || session.workspacePath || '',
      missing: false
    }
    if (result.status !== 'fulfilled') {
      // 单个会话读失败：这条会话沿用缓存里的任务，别让它在弹层里凭空消失。
      const previous = cached.get(sessionId)
      if (previous?.tasks?.length) groups.push({ ...previous, ...base, tasks: previous.tasks })
      return
    }
    answered += 1
    const tasks = Array.isArray(result.value?.tasks) ? result.value.tasks : []
    if (tasks.length) groups.push({ ...base, tasks })
  })
  // 已经不在首页列表里的旧分组（会话被删、或换了电脑）保留下来，页面把标题
  // 换成「会话已删除」，人还能看到任务内容而不是整条消失。
  const seen = new Set(sessions.map((session) => String(session.id)))
  for (const [sessionId, group] of cached) {
    if (seen.has(sessionId) || !group?.tasks?.length) continue
    groups.push({ ...group, missing: true })
  }
  // 新版电脑端还能一次给出全部分组（含其它工作区、会话已删除的任务）：额外
  // 补进来。这是锦上添花——接口不存在、报错、结构不对都不影响上面那批结果。
  const extra = await requestAllScheduledQuietly(token)
  if (extra === SCHEDULED_ALL_STALE) return SCHEDULED_ALL_STALE
  const known = new Set(groups.map((group) => String(group.sessionId)))
  for (const group of extra) {
    const sessionId = String(group?.sessionId || '')
    if (!sessionId || known.has(sessionId) || !group?.tasks?.length) continue
    known.add(sessionId)
    groups.push(group)
  }
  // 一个会话都没读成功、又没从 listAll 拿到东西时，不能拿空结果覆盖缓存，
  // 否则首页入口的数量会整片消失。
  if (!answered && !groups.length && store.scheduledAllGroups.length) {
    return { groups: store.scheduledAllGroups.slice(), offline: false, stale: false }
  }
  store.scheduledAllGroups = groups
  store.scheduledAllAt = new Date().toISOString()
  return { groups, offline: false, stale: false }
}

/** 首页汇总条的数量：启用中的任务数与会话数，口径与弹层一致。 */
export function scheduledOverviewCounts() {
  let tasks = 0
  let sessions = 0
  for (const group of store.scheduledAllGroups || []) {
    const list = Array.isArray(group?.tasks) ? group.tasks : []
    if (!list.length) continue
    sessions += 1
    tasks += list.filter((task) => task?.enabled !== false).length
  }
  return { tasks, sessions }
}

function requireScheduledSession() {
  const sessionId = store.currentSessionId
  if (!sessionId || store.scheduledBusy) return ''
  if (!scheduledOnline()) {
    toast(t("电脑端离线，暂时无法操作定时任务"), 'none', 3000)
    return ''
  }
  return sessionId
}

export async function addScheduledTask(input) {
  const sessionId = requireScheduledSession()
  if (!sessionId) return false
  store.scheduledBusy = true
  try {
    await request('schedules.add', { sessionId, ...input })
    await loadScheduled(sessionId)
    toast(t("已添加定时任务"))
    return true
  } catch (error) {
    toast(error?.message || t("添加定时任务失败"), 'none', 3500)
    return false
  } finally {
    store.scheduledBusy = false
  }
}

export async function updateScheduledTask(taskId, input) {
  const sessionId = requireScheduledSession()
  if (!sessionId || !taskId) return false
  store.scheduledBusy = true
  try {
    await request('schedules.update', { sessionId, taskId, ...input })
    await loadScheduled(sessionId)
    return true
  } catch (error) {
    toast(error?.message || t("修改定时任务失败"), 'none', 3500)
    return false
  } finally {
    store.scheduledBusy = false
  }
}

export async function removeScheduledTask(taskId) {
  const sessionId = requireScheduledSession()
  if (!sessionId || !taskId) return false
  store.scheduledBusy = true
  try {
    await request('schedules.remove', { sessionId, taskId })
    await loadScheduled(sessionId)
    toast(t("已删除定时任务"))
    return true
  } catch (error) {
    toast(error?.message || t("删除定时任务失败"), 'none', 3500)
    return false
  } finally {
    store.scheduledBusy = false
  }
}

/** 待办转定时任务；电脑端完成后待办会从清单移除。 */
export async function convertTodoToSchedule(todoId, input) {
  const sessionId = requireScheduledSession()
  if (!sessionId || !todoId) return false
  const todo = store.todos.find((item) => item?.id === todoId)
  if (todo?.offline) {
    toast(t("这条待办还没同步到电脑，联网后再转定时任务"), 'none', 3500)
    return false
  }
  store.scheduledBusy = true
  try {
    await request('todos.toSchedule', { sessionId, todoId, ...input })
    await loadTodos(sessionId)
    await loadScheduled(sessionId)
    toast(t("已把待办转为定时任务"))
    return true
  } catch (error) {
    toast(error?.message || t("转为定时任务失败"), 'none', 3500)
    return false
  } finally {
    store.scheduledBusy = false
  }
}

/** 定时任务转回待办；不会自动发送。 */
export async function convertScheduleToTodo(taskId) {
  const sessionId = requireScheduledSession()
  if (!sessionId || !taskId) return false
  store.scheduledBusy = true
  try {
    await request('schedules.toTodo', { sessionId, taskId })
    await loadScheduled(sessionId)
    await loadTodos(sessionId)
    toast(t("已把定时任务转为待办"))
    return true
  } catch (error) {
    toast(error?.message || t("转为待办失败"), 'none', 3500)
    return false
  } finally {
    store.scheduledBusy = false
  }
}

/* ------------------------------------------------------------------ */
/* 待办                                                                */
/* ------------------------------------------------------------------ */

let todosToken = 0
let offlineSyncRunning = false

/** 待办要写到电脑端才算同步成功；中继连着但电脑端离线时也按离线处理。 */
function todosOnline() {
  return Boolean(client?.isConnected()) && store.agentOnline
}

function pendingTodoCount(rows) {
  return (Array.isArray(rows) ? rows : []).filter((item) => item?.status === 'pending').length
}

function setTodoCount(sessionId, count) {
  const key = String(sessionId || '')
  if (!key) return
  const value = Number(count) || 0
  if (value > 0) store.todoCounts[key] = value
  else delete store.todoCounts[key]
}

/**
 * 重建会话列表的待办数量：电脑端返回的计数 + 手机上还没补发的离线待办。
 * 旧版插件没有 todoPendingCount 时，至少保留当前会话已经读到的数量。
 */
function rebuildTodoCounts() {
  const counts = {}
  const localMerged = new Set()
  for (const session of store.sessions) {
    if (!session?.id) continue
    if (session.todoPendingCount !== undefined) {
      const value = Number(session.todoPendingCount) || 0
      if (value > 0) counts[session.id] = value
    } else if (session.id === store.currentSessionId && store.todosSessionId === session.id) {
      const value = pendingTodoCount(store.todos)
      if (value > 0) counts[session.id] = value
      localMerged.add(session.id)
    }
  }
  for (const item of loadOfflineTodos(storageDeviceId())) {
    if (!item.sessionId || localMerged.has(item.sessionId)) continue
    counts[item.sessionId] = (counts[item.sessionId] || 0) + 1
  }
  store.todoCounts = counts
}

function offlineTodosFor(sessionId) {
  const key = String(sessionId || '')
  if (!key) return []
  return loadOfflineTodos(storageDeviceId()).filter((item) => item.sessionId === key)
}

function offlineTodoRow(item) {
  return {
    id: item.id,
    text: item.text,
    status: 'pending',
    createdAt: item.createdAt,
    sentAt: 0,
    sentRunId: '',
    sentQueueId: '',
    source: 'phone',
    offline: true
  }
}

/** 把电脑端返回的待办与手机上尚未同步的待办合并，离线条目始终保留。 */
function mergeTodoRows(sessionId, rows) {
  const pendingOffline = offlineTodosFor(sessionId)
  const offlineIds = new Set(pendingOffline.map((item) => item.id))
  const base = (Array.isArray(rows) ? rows : [])
    .filter((item) => item && typeof item.id === 'string')
    .map((item) => ({ ...item, offline: offlineIds.has(item.id) }))
  const known = new Set(base.map((item) => item.id))
  for (const item of pendingOffline) {
    if (!known.has(item.id)) base.push(offlineTodoRow(item))
  }
  return base
}

function applyTodoRows(sessionId, rows) {
  const merged = mergeTodoRows(
    sessionId,
    (Array.isArray(rows) ? rows : []).map((item) => normalizeTodo(item)).filter(Boolean)
  )
  store.todos = merged
  store.todosSessionId = sessionId
  const count = pendingTodoCount(merged)
  setTodoCount(sessionId, count)
  const session = store.sessions.find((item) => item.id === sessionId)
  if (session) {
    session.todoCount = count
    session.todoPendingCount = count
  }
  todoFactsAt[sessionId] = Date.now()
  saveTodosCache(storageDeviceId(), sessionId, merged)
}

/** 服务端推送的待办清单：当前会话直接替换，其它会话只更新角标。 */
function applyTodoEvent(sessionId, todos) {
  const rows = (Array.isArray(todos) ? todos : [])
    .map((item) => normalizeTodo(item))
    .filter(Boolean)
  if (sessionId === store.currentSessionId) {
    applyTodoRows(sessionId, rows)
    return
  }
  const merged = mergeTodoRows(sessionId, rows)
  const count = pendingTodoCount(merged)
  setTodoCount(sessionId, count)
  const session = store.sessions.find((item) => item.id === sessionId)
  if (session) {
    session.todoCount = count
    session.todoPendingCount = count
  }
  todoFactsAt[sessionId] = Date.now()
  saveTodosCache(storageDeviceId(), sessionId, merged)
}

function addOfflineTodo(sessionId, text) {
  const deviceId = storageDeviceId()
  const pending = loadOfflineTodos(deviceId)
  if (pending.length >= OFFLINE_TODO_LIMIT) {
    toast(t("离线待办最多暂存 {v1} 条，请联网同步后再添加", { v1: OFFLINE_TODO_LIMIT }), 'none', 3500)
    return false
  }
  const item = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sessionId,
    text,
    createdAt: Date.now()
  }
  saveOfflineTodos(deviceId, [...pending, item])
  applyTodoRows(sessionId, [...store.todos, offlineTodoRow(item)])
  toast(t("已离线保存待办，联网后自动同步"))
  return true
}

export async function loadTodos(sessionId = store.currentSessionId) {
  const key = String(sessionId || '')
  if (!key) return
  const token = ++todosToken
  const requestedAt = Date.now()
  const deviceId = storageDeviceId()
  const cached = mergeTodoRows(key, loadTodosCache(deviceId, key))
  if (store.currentSessionId === key) {
    if (cached.length || store.todosSessionId !== key) {
      store.todos = cached
      store.todosSessionId = key
    }
    store.todosLoading = false
  }
  if (!todosOnline()) return
  store.todosLoading = true
  try {
    const data = await request('todos.list', { sessionId: key })
    if (token !== todosToken || store.currentSessionId !== key) return
    // 请求发出后本地又添加/发送/收到了待办事件：不要让这份旧清单覆盖新状态。
    if ((todoFactsAt[key] || 0) > requestedAt) return
    applyTodoRows(key, data?.todos)
  } catch {
    // 待办读取失败不影响对话；继续显示本地缓存，下一次打开会话或刷新时会重试。
  } finally {
    if (token === todosToken) store.todosLoading = false
  }
}

/**
 * 首页「全部待办」：按会话汇总待办。
 * 先给出本地缓存和离线待办，联网时再逐个会话向电脑端补齐；
 * 不碰当前会话的 store.todos，避免首页看了一眼就打断对话页正在编辑的清单。
 */
export async function loadPendingTodosBySession() {
  const deviceId = storageDeviceId()
  const ids = []
  for (const session of store.sessions) {
    if (!session?.id) continue
    // 离线待办只会进 todoCounts，不会写进会话的 todoPendingCount，两边取大值。
    const count = Math.max(
      Number(session.todoPendingCount ?? session.todoCount) || 0,
      Number(store.todoCounts[session.id]) || 0
    )
    if (count > 0) ids.push(session.id)
  }
  const rowsBySession = new Map()
  for (const sessionId of ids) {
    rowsBySession.set(
      sessionId,
      mergeTodoRows(
        sessionId,
        loadTodosCache(deviceId, sessionId)
          .map((item) => normalizeTodo(item))
          .filter(Boolean)
      )
    )
  }
  if (todosOnline()) {
    await Promise.allSettled(
      ids.map(async (sessionId) => {
        try {
          const data = await request('todos.list', { sessionId })
          const rows = mergeTodoRows(
            sessionId,
            (Array.isArray(data?.todos) ? data.todos : [])
              .map((item) => normalizeTodo(item))
              .filter(Boolean)
          )
          rowsBySession.set(sessionId, rows)
          saveTodosCache(deviceId, sessionId, rows)
          const count = pendingTodoCount(rows)
          setTodoCount(sessionId, count)
          const session = store.sessions.find((item) => item.id === sessionId)
          if (session) {
            session.todoCount = count
            session.todoPendingCount = count
          }
        } catch {
          // 单个会话读取失败时保留本地缓存，不影响其它会话的待办。
        }
      })
    )
  }
  return ids.map((sessionId) => ({ sessionId, rows: rowsBySession.get(sessionId) || [] }))
}

/** 把断网时暂存的待办按创建顺序补发到电脑端。 */
export async function syncOfflineTodos() {
  const deviceId = storageDeviceId()
  if (!deviceId || offlineSyncRunning || !todosOnline()) return false
  const initial = loadOfflineTodos(deviceId)
  if (!initial.length) return false
  offlineSyncRunning = true
  let synced = 0
  try {
    for (const item of initial) {
      if (!todosOnline()) break
      try {
        const data = await client.request('todos.add', {
          sessionId: item.sessionId,
          text: item.text,
          // 断线重试时电脑端按这个 ID 去重，避免同一条离线待办补发两次。
          clientId: item.id
        })
        const remaining = loadOfflineTodos(deviceId).filter((entry) => entry.id !== item.id)
        saveOfflineTodos(deviceId, remaining)
        // 电脑端返回新增的待办；没有返回时用本地缓存兜底。
        const rows = Array.isArray(data?.todos)
          ? data.todos
          : [
              ...loadTodosCache(deviceId, item.sessionId).filter(
                (entry) => entry.id !== item.id
              ),
              data?.todo
            ].filter(Boolean)
        saveTodosCache(deviceId, item.sessionId, mergeTodoRows(item.sessionId, rows))
        if (store.currentSessionId === item.sessionId) {
          applyTodoRows(item.sessionId, rows)
        } else {
          setTodoCount(
            item.sessionId,
            pendingTodoCount(mergeTodoRows(item.sessionId, rows))
          )
        }
        synced += 1
      } catch {
        // 网络再次中断时保留剩余条目，下次连接继续同步。
        break
      }
    }
  } finally {
    offlineSyncRunning = false
  }
  if (synced > 0) toast(t("已同步 {v1} 条离线待办", { v1: synced }))
  return synced > 0
}

export async function addTodo(text) {
  const sessionId = store.currentSessionId
  const value = String(text || '').trim()
  if (!sessionId || !value || store.todoBusy) return false
  if (!todosOnline()) return addOfflineTodo(sessionId, value)
  store.todoBusy = true
  try {
    await request('todos.add', { sessionId, text: value })
    await loadTodos(sessionId)
    return true
  } catch (error) {
    // 请求途中断网时同样落本地，避免用户输入的待办丢失。
    if (!todosOnline()) return addOfflineTodo(sessionId, value)
    toast(error?.message || t("添加待办失败"), 'none', 3000)
    return false
  } finally {
    store.todoBusy = false
  }
}

/** 修改待办内容；只改文字，不发送。 */
export async function updateTodo(todoId, text) {
  const sessionId = store.currentSessionId
  const value = String(text || '').trim()
  if (!sessionId || !todoId || !value || store.todoBusy) return false
  const todo = store.todos.find((item) => item?.id === todoId)
  if (!todo) return false
  if (todo.offline) {
    // 尚未同步的待办只维护本地副本，联网补发时会带上新内容。
    const deviceId = storageDeviceId()
    const pending = loadOfflineTodos(deviceId).map((item) =>
      item.id === todoId ? { ...item, text: value } : item
    )
    saveOfflineTodos(deviceId, pending)
    applyTodoRows(
      sessionId,
      store.todos.map((item) => (item.id === todoId ? { ...item, text: value } : item))
    )
    toast(t("待办已更新"))
    return true
  }
  if (!todosOnline()) {
    toast(t("电脑端离线，无法修改待办"), 'none', 3000)
    return false
  }
  store.todoBusy = true
  try {
    await request('todos.update', { sessionId, todoId, text: value })
    await loadTodos(sessionId)
    toast(t("待办已更新"))
    return true
  } catch (error) {
    toast(error?.message || t("修改待办失败"), 'none', 3000)
    return false
  } finally {
    store.todoBusy = false
  }
}

export async function removeTodo(todoId) {
  const sessionId = store.currentSessionId
  if (!sessionId || !todoId || store.todoBusy) return false
  const todo = store.todos.find((item) => item?.id === todoId)
  if (todo?.offline) {
    // 尚未同步的待办只存在于这台手机，直接删掉本地副本即可。
    const deviceId = storageDeviceId()
    saveOfflineTodos(
      deviceId,
      loadOfflineTodos(deviceId).filter((item) => item.id !== todoId)
    )
    applyTodoRows(
      sessionId,
      store.todos.filter((item) => item.id !== todoId)
    )
    return true
  }
  if (!todosOnline()) {
    toast(t("离线时只能删除尚未同步的待办"))
    return false
  }
  store.todoBusy = true
  try {
    await request('todos.remove', { sessionId, todoId })
    await loadTodos(sessionId)
    return true
  } catch (error) {
    toast(error?.message || t("删除待办失败"), 'none', 3000)
    return false
  } finally {
    store.todoBusy = false
  }
}

export async function clearSentTodos() {
  const sessionId = store.currentSessionId
  if (!sessionId || store.todoBusy) return false
  if (!todosOnline()) {
    toast(t("离线时无法清理已发送的待办"))
    return false
  }
  store.todoBusy = true
  try {
    await request('todos.clearSent', { sessionId })
    await loadTodos(sessionId)
    return true
  } catch (error) {
    toast(error?.message || t("清理待办失败"), 'none', 3000)
    return false
  } finally {
    store.todoBusy = false
  }
}

/** 待办真正提交后，像手动发送一样把指令补进对话。 */
function applyTodoSendResult(sessionId, prompt, data) {
  if (!data || data.queued) {
    if (data?.queued) void refreshQueue()
    return
  }
  if (sessionId !== store.currentSessionId) return
  pushMessage({
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    role: 'user',
    blocks: [{ type: 'text', text: prompt }],
    timestamp: new Date().toISOString()
  })
  store.streamRunId = ''
  store.streamText = ''
}

export async function sendTodo(todoId) {
  const sessionId = store.currentSessionId
  const todo = store.todos.find((item) => item?.id === todoId)
  if (!sessionId || !todo || todo.status !== 'pending' || store.todoBusy) return false
  if (todo.offline) {
    toast(t("这条待办还没同步到电脑，联网后会自动同步"))
    return false
  }
  if (!todosOnline()) {
    toast(t("电脑端离线，待办已保存在手机上"))
    return false
  }
  store.todoBusy = true
  try {
    const data = await request('todos.send', { sessionId, todoId }, LONG_TIMEOUT)
    applyTodoSendResult(sessionId, todo.text, data)
    await loadTodos(sessionId)
    if (data?.queued) toast(t("待办已加入排队，当前任务结束后执行"))
    else toast(t("已发送待办"))
    return true
  } catch (error) {
    toast(error?.message || t("发送待办失败"), 'none', 4000)
    return false
  } finally {
    store.todoBusy = false
  }
}

export async function sendAllTodos() {
  const sessionId = store.currentSessionId
  const pending = store.todos.filter((item) => item?.status === 'pending')
  if (!sessionId || !pending.length || store.todoBusy) return false
  if (pending.some((item) => item.offline)) {
    toast(t("有尚未同步的待办，联网后会自动同步再发送"))
    return false
  }
  if (!todosOnline()) {
    toast(t("电脑端离线，待办已保存在手机上"))
    return false
  }
  store.todoBusy = true
  try {
    const data = await request('todos.sendAll', { sessionId }, LONG_TIMEOUT)
    const sent = Number(data?.sent) || 0
    const failed = Number(data?.failed) || 0
    await loadTodos(sessionId)
    void refreshQueue()
    if (failed > 0) {
      toast(t("已发送 {v1} 条，{v2} 条未发送；请稍后重试", { v1: sent, v2: failed }), 'none', 5000)
    } else {
      toast(t("已发送 {v1} 条待办", { v1: sent }))
    }
    return true
  } catch (error) {
    toast(error?.message || t("发送待办失败"), 'none', 4000)
    return false
  } finally {
    store.todoBusy = false
  }
}

export function visibleQueue(sessionId) {
  if (!Array.isArray(store.queue)) return []
  if (!sessionId) return []
  return store.queue.filter((item) => item.sessionId === sessionId)
}

export function startNewChat(cwd, prompt = '') {
  store.currentSessionId = ''
  store.currentSession = null
  store.messages = []
  store.messageIds = {}
  store.historyBefore = null
  store.focusMessageId = ''
  store.historyNewer = false
  resetStream()
  // 新任务还没有会话 ID，先清掉上一个任务的待办，避免首条消息发出后
  // 待办面板短暂显示同目录其他任务的清单。
  todosToken += 1
  store.todos = []
  store.todosSessionId = ''
  store.todosLoading = false
  scheduledToken += 1
  store.scheduled = []
  store.scheduledSessionId = ''
  store.scheduledLoading = false
  scheduledAllToken += 1
  store.scheduledAllGroups = []
  store.scheduledAllAt = ''
  // 源码改造等入口可以预填第一句，用户仍可改完再发。
  store.newChat = { cwd: cwd || '', title: t("新对话"), prompt: String(prompt || '') }
}

export function dispose() {
  client?.stop()
  client = null
}
