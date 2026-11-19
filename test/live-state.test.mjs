/**
 * 实时状态快照合并的单元测试。
 *
 * 覆盖两种偶发问题：
 * - runs.list 晚到的空快照把刚收到的 chat.started 抹掉；
 * - sessions.list 晚到的旧快照把刚更新的待办数量/运行状态覆盖掉。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { mergeRunsSnapshot, mergeSessionsSnapshot } from '../lib/live-state.js'

test('runs.list 旧快照不会抹掉请求发出后才开始的 run', () => {
  const current = {
    'run-new': {
      runId: 'run-new',
      sessionId: 'sess-a',
      instruction: '检查登录接口',
      _eventAt: 200
    }
  }
  const kept = mergeRunsSnapshot(current, [], 100)
  assert.deepEqual(Object.keys(kept), ['run-new'])
  assert.equal(kept['run-new'].instruction, '检查登录接口')

  // 超过 5 秒保护期的旧快照可以确认任务已经结束。
  const dropped = mergeRunsSnapshot(current, [], 10_000)
  assert.deepEqual(Object.keys(dropped), [])
})

test('runs.list 响应保留事件流里的 instruction 与事件时间', () => {
  const current = {
    'run-a': { runId: 'run-a', sessionId: 'sess-a', instruction: '旧指令', _eventAt: 120 }
  }
  const next = mergeRunsSnapshot(
    current,
    [{ runId: 'run-a', sessionId: 'sess-a', cwd: 'E:\\demo', startedAt: 10 }],
    300
  )
  assert.equal(next['run-a'].instruction, '旧指令')
  assert.equal(next['run-a'].cwd, 'E:\\demo')
  assert.equal(next['run-a']._eventAt, 120)
})

test('sessions.list 旧快照不会覆盖更新的待办数量', () => {
  const rows = [{ id: 'sess-a', todoPendingCount: 0 }]
  const newer = mergeSessionsSnapshot(rows, {
    requestedAt: 100,
    todoCounts: { 'sess-a': 2 },
    todoFactsAt: { 'sess-a': 200 }
  })
  assert.equal(newer[0].todoPendingCount, 2)

  const older = mergeSessionsSnapshot(rows, {
    requestedAt: 300,
    todoCounts: { 'sess-a': 2 },
    todoFactsAt: { 'sess-a': 200 }
  })
  assert.equal(older[0].todoPendingCount, 0)
})

test('sessions.list 旧快照不会把运行中的任务显示成空闲', () => {
  const rows = [{ id: 'sess-a', title: '任务 A' }]
  const merged = mergeSessionsSnapshot(rows, {
    requestedAt: 100,
    runFactsAt: { 'sess-a': 200 },
    activeRuns: {
      'run-a': {
        runId: 'run-a',
        sessionId: 'sess-a',
        instruction: '检查登录接口',
        startedAt: 50
      }
    }
  })
  assert.equal(merged[0].running, true)
  assert.equal(merged[0].runId, 'run-a')
  assert.equal(merged[0].runInstruction, '检查登录接口')
  assert.equal(merged[0].runStartedAt, 50)
})

test('本地已收到结束事实时，旧快照里的 running 会被清掉', () => {
  const rows = [
    { id: 'sess-a', running: true, runId: 'run-a', runInstruction: '检查登录接口' }
  ]
  const merged = mergeSessionsSnapshot(rows, {
    requestedAt: 100,
    runFactsAt: { 'sess-a': 200 },
    activeRuns: {}
  })
  assert.equal(merged[0].running, undefined)
  assert.equal(merged[0].runId, undefined)
  assert.equal(merged[0].runInstruction, undefined)
})

test('sessions.list 旧快照不会把新计划覆盖回旧计划', () => {
  const oldPlan = { goal: '旧计划', items: [{ id: 'a', text: '一', status: 'pending' }] }
  const newPlan = { goal: '新计划', items: [{ id: 'a', text: '一', status: 'done' }] }
  const rows = [{ id: 'sess-a', plan: oldPlan }]
  const merged = mergeSessionsSnapshot(rows, {
    requestedAt: 100,
    plans: { 'sess-a': newPlan },
    planFactsAt: { 'sess-a': 200 }
  })
  assert.deepEqual(merged[0].plan, newPlan)
})

test('请求发出后没有新的计划事实时采用快照里的计划', () => {
  const plan = { goal: '快照计划', items: [] }
  const rows = [{ id: 'sess-a', plan }]
  const merged = mergeSessionsSnapshot(rows, {
    requestedAt: 300,
    plans: { 'sess-a': { goal: '旧计划', items: [] } },
    planFactsAt: { 'sess-a': 200 }
  })
  assert.deepEqual(merged[0].plan, plan)
})

test('没有请求时间（实时事件）时直接采用事件快照', () => {
  const rows = [{ id: 'sess-a', todoPendingCount: 0, running: false }]
  const merged = mergeSessionsSnapshot(rows, {
    requestedAt: 0,
    todoCounts: { 'sess-a': 2 },
    todoFactsAt: { 'sess-a': 200 },
    runFactsAt: { 'sess-a': 200 }
  })
  assert.equal(merged[0].todoPendingCount, 0)
  assert.equal(merged[0].running, false)
})
