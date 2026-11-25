/**
 * 手机端「全部定时任务」的数据层测试。
 *
 * 列表顺序、暂停任务的排位、会话缺失的兜底都在这里定死：
 * 这些规则一旦改坏，弹层里会出现「时间靠后的排在前面」或空标题这类看不动的问题。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

const storage = new Map()
globalThis.uni = {
  getStorageSync: (key) => storage.get(key) || '',
  setStorageSync: (key, value) => storage.set(key, value),
  getLocale: () => 'zh-CN'
}

const { buildScheduledGroups, mergeScheduledResult, scheduleKindLabel, scheduleTimeText, scheduledTotals } =
  await import('../lib/scheduled-overview.js')

function task(id, nextRunAt, extra = {}) {
  return {
    id,
    sessionId: extra.sessionId || 's1',
    content: extra.content || '任务',
    kind: extra.kind || 'interval',
    intervalMinutes: 30,
    nextRunAt,
    enabled: extra.enabled !== false,
    createdAt: '2026-03-01T00:00:00.000Z',
    ...extra
  }
}

test('组内按下次触发时间升序，暂停的任务排在最后', () => {
  const groups = buildScheduledGroups(
    [
      {
        sessionId: 's1',
        sessionTitle: '会话一',
        workspacePath: '/repo/alpha',
        tasks: [
          task('paused', '2026-03-01T01:00:00.000Z', { enabled: false }),
          task('later', '2026-03-01T05:00:00.000Z'),
          task('sooner', '2026-03-01T02:00:00.000Z')
        ]
      }
    ],
    []
  )
  assert.equal(groups.length, 1)
  assert.deepEqual(
    groups[0].tasks.map((item) => item.id),
    ['sooner', 'later', 'paused']
  )
  assert.equal(groups[0].total, 3)
  assert.equal(groups[0].enabled, 2)
})

test('组之间按各自最早的一次触发时间排序，空组被丢弃', () => {
  const groups = buildScheduledGroups(
    [
      { sessionId: 'late', sessionTitle: '晚', tasks: [task('a', '2026-03-02T00:00:00.000Z')] },
      { sessionId: 'empty', sessionTitle: '空', tasks: [] },
      { sessionId: 'soon', sessionTitle: '早', tasks: [task('b', '2026-03-01T00:30:00.000Z')] },
      { sessionId: 'broken', sessionTitle: '坏数据', tasks: [null, {}] }
    ],
    []
  )
  assert.deepEqual(
    groups.map((group) => group.sessionId),
    ['soon', 'late']
  )
})

test('onlyEnabled 只保留启用中的任务，整组都被暂停时整组不显示', () => {
  const raw = [
    {
      sessionId: 's1',
      tasks: [
        task('on', '2026-03-01T01:00:00.000Z'),
        task('off', '2026-03-01T02:00:00.000Z', { enabled: false })
      ]
    },
    { sessionId: 's2', tasks: [task('off2', '2026-03-01T03:00:00.000Z', { enabled: false })] }
  ]
  const groups = buildScheduledGroups(raw, [], { onlyEnabled: true })
  assert.equal(groups.length, 1)
  assert.deepEqual(
    groups[0].tasks.map((item) => item.id),
    ['on']
  )
  assert.equal(groups[0].total, 2)
  assert.equal(groups[0].enabled, 1)
})

test('本地会话补标题与项目名，会话缺失时用电脑端标题并标记 missing', () => {
  const groups = buildScheduledGroups(
    [
      { sessionId: 'known', sessionTitle: '电脑端标题', tasks: [task('a', '2026-03-01T01:00:00.000Z')] },
      {
        sessionId: 'gone',
        sessionTitle: '',
        workspacePath: 'E:\\code\\beta',
        missing: true,
        tasks: [task('b', '2026-03-01T02:00:00.000Z')]
      }
    ],
    [{ id: 'known', title: '本地标题', cwd: 'E:\\code\\alpha' }]
  )
  const known = groups.find((group) => group.sessionId === 'known')
  const gone = groups.find((group) => group.sessionId === 'gone')
  assert.equal(known.title, '本地标题')
  assert.equal(known.project, 'alpha')
  assert.equal(known.missing, false)
  assert.equal(gone.missing, true)
  assert.equal(gone.title, '未命名会话')
  assert.equal(gone.project, 'beta')
})

test('脏输入不抛错：null、非数组、缺 sessionId 都被忽略', () => {
  assert.deepEqual(buildScheduledGroups(null, null), [])
  assert.deepEqual(buildScheduledGroups([null, {}, { sessionId: 's1', tasks: 'oops' }], []), [])
})

test('汇总只算启用中的任务与会话数', () => {
  const groups = buildScheduledGroups(
    [
      {
        sessionId: 's1',
        tasks: [
          task('a', '2026-03-01T01:00:00.000Z'),
          task('b', '2026-03-01T02:00:00.000Z', { enabled: false })
        ]
      },
      { sessionId: 's2', tasks: [task('c', '2026-03-01T03:00:00.000Z')] }
    ],
    []
  )
  assert.deepEqual(scheduledTotals(groups), { tasks: 3, enabled: 2, sessions: 2 })
  assert.deepEqual(scheduledTotals(null), { tasks: 0, enabled: 0, sessions: 0 })
})

test('计划描述按类型给出中文文案', () => {
  assert.equal(scheduleKindLabel(task('a', '2026-03-01T01:00:00.000Z')), '每 30 分钟')
  assert.equal(
    scheduleKindLabel(task('b', '2026-03-01T01:00:00.000Z', { kind: 'daily', timeOfDay: '09:30' })),
    '每天 09:30'
  )
  assert.equal(
    scheduleKindLabel(
      task('c', '2026-03-01T01:00:00.000Z', {
        kind: 'daily',
        timeOfDay: '09:30',
        startDate: '2026-03-05'
      })
    ),
    '09:30（从 2026-03-05 起）'
  )
  assert.equal(
    scheduleKindLabel(task('d', '2026-03-01T01:00:00.000Z', { kind: 'once' })),
    '一次性'
  )
  assert.equal(scheduleKindLabel(null), '')
})

test('下次触发时间格式化，非法时间返回空串', () => {
  // 本地时区格式化：按同一时刻的本地值算期望值，换机器跑也不挂。
  const iso = '2026-03-05T01:02:03.000Z'
  const local = new Date(iso)
  const pad = (value) => String(value).padStart(2, '0')
  assert.equal(
    scheduleTimeText(iso),
    `${pad(local.getMonth() + 1)}-${pad(local.getDate())} ${pad(local.getHours())}:${pad(local.getMinutes())}`
  )
  assert.match(scheduleTimeText(iso), /^\d{2}-\d{2} \d{2}:\d{2}$/)
  assert.equal(scheduleTimeText(''), '')
  assert.equal(scheduleTimeText('not-a-date'), '')
  assert.equal(scheduleTimeText(undefined), '')
})

test('读取作废时保留弹层已有列表，不清成空', () => {
  const current = [{ sessionId: 's1', tasks: [task('a', '2026-03-01T01:00:00.000Z')] }]
  // 被后发的一次读取抢占：groups 为 null，不能把手上这份换成空数组。
  const stale = mergeScheduledResult({ groups: null, offline: false, stale: true }, current)
  assert.equal(stale.rows, current)
  assert.equal(stale.updated, false)
  assert.equal(stale.offline, false)

  // 离线：groups 是缓存副本，照旧用，但不能标成「没有任务」。
  const offline = mergeScheduledResult({ groups: current, offline: true }, current)
  assert.equal(offline.rows, current)
  assert.equal(offline.updated, true)
  assert.equal(offline.offline, true)

  // 真拿到新数据（包括真的空）时正常替换。
  const fresh = mergeScheduledResult({ groups: [], offline: false }, current)
  assert.deepEqual(fresh.rows, [])
  assert.equal(fresh.updated, true)

  // 返回值不合法时保留原列表。
  for (const bad of [null, undefined, {}, { groups: 'nope' }]) {
    const result = mergeScheduledResult(bad, current)
    assert.equal(result.rows, current)
    assert.equal(result.updated, false)
  }
})
