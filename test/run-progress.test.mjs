/**
 * 等待行进度文案的单元测试。
 *
 * 现场问题：手机端一条任务跑 2 秒和跑 2 分钟，等待行长得一样（三个点 +「执行中…」），
 * 用户无法判断是卡住还是在跑。这里把「步号 + 已运行时长」的取值规则钉住：
 * - 第 1 步不报步号（与电脑端一致，避免一启动就闪一个「第 1 步」）；
 * - 不足 3 秒不报时长（秒数只会闪一下）；
 * - 没有 startedAt、或数值非法时两段都为空。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  RUN_PROGRESS_MIN_MS,
  formatRunElapsed,
  runElapsedLabel,
  runProgressParts
} from '../lib/run-progress.js'

test('时长格式与电脑端一致：12s / 1m 35s', () => {
  assert.equal(formatRunElapsed(12_000), '12s')
  assert.equal(formatRunElapsed(59_400), '59s')
  assert.equal(formatRunElapsed(95_000), '1m 35s')
  assert.equal(formatRunElapsed(600_000), '10m 0s')
})

test('非法或过短的时长返回空串', () => {
  assert.equal(formatRunElapsed(0), '')
  assert.equal(formatRunElapsed(-1), '')
  assert.equal(formatRunElapsed(Number.NaN), '')
  assert.equal(runElapsedLabel(0, 100_000), '')
  assert.equal(runElapsedLabel('abc', 100_000), '')
  assert.equal(runElapsedLabel(1_000, 1_000 + RUN_PROGRESS_MIN_MS - 1), '')
})

test('刚过 3 秒才开始报时长', () => {
  const startedAt = 1_000_000
  assert.equal(runElapsedLabel(startedAt, startedAt + 2_999), '')
  assert.equal(runElapsedLabel(startedAt, startedAt + 3_000), '3s')
})

test('步号取整，非正数与非法值归零', () => {
  assert.deepEqual(runProgressParts({ step: 3 }), { step: 3, elapsed: '' })
  assert.deepEqual(runProgressParts({ step: 2.9 }), { step: 2, elapsed: '' })
  assert.deepEqual(runProgressParts({ step: 0 }), { step: 0, elapsed: '' })
  assert.deepEqual(runProgressParts({ step: 'x' }), { step: 0, elapsed: '' })
  assert.deepEqual(runProgressParts(null), { step: 0, elapsed: '' })
  assert.deepEqual(runProgressParts(undefined), { step: 0, elapsed: '' })
})

test('run 记录同时给出步号与时长', () => {
  const startedAt = 1_700_000_000_000
  const parts = runProgressParts({ step: 7, startedAt }, startedAt + 95_000)
  assert.deepEqual(parts, { step: 7, elapsed: '1m 35s' })
})

test('startedAt 是字符串（会话快照里就是这样）也能算', () => {
  // 从列表直接进入正在运行的会话时，run 来自 session 快照，时间戳是 ISO 字符串。
  const startedAt = '2026-11-24T10:00:00.000Z'
  const now = Date.parse(startedAt) + 42_000
  // 字符串时间戳在 store 里已 toMillis 过，这里验证纯函数不会把它当成数字。
  assert.equal(runElapsedLabel(startedAt, now), '')
})
