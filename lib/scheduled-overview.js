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
  return { rows: result.groups, offline, failed, updated: true }
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
