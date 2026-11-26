/**
 * 「全部定时任务」的纯数据层。
 *
 * 手机首页的入口按钮与弹层都用这里：把按会话读到的定时任务分组
 * （loadAllScheduled 逐会话 schedules.list 的结果）整理成可以直接渲染的列表。
 *
 * 口径与桌面端 store.allScheduledTaskGroups() 保持一致：
 * - 组内按下次触发时间升序，暂停的任务排在启用中的后面；
 * - 组之间按组内最早的一次触发时间升序，没有启用任务的组排最后；
 * - 没有任何任务的分组直接丢掉，避免弹层里出现空标题。
 */
import { t } from './i18n.js'
import { projectName } from './format.js'

// 暂停 / 没有下次触发时间的任务用来兜底的排序键：排在所有真实时间之后。
const FAR_FUTURE = '\uffff'

/** 计划描述：每 30 分钟 / 每天 09:30 / 09:30（从 2026-03-05 起）/ 一次性。 */
export function scheduleKindLabel(task) {
  if (!task) return ''
  if (task.kind === 'interval') return t('每 {v1} 分钟', { v1: task.intervalMinutes || 60 })
  if (task.kind === 'daily') {
    const time = task.timeOfDay || '09:00'
    return task.startDate
      ? t('{v1}（从 {v2} 起）', { v1: time, v2: task.startDate })
      : t('每天 {v1}', { v1: time })
  }
  return t('一次性')
}

