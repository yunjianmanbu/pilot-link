/**
 * 电脑端计划（update_plan）在手机端的归一化与展示行。
 *
 * 计划数据来自 Pilot 的 Session.plan，手机端只负责展示，不修改。空计划统一
 * 返回 null，避免界面上出现一个没有内容的「计划 0/0」面板。
 */

const PLAN_STATUSES = ['pending', 'in_progress', 'done']

export function normalizePlan(plan) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.items)) return null
  const items = plan.items
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const text = String(item.text || '').trim()
      if (!text) return null
      return {
        id: String(item.id || `plan-${index}`),
        text,
        status: PLAN_STATUSES.includes(item.status) ? item.status : 'pending'
      }
    })
    .filter(Boolean)
  if (!items.length) return null
  return {
    goal: String(plan.goal || ''),
    items,
    updatedAt: String(plan.updatedAt || '')
  }
}

/**
 * 会话列表用的计划摘要：完成数、总条数、带序号的步骤圆点，以及运行中的当前步骤。
 * 计划为空时返回 null，调用方直接不渲染，避免出现「计划 0/0」。
 *
 * steps 里每个条目都有序号和状态（done / active / pending），列表用它画
 * 不同颜色的圆形数字序号；运行结束后 in_progress 视为已完成，和计划面板一致。
 */
export function planProgress(plan, running) {
  if (!plan || !Array.isArray(plan.items) || plan.items.length === 0) return null
  const total = plan.items.length
  const active = running ? plan.items.find((item) => item.status === 'in_progress') : null
  const steps = plan.items.map((item, index) => {
    const isDone = item.status === 'done' || (item.status === 'in_progress' && !running)
    const isActive = item.status === 'in_progress' && running === true
    return {
      n: index + 1,
      text: item.text,
      status: isDone ? 'done' : isActive ? 'active' : 'pending'
    }
  })
  // done 按圆点状态统计，保证「1/1」和绿色圆点始终一致。
  const done = steps.filter((step) => step.status === 'done').length
  const { visibleSteps, hiddenSteps } = foldSteps(steps)
  return {
    total,
    done,
    steps,
    visibleSteps,
    hiddenSteps,
    activeText: active && active.text ? String(active.text) : ''
  }
}

// 会话列表一行最多画 8 个圆点，再多就折叠成 +N，避免把列表撑高。
const MAX_VISIBLE_STEPS = 8

function foldSteps(steps) {
  if (steps.length <= MAX_VISIBLE_STEPS) {
    return { visibleSteps: steps, hiddenSteps: 0 }
  }
  const activeIndex = steps.findIndex((step) => step.status === 'active')
  // 当前步骤不在前 8 个里时，以它为中心取窗口，保证执行中的黄点始终可见。
  const start =
    activeIndex >= 0
      ? Math.min(Math.max(activeIndex - 3, 0), steps.length - MAX_VISIBLE_STEPS)
      : 0
  return {
    visibleSteps: steps.slice(start, start + MAX_VISIBLE_STEPS),
    hiddenSteps: steps.length - MAX_VISIBLE_STEPS
  }
}

/**
 * 生成计划行。运行结束后电脑端会把 in_progress 落成 done 或 pending；这里
 * 对旧数据兜底：任务已经不在运行，就不该继续显示「进行中」。
 */
export function planRows(plan, running) {
  if (!plan || !Array.isArray(plan.items)) return []
  return plan.items.map((item, index) => {
    const isDone = item.status === 'done' || (item.status === 'in_progress' && !running)
    const isActive = item.status === 'in_progress' && running === true
    return {
      key: item.id || `${index}-${item.text}`,
      text: item.text,
      isDone,
      isActive,
      className: isDone ? 'is-done' : isActive ? 'is-active' : 'is-pending'
    }
  })
}
