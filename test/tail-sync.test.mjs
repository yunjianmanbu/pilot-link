import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TAIL_FALLBACK_MS,
  decideTailSync,
  lastMessageUnanswered
} from '../lib/tail-sync.js'

const base = {
  connected: true,
  agentOnline: true,
  sessionId: 's1',
  loading: false,
  focusMessageId: '',
  historyNewer: false,
  running: false,
  remoteCount: 10,
  knownCount: 10,
  streaming: false,
  fallbackAt: 0,
  now: 1_000_000,
  last: { role: 'assistant', blocks: [{ type: 'text', text: '好' }] }
}

test('电脑端消息变多时补拉尾部（收尾事件丢失的场景）', () => {
  const result = decideTailSync({ ...base, remoteCount: 12 })
  assert.equal(result.sync, true)
  assert.equal(result.reason, 'behind')
  assert.equal(result.fallback, false)
})

test('计数一致时不重复请求', () => {
  assert.equal(decideTailSync(base).sync, false)
  assert.equal(decideTailSync(base).reason, 'fresh')
})

test('最后一条是我的提问且没有回答时用备选信号补拉一次', () => {
  const last = { role: 'user', blocks: [{ type: 'text', text: '最后一轮问答' }] }
  const first = decideTailSync({ ...base, last, remoteCount: 0, knownCount: 0 })
  assert.equal(first.sync, true)
  assert.equal(first.fallback, true)
  // 30 秒内不重复补拉，避免每次前台对账都多发一页历史。
  const second = decideTailSync({
    ...base,
    last,
    remoteCount: 0,
    knownCount: 0,
    fallbackAt: base.now - 1000
  })
  assert.equal(second.sync, false)
  assert.equal(second.reason, 'throttled')
  const third = decideTailSync({
    ...base,
    last,
    remoteCount: 0,
    knownCount: 0,
    fallbackAt: base.now - TAIL_FALLBACK_MS - 1
  })
  assert.equal(third.sync, true)
})

test('正在运行、正在加载、知识库定位、有更新的消息时都不打扰', () => {
  assert.equal(decideTailSync({ ...base, remoteCount: 99, running: true }).reason, 'running')
  assert.equal(decideTailSync({ ...base, remoteCount: 99, loading: true }).reason, 'loading')
  assert.equal(decideTailSync({ ...base, remoteCount: 99, focusMessageId: 'm1' }).reason, 'pinned')
  assert.equal(decideTailSync({ ...base, remoteCount: 99, historyNewer: true }).reason, 'pinned')
})

test('断开或电脑离线时不发请求', () => {
  assert.equal(decideTailSync({ ...base, remoteCount: 99, connected: false }).reason, 'offline')
  assert.equal(decideTailSync({ ...base, remoteCount: 99, agentOnline: false }).reason, 'offline')
})

test('电脑端说没在跑但本地还挂着流式文本时，补拉并收尾', () => {
  const result = decideTailSync({ ...base, streaming: true, remoteCount: 0, knownCount: 0 })
  assert.equal(result.sync, true)
  assert.equal(result.reason, 'stale-stream')
  // 同样受 30 秒节流，不会把对账周期变成请求风暴。
  const again = decideTailSync({
    ...base,
    streaming: true,
    remoteCount: 0,
    knownCount: 0,
    fallbackAt: base.now - 1000
  })
  assert.equal(again.sync, false)
  assert.equal(again.reason, 'throttled')
})

test('最后一条是助手回答或空消息时不算未回答', () => {
  assert.equal(lastMessageUnanswered([{ role: 'user', blocks: [] }]), false)
  assert.equal(lastMessageUnanswered([{ role: 'assistant', blocks: [{ type: 'text', text: '嗯' }] }]), false)
  assert.equal(lastMessageUnanswered([]), false)
  assert.equal(lastMessageUnanswered([{ role: 'user', blocks: [{ type: 'image', url: 'data:image/png;base64,AA' }] }]), true)
})