/** 下次触发时间：MM-DD HH:mm。时间无效时返回空串，调用方据此不显示「下次」。 */
export function scheduleTimeText(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function taskOrder(task) {
  if (task?.enabled === false) return FAR_FUTURE
  return String(task?.nextRunAt || FAR_FUTURE)
}

function groupOrder(group) {
  return group.tasks.length > 0 ? taskOrder(group.tasks[0]) : FAR_FUTURE
}

/**
 * 整理分组。
 *
 * @param {Array} rawGroups 电脑端返回的分组（sessionId / sessionTitle / workspacePath / tasks）
 * @param {Array} sessions 手机本地的会话列表，用来补标题与项目名
 * @param {{ onlyEnabled?: boolean }} options onlyEnabled 只保留启用中的任务
 */
export function buildScheduledGroups(rawGroups, sessions, options = {}) {
  const onlyEnabled = options.onlyEnabled === true
  const byId = new Map()
  for (const session of sessions || []) {
    if (session?.id) byId.set(String(session.id), session)
  }
  const groups = []
  for (const entry of rawGroups || []) {
    const sessionId = String(entry?.sessionId || '')
    if (!sessionId) continue
    const all = (Array.isArray(entry?.tasks) ? entry.tasks : []).filter((task) => task?.id)
    const tasks = all
      .filter((task) => (onlyEnabled ? task.enabled !== false : true))
      .slice()
      .sort((left, right) => taskOrder(left).localeCompare(taskOrder(right)))
    if (!tasks.length) continue
    const session = byId.get(sessionId)
    groups.push({
      sessionId,
      title: session?.title || entry?.sessionTitle || t('未命名会话'),
      project: session ? projectName(session) : projectName({ cwd: entry?.workspacePath }),
      missing: entry?.missing === true,
      tasks,
      total: all.length,
      enabled: all.filter((task) => task.enabled !== false).length
    })
  }
  groups.sort((left, right) => groupOrder(left).localeCompare(groupOrder(right)))
  return groups
}

/**
 * 电脑端是否明确表示「不认识 schedules.listAll」。
 *
 * 只有这一种情况值得退回逐会话读取：旧版电脑端会立刻回「不支持该操作」，
 * 几乎不耗时。超时、未连接、正在重连都是链路问题——那时逐个会话重扫
 * （几十个会话要十几批、每批 8 秒上限）只会把弹层再多钉几十秒，
 * 表现就是「点了没反应」。
 */
export function isUnsupportedMethodError(error) {
  const message = error instanceof Error ? error.message : String(error || '')
  return message.includes('不支持该操作')
}

/**
 * 一次 `schedules.listAll` 失败该怎么收场。
 *
 * - `unsupported`：旧电脑端，调用方改走逐会话 `schedules.list`；
 * - `link`：链路不通（超时 / 未连接 / 断线），不再重扫，直接把手上的缓存
 *   交回去并标记 failed，页面据此说「没读到」而不是「没有任务」。
 *
 * @param {unknown} error 请求抛出的错误
 * @param {Array} cachedGroups 当前手上的分组（store.scheduledAllGroups）
 */
export function classifyListAllFailure(error, cachedGroups) {
  if (isUnsupportedMethodError(error)) return { kind: 'unsupported', groups: [], fallback: true }
  return {
    kind: 'link',
    groups: Array.isArray(cachedGroups) ? cachedGroups.slice() : [],
    failed: true,
    fallback: false
  }
}

/**
 * 把一次读取结果合并到弹层已有的列表上。
 *
 * `loadAllScheduled()` 有两种「没拿到新数据」：stale（被后发的读取抢占，
 * groups 为 null）和离线（groups 是缓存副本）。两者都不能把已有列表清空，
 * 否则用户会看到弹层内容闪一下变空、再点也一样空。
 *
 * @param {{ groups?: Array|null, offline?: boolean, stale?: boolean }|null} result
 * @param {Array} current 弹层当前的列表
 * @returns {{ rows: Array, offline: boolean, failed: boolean, updated: boolean }}
 */
export function mergeScheduledResult(result, current = []) {
  const rows = Array.isArray(current) ? current : []
  const offline = result?.offline === true
  // failed：这次一条都没读到（缓存里有的仍是上一次的结果），页面不该说「还没有任务」。
  const failed = result?.failed === true
  if (result?.stale === true) return { rows, offline, failed, updated: false }
  if (!Array.isArray(result?.groups)) return { rows, offline, failed, updated: false }
  // failed 且一条都没有：这是「这次没读到」，不是「任务被清空了」。
  // 电脑端答了空组（或逐会话全答了空）时会走到这里，早先直接 `rows = result.groups`
  // 会把手上那份缓存覆盖成空数组，弹层从列表变成「还没有定时任务」，用户只能
  // 认为这个功能坏了——而同一份数据在电脑端还在。
  if (failed && !result.groups.length) return { rows, offline, failed, updated: false }
  return { rows: result.groups, offline, failed, updated: true }
}

/**
 * 这次结果要不要自动再读一次。
 *
 * 用户点开「全部任务」看到空白是这个功能最坏的体验，而第一次读取最常见的
 * 失败原因是链路刚唤醒（App 从后台回来、刚重连）导致 12 秒超时，或者被首页
 * 那次刷新抢占（stale）。两种都属于「再读一次就好」，所以只要手上还没有任何
 * 行就允许重试一次。离线不重试：链路没通时重读只会把加载态再拖十几秒，
 * 那一步交给弹层里的「重新连接」。
 *
 * @param {{groups?: Array|null, offline?: boolean, stale?: boolean, failed?: boolean}|null} result
 * @param {Array} rows 弹层当前已有的行
 */
export function scheduledRetryNeeded(result, rows = []) {
  if (Array.isArray(rows) && rows.length) return false
  if (!result) return true
  if (result.offline === true) return false
  if (result.stale === true || result.failed === true) return true
  // 形状不对（既没有 groups 也不是上面几种）：当作没读到。
  return !Array.isArray(result.groups)
}

/**
 * 弹层空态的归因：`offline` / `link` / `busy`，空串表示确实没有任务。
 *
 * 三种原因给三种文案：链路没通应该「重新连接」，链路抖动应该「重新读取」，
 * 真的没有任务时不该吓人地报「读不到」。
 */
export function scheduleFailureReason(result, diag) {
  if (!result) return 'link'
  if (result.offline === true) return 'offline'
  if (result.failed === true) return 'link'
  if (result.stale === true) return 'busy'
  if (Array.isArray(result.groups)) return ''
  return String(diag?.error || '') ? 'link' : ''
}

/**
 * 「全部任务」弹层一次读取之后的取数决策（纯函数，单测直接盖）。
 *
 * 早先页面自己写的是「只当 merged.updated 为真才写行」，于是只要这次读取是
 * stale（被首页那次 refreshAll 抢占）或失败，弹层就一直停在空数组上：既不
 * 显示失败，也没有缓存可铺，再点开还是空——而同屏的「全部待办」无条件写行，
 * 所以那边一直是好的。这里把三件事一次说清：写不写行、要不要自动重读一次、
 * 空态该归因成哪一种。
 *
 * @param {{groups?: Array|null, offline?: boolean, stale?: boolean, failed?: boolean}|null} result
 * @param {Array} current 弹层当前持有行
 * @returns {{ rows: Array, offline: boolean, failed: boolean, busy: boolean, retry: boolean }}
 */
export function decideScheduleSheet(result, current = []) {
  const rows = Array.isArray(current) ? current : []
  const merged = mergeScheduledResult(result, rows)
  const reason = scheduleFailureReason(result)
  return {
    rows: merged.rows,
    offline: merged.offline,
    failed: merged.failed === true || reason === 'link' || reason === 'busy',
    // busy：这次被别的读取抢占，不是「没任务」，文案与「没连上」要分开。
    busy: reason === 'busy',
    retry: scheduledRetryNeeded(result, rows)
  }
}

/**
 * 一次读取的诊断行（首页弹层与「全部任务」页共用）。
 *
 * 手机上打不开调试终端，「读到空」有五种成因（离线 / 被抢占 / listAll 超时 /
 * 电脑端答了但形状不对 / 逐会话一个都没回），界面上长得一模一样。
 * 截图里带上来源 / 耗时 / 行数，下一次就能一眼定案，不必再靠猜发版。
 */
export function scheduleDiagText(diag) {
  if (!diag) return ''
  const parts = []
  if (diag.source) parts.push(String(diag.source))
  parts.push(`${Number(diag.ms) || 0}ms`)
  parts.push(`${Number(diag.tasks) || 0}/${Number(diag.groups) || 0}`)
  if (diag.answered !== undefined) parts.push(`a${Number(diag.answered) || 0}`)
  if (diag.error) parts.push(String(diag.error).slice(0, 60))
  return t('本次读取：{v1}', { v1: parts.join(' · ') })
}

/** 汇总条与弹层副标题用的计数：任务总数 / 启用中 / 涉及会话数。 */
export function scheduledTotals(groups) {
  let tasks = 0
  let enabled = 0
  const list = groups || []
  for (const group of list) {
    tasks += Number(group?.total ?? group?.tasks?.length ?? 0) || 0
    enabled += Number(group?.enabled ?? 0) || 0
  }
  return { tasks, enabled, sessions: list.length }
}
