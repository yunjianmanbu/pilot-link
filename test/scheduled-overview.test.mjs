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

const {
  buildScheduledGroups,
  classifyListAllFailure,
  decideScheduleSheet,
  isUnsupportedMethodError,
  mergeScheduledResult,
  scheduleDiagText,
  scheduleKindLabel,
  scheduleTimeText,
  scheduledTotals
} =
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

/**
 * 真机「全部任务一直空」的根因回归：「这次没读到」不能当成「任务被清空了」。
 *
 * 电脑端答了空组（或逐会话都答了空 tasks）时，结果带 failed:true + groups:[]，
 * 旧实现会拿这个空数组覆盖弹层，于是点开只有「还没有定时任务」，而任务在电脑端
 * 明明还在。这里把「failed 且没有一条」固定成保留 current。
 */
test('失败且没拿到任何一条时保留缓存，不把列表清成空', () => {
  const current = [{ sessionId: 's1', tasks: [task('a', '2026-03-01T01:00:00.000Z')] }]
  const failedEmpty = mergeScheduledResult({ groups: [], offline: false, failed: true }, current)
  assert.deepEqual(failedEmpty.rows, current)
  assert.equal(failedEmpty.updated, false)
  assert.equal(failedEmpty.failed, true)

  // 手上已经有缓存行时不再自动重读（避免弹层闪一次），重读交给「重新读取」。
  const decision = decideScheduleSheet({ groups: [], offline: false, failed: true }, current)
  assert.deepEqual(decision.rows, current)
  assert.equal(decision.failed, true)
  assert.equal(decision.retry, false)

  // 但真的读到新内容时（哪怕只有一条）必须替换。
  const fresh = [{ sessionId: 's2', tasks: [task('b', '2026-03-01T02:00:00.000Z')] }]
  assert.deepEqual(mergeScheduledResult({ groups: fresh, failed: false }, current).rows, fresh)
})

/**
 * listAll 失败的两类必须分开：旧电脑端「不认识这个方法」值得退回逐会话读取，
 * 链路不通（超时 / 未连接）重扫只会把弹层再钉几十秒。
 */
test('listAll 失败：只把「不支持该操作」当成旧电脑端', () => {
  assert.equal(isUnsupportedMethodError(new Error('不支持该操作')), true)
  assert.equal(isUnsupportedMethodError('缺少操作名称：不支持该操作'), true)
  assert.equal(isUnsupportedMethodError(new Error('电脑响应超时')), false)
  assert.equal(isUnsupportedMethodError(new Error('尚未连接电脑')), false)
  assert.equal(isUnsupportedMethodError('连接已断开'), false)
  assert.equal(isUnsupportedMethodError(null), false)
  assert.equal(isUnsupportedMethodError(undefined), false)

  const unsupported = classifyListAllFailure(new Error('不支持该操作'), [])
  assert.equal(unsupported.kind, 'unsupported')
  assert.equal(unsupported.fallback, true)
  assert.deepEqual(unsupported.groups, [])
})

test('listAll 链路失败：保留缓存、标记没读到、不再兜底重扫', () => {
  const cached = [{ sessionId: 's1', tasks: [task('a', '2026-01-01T00:00:00.000Z')] }]
  const link = classifyListAllFailure(new Error('电脑响应超时'), cached)
  assert.equal(link.kind, 'link')
  assert.equal(link.failed, true)
  assert.equal(link.fallback, false)
  assert.equal(link.groups.length, 1)
  // 交给页面的必须是副本：弹层往 rows 里塞东西不能改到 store 的缓存。
  link.groups.push({ sessionId: 's2', tasks: [] })
  assert.equal(cached.length, 1)

  // 没有任何缓存时就是空数组 + failed，页面据此说「没读到」而不是「没有任务」。
  const empty = classifyListAllFailure(new Error('尚未连接电脑'), null)
  assert.deepEqual(empty.groups, [])
  assert.equal(empty.failed, true)
})

