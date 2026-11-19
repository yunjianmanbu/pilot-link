/**
 * 实时状态快照的合并规则。
 *
 * 中继连接上同时存在两类数据：
 * - 事件（chat.started / todos.updated / sessions.updated）按发送顺序到达；
 * - 请求响应（runs.list / sessions.list / todos.list）可能比事件晚到，
 *   内容却是在请求发出那一刻生成的。
 *
 * 如果直接用晚到的旧响应覆盖本地状态，会出现「电脑在线，但 App 看不到
 * 正在执行的任务」或「待办数量刚更新又消失」。这里用请求发出时间与本地
 * 事实时间比较：请求发出后本地又收到/产生了事实时，保留本地事实。
 */

// 手机刚发出消息时本机会乐观创建 run，此时 runs.list 可能还没包含它。
// 请求发出前几秒内产生的 run 先保留，下一次对账再决定是否结束。
const RUN_EVENT_GRACE_MS = 5_000

function number(value) {
  return Number(value) || 0
}

function applyRunToSession(session, run) {
  session.running = true
  session.runId = run.runId
  session.runInstruction = run.instruction || ''
  session.runStartedAt = number(run.startedAt)
}

function clearRunFromSession(session) {
  delete session.running
  delete session.runId
  delete session.runInstruction
  delete session.runStartedAt
}

/** 合并 runs.list 响应：请求发出后才开始的 run 不能被旧响应抹掉。 */
export function mergeRunsSnapshot(current, rows, requestedAt) {
  const previous = current && typeof current === 'object' ? current : {}
  const at = number(requestedAt)
  const next = {}
  for (const run of Array.isArray(rows) ? rows : []) {
    if (!run || typeof run.runId !== 'string') continue
    const existing = previous[run.runId]
    next[run.runId] = {
      ...existing,
      ...run,
      // 旧版插件不返回 instruction，保留事件流里已经拿到的那一条。
      instruction: run.instruction || existing?.instruction || '',
      _eventAt: number(existing?._eventAt)
    }
  }
  for (const [runId, run] of Object.entries(previous)) {
    if (next[runId] || !run) continue
    if (number(run._eventAt) > at - RUN_EVENT_GRACE_MS) next[runId] = run
  }
  return next
}

/**
 * 合并 sessions.list 响应。
 *
 * - todoFactsAt：本地对待办数量的可信时间，晚于请求发出时间时以本地为准；
 * - runFactsAt：本地对运行状态的可信时间，晚于请求发出时间时用 activeRuns 修正；
 * - planFactsAt：本地对计划的可信时间，晚于请求发出时间时以 plans 里的计划为准。
 */
export function mergeSessionsSnapshot(sessions, options = {}) {
  const rows = Array.isArray(sessions) ? sessions : []
  const requestedAt = number(options.requestedAt)
  if (!requestedAt) return rows
  const activeRuns = options.activeRuns && typeof options.activeRuns === 'object'
    ? options.activeRuns
    : {}
  const todoCounts = options.todoCounts && typeof options.todoCounts === 'object'
    ? options.todoCounts
    : {}
  const todoFactsAt = options.todoFactsAt && typeof options.todoFactsAt === 'object'
    ? options.todoFactsAt
    : {}
  const runFactsAt = options.runFactsAt && typeof options.runFactsAt === 'object'
    ? options.runFactsAt
    : {}
  const planFactsAt = options.planFactsAt && typeof options.planFactsAt === 'object'
    ? options.planFactsAt
    : {}
  const plans = options.plans && typeof options.plans === 'object' ? options.plans : {}
  const runs = Object.values(activeRuns).filter(
    (run) => run && typeof run.runId === 'string' && run.sessionId
  )

  return rows.map((session) => {
    if (!session || typeof session.id !== 'string') return session
    const next = { ...session }
    if (number(todoFactsAt[session.id]) > requestedAt) {
      next.todoPendingCount = number(todoCounts[session.id])
    }
    if (number(runFactsAt[session.id]) > requestedAt) {
      const run = runs.find((item) => item.sessionId === session.id)
      if (run) applyRunToSession(next, run)
      else clearRunFromSession(next)
    }
    if (number(planFactsAt[session.id]) > requestedAt && plans[session.id] !== undefined) {
      next.plan = plans[session.id]
    }
    return next
  })
}
