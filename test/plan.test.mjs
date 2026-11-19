/**
 * 手机端计划面板的数据归一化测试。
 *
 * Plan 来自电脑端的 update_plan；手机只负责展示，所以这里重点验证：
 * 空计划不渲染面板、脏数据不会让页面崩溃、运行结束后不再显示「进行中」。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizePlan, planProgress, planRows } from '../lib/plan.js'

test('空计划统一归一化为 null', () => {
  assert.equal(normalizePlan(null), null)
  assert.equal(normalizePlan(undefined), null)
  assert.equal(normalizePlan({}), null)
  assert.equal(normalizePlan({ items: [] }), null)
  assert.equal(normalizePlan({ items: 'oops' }), null)
})

test('计划保留目标并按顺序归一化条目', () => {
  const plan = normalizePlan({
    goal: '修复登录接口',
    updatedAt: '2026-11-11T10:00:00.000Z',
    items: [
      { id: 'a', text: '检查接口', status: 'done' },
      { text: '  补充测试  ', status: 'in_progress' },
      { id: 'c', text: '回归', status: 'weird' }
    ]
  })
  assert.equal(plan.goal, '修复登录接口')
  assert.equal(plan.updatedAt, '2026-11-11T10:00:00.000Z')
  assert.deepEqual(
    plan.items.map((item) => [item.id, item.text, item.status]),
    [
      ['a', '检查接口', 'done'],
      ['plan-1', '补充测试', 'in_progress'],
      ['c', '回归', 'pending']
    ]
  )
})

test('没有文本或不是对象的条目会被丢弃', () => {
  const plan = normalizePlan({
    items: [null, { text: '   ' }, { text: '有效步骤', status: 'pending' }]
  })
  assert.equal(plan.items.length, 1)
  assert.equal(plan.items[0].text, '有效步骤')
})

test('运行中 in_progress 显示为进行中，其余为待办', () => {
  const plan = normalizePlan({
    items: [
      { id: 'a', text: '一', status: 'done' },
      { id: 'b', text: '二', status: 'in_progress' },
      { id: 'c', text: '三', status: 'pending' }
    ]
  })
  const rows = planRows(plan, true)
  assert.deepEqual(
    rows.map((row) => [row.isDone, row.isActive, row.className]),
    [
      [true, false, 'is-done'],
      [false, true, 'is-active'],
      [false, false, 'is-pending']
    ]
  )
})

test('任务结束后 in_progress 兜底显示为已完成，避免一直转圈', () => {
  const plan = normalizePlan({ items: [{ id: 'b', text: '二', status: 'in_progress' }] })
  const [row] = planRows(plan, false)
  assert.equal(row.isDone, true)
  assert.equal(row.isActive, false)
  assert.equal(row.className, 'is-done')
})

test('没有计划时生成空行，不会抛错', () => {
  assert.deepEqual(planRows(null, true), [])
  assert.deepEqual(planRows({}, true), [])
})

test('会话列表摘要给出完成数、带序号的状态圆点与当前步骤', () => {
  const plan = normalizePlan({
    goal: '补测试',
    items: [
      { id: 'a', text: '一', status: 'done' },
      { id: 'b', text: '二', status: 'done' },
      { id: 'c', text: '三', status: 'in_progress' },
      { id: 'd', text: '四', status: 'pending' }
    ]
  })
  assert.deepEqual(planProgress(plan, true), {
    total: 4,
    done: 2,
    steps: [
      { n: 1, text: '一', status: 'done' },
      { n: 2, text: '二', status: 'done' },
      { n: 3, text: '三', status: 'active' },
      { n: 4, text: '四', status: 'pending' }
    ],
    visibleSteps: [
      { n: 1, text: '一', status: 'done' },
      { n: 2, text: '二', status: 'done' },
      { n: 3, text: '三', status: 'active' },
      { n: 4, text: '四', status: 'pending' }
    ],
    hiddenSteps: 0,
    activeText: '三'
  })
})

test('不在运行时 in_progress 回落成已完成，当前步骤为空', () => {
  const plan = normalizePlan({ items: [{ id: 'a', text: '一', status: 'in_progress' }] })
  assert.deepEqual(planProgress(plan, false), {
    total: 1,
    done: 1,
    steps: [{ n: 1, text: '一', status: 'done' }],
    visibleSteps: [{ n: 1, text: '一', status: 'done' }],
    hiddenSteps: 0,
    activeText: ''
  })
})

test('超过 8 步折叠成 +N，并让执行中的序号保持可见', () => {
  const items = Array.from({ length: 10 }, (_, index) => ({
    id: `s${index}`,
    text: `步骤${index + 1}`,
    status: index < 9 ? 'done' : 'in_progress'
  }))
  const summary = planProgress(normalizePlan({ items }), true)
  assert.equal(summary.steps.length, 10)
  assert.equal(summary.visibleSteps.length, 8)
  assert.equal(summary.hiddenSteps, 2)
  assert.deepEqual(
    summary.visibleSteps.map((step) => step.n),
    [3, 4, 5, 6, 7, 8, 9, 10]
  )
  assert.equal(summary.visibleSteps[7].status, 'active')
  assert.equal(summary.done, 9)
})

test('空计划不生成摘要，全部完成时圆点状态都为 done', () => {
  assert.equal(planProgress(null, true), null)
  assert.equal(planProgress({ items: [] }, true), null)
  const done = normalizePlan({
    items: [
      { id: 'a', text: '一', status: 'done' },
      { id: 'b', text: '二', status: 'done' }
    ]
  })
  const summary = planProgress(done, false)
  assert.equal(summary.done, summary.total)
  assert.deepEqual(
    summary.steps.map((step) => step.status),
    ['done', 'done']
  )
})