/**
 * 「全部任务」弹层以前只在 merged.updated 为真时才写行，于是 stale（被首页刷新
 * 抢占）或链路失败时弹层一直停在空数组上，再点开还是空——同屏「全部待办」
 * 每次都无条件写行，所以那边一直是好的。decideScheduleSheet 定死三件事。
 */
test('弹层取数决策：正常结果写行，失败不误报，作废要重读', () => {
  const cached = [{ sessionId: 's1', tasks: [task('a', '2026-01-01T00:00:00.000Z')] }]

  // 1. 真拿到数据：写行、不标失败、不重读。
  const fresh = decideScheduleSheet({ groups: cached, offline: false }, [])
  assert.deepEqual(fresh.rows, cached)
  assert.equal(fresh.failed, false)
  assert.equal(fresh.offline, false)
  assert.equal(fresh.busy, false)
  assert.equal(fresh.retry, false)

  // 2. 电脑端明确答「没有任务」：空列表是真相，不是读取失败。
  const none = decideScheduleSheet({ groups: [], offline: false }, [])
  assert.deepEqual(none.rows, [])
  assert.equal(none.failed, false)
  assert.equal(none.retry, false)

  // 3. 这次读取被抢占（stale）且手上没有内容：保留现状、标 busy、允许自动重读一次。
  const stale = decideScheduleSheet({ groups: null, offline: false, stale: true }, [])
  assert.deepEqual(stale.rows, [])
  assert.equal(stale.busy, true)
  assert.equal(stale.failed, true)
  assert.equal(stale.retry, true)

  // 4. 有缓存时被抢占：缓存照旧铺出来，页面上不该闪空。
  const staleWithCache = decideScheduleSheet(
    { groups: null, offline: false, stale: true },
    cached
  )
  assert.deepEqual(staleWithCache.rows, cached)
  assert.equal(staleWithCache.busy, true)

  // 5. 链路失败（超时 / 未连接）：缓存铺出来、标「没读到」、重读一次。
  const failed = decideScheduleSheet({ groups: cached, offline: false, failed: true }, [])
  assert.deepEqual(failed.rows, cached)
  assert.equal(failed.failed, true)
  assert.equal(failed.busy, false)
  assert.equal(failed.retry, true)

  // 6. 离线：说「离线」而不是「没读到」，也不自动重读（交给重新连接）。
  const offline = decideScheduleSheet({ groups: cached, offline: true }, [])
  assert.deepEqual(offline.rows, cached)
  assert.equal(offline.offline, true)
  assert.equal(offline.retry, false)

  // 7. 已经铺出内容之后，任何一次读取都不该把 rows 清空。
  for (const bad of [null, undefined, { groups: 'nope' }, { groups: null, stale: true }]) {
    assert.deepEqual(decideScheduleSheet(bad, cached).rows, cached)
  }
})

test('诊断行：手机上没有终端，截图这一行就能定案', () => {
  // 没有诊断就什么都不显示，不要让空壳前缀占版面。
  assert.equal(scheduleDiagText(null), '')
  assert.equal(scheduleDiagText(undefined), '')

  // 正常一次读取：来源 · 耗时 · 任务/分组 · 逐会话答题数。
  const text = scheduleDiagText({ source: 'listAll', ms: 118, tasks: 4, groups: 3, answered: 12 })
  assert.ok(text.includes('listAll'), text)
  assert.ok(text.includes('118ms'), text)
  assert.ok(text.includes('4/3'), text)
  assert.ok(text.includes('a12'), text)

  // 缺字段不能打出 undefined / NaN：手机上一行看不懂的字比没有更糟。
  for (const bad of [{}, { ms: null }, { tasks: 'x', groups: undefined }, { source: 0 }]) {
    const line = scheduleDiagText(bad)
    assert.ok(!line.includes('undefined'), line)
    assert.ok(!line.includes('NaN'), line)
  }

  // 错误信息截到 60 字符：弹层与页面的这一行必须能在一屏内读得完。
  const long = scheduleDiagText({ error: 'x'.repeat(200) })
  assert.ok(long.length < 120, String(long.length))
})
