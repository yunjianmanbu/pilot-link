import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BG_HIDE_KEY,
  BG_REPORT_KEY,
  backgroundDurationParts,
  buildHideMarker,
  createRuntimeSession,
  evaluateBackgroundReturn,
  readStoredJson,
  removeStoredKey,
  writeStoredJson
} from '../lib/background-report.js'

function fakeStorage() {
  const data = new Map()
  return {
    data,
    getStorageSync(key) {
      return data.has(key) ? data.get(key) : ''
    },
    setStorageSync(key, value) {
      data.set(key, value)
    },
    removeStorageSync(key) {
      data.delete(key)
    }
  }
}

test('运行时会话 id 每次启动都不同', () => {
  const a = createRuntimeSession(1000, () => 0.1)
  const b = createRuntimeSession(1000, () => 0.2)
  assert.notEqual(a, b)
  assert.equal(a.split('-').length, 2)
})

test('后台标记可以同步写入、读回和清除', () => {
  const storage = fakeStorage()
  const marker = buildHideMarker({
    session: 's1',
    at: 1000,
    connected: true,
    keepAlive: 'service'
  })
  assert.equal(writeStoredJson(storage, BG_HIDE_KEY, marker), true)
  assert.deepEqual(readStoredJson(storage, BG_HIDE_KEY), marker)
  removeStoredKey(storage, BG_HIDE_KEY)
  assert.equal(readStoredJson(storage, BG_HIDE_KEY), null)
})

test('存储里是字符串时也能解析，坏数据返回 null', () => {
  const storage = fakeStorage()
  storage.setStorageSync(BG_REPORT_KEY, JSON.stringify({ kind: 'kept' }))
  assert.deepEqual(readStoredJson(storage, BG_REPORT_KEY), { kind: 'kept' })
  storage.setStorageSync(BG_REPORT_KEY, '{oops')
  assert.equal(readStoredJson(storage, BG_REPORT_KEY), null)
})

test('同一进程且连接还在：判定为连接保持', () => {
  const marker = buildHideMarker({ session: 's1', at: 10_000, connected: true })
  const report = evaluateBackgroundReturn(marker, 's1', true, '', 70_000)
  assert.equal(report.kind, 'kept')
  assert.equal(report.ms, 60_000)
  assert.equal(report.wasConnected, true)
})

test('同一进程但套接字已断：判定为连接被断开，并带上错误', () => {
  const marker = buildHideMarker({ session: 's1', at: 0, connected: true })
  const report = evaluateBackgroundReturn(marker, 's1', false, '连接已断开', 5_000)
  assert.equal(report.kind, 'dropped')
  assert.equal(report.error, '连接已断开')
  assert.equal(report.wasConnected, true)
})

test('运行时换了：判定为进程被系统回收', () => {
  const marker = buildHideMarker({ session: 'old', at: 0, connected: true })
  const report = evaluateBackgroundReturn(marker, 'new', true, '', 60_000)
  assert.equal(report.kind, 'process-gone')
  assert.equal(report.wasConnected, true)
})

test('没有标记时是首次启动，不产生报告', () => {
  assert.equal(evaluateBackgroundReturn(null, 's1', true, '', 1).kind, 'first')
  assert.equal(evaluateBackgroundReturn({}, 's1', true, '', 1).kind, 'first')
})

test('时长拆成翻译用的结构', () => {
  assert.deepEqual(backgroundDurationParts(10_000), { unit: 'short' })
  assert.deepEqual(backgroundDurationParts(5 * 60_000), { unit: 'minutes', minutes: 5 })
  assert.deepEqual(backgroundDurationParts(65 * 60_000), {
    unit: 'hours',
    hours: 1,
    minutes: 5
  })
  assert.deepEqual(backgroundDurationParts(120 * 60_000), {
    unit: 'hours',
    hours: 2,
    minutes: 0
  })
})
