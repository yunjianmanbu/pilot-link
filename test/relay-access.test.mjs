/**
 * L1 准入码（中继 0.2.3）在手机端的两条路径：
 * 1. 配对链接里的 `a` 字段要落到 pairing 上，并在 relay.hello 里透传；
 * 2. 旧电脑端（没有 a）连 STRICT=1 的中继会拿到 4009，界面要给可照着做的提示。
 *
 * 依赖 lib/i18n.js，所以这里也要装一个最小的 uni 存储桩。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

const storage = new Map()
globalThis.uni = {
  getStorageSync: (key) => (storage.has(key) ? storage.get(key) : ''),
  setStorageSync: (key, value) => {
    storage.set(key, value)
  },
  removeStorageSync: (key) => {
    storage.delete(key)
  },
  getSystemInfoSync: () => ({ language: 'zh-Hans-CN' })
}

const { validatePairingPayload, splitRelayUrl } = await import('../lib/pairing.js')
const { RelayClient } = await import('../lib/client.js')

const CODE = 'home:0123456789abcdef0123456789abcdef'
const KEY = Buffer.alloc(32, 7).toString('base64')

function payload(extra = {}) {
  return {
    v: 1,
    r: 'wss://relay.example.com/c/9f3a2c7e18b46d05af3c72e95d1406b8',
    d: 'desktop0001',
    k: 'k'.repeat(22),
    s: 's'.repeat(24),
    p: 'p'.repeat(86),
    n: 'Desktop',
    x: 'r'.repeat(24),
    h: 'h'.repeat(24),
    ...extra
  }
}

function makeTask() {
  const task = {
    url: '',
    sent: [],
    closed: false,
    openCb: null,
    messageCb: null,
    errorCb: null,
    closeCb: null,
    onOpen(cb) {
      this.openCb = cb
    },
    onMessage(cb) {
      this.messageCb = cb
    },
    onError(cb) {
      this.errorCb = cb
    },
    onClose(cb) {
      this.closeCb = cb
    },
    send(payload) {
      this.sent.push(payload.data)
    },
    close() {
      if (this.closed) return
      this.closed = true
      this.closeCb?.({})
    },
    open() {
      this.openCb?.()
    },
    receive(frame) {
      this.messageCb?.({ data: JSON.stringify(frame) })
    }
  }
  return task
}

const sockets = []
globalThis.uni.connectSocket = (options) => {
  const task = makeTask()
  task.url = options?.url || ''
  sockets.push(task)
  return task
}

function makeClient(pairing) {
  const states = []
  const client = new RelayClient(
    {
      v: 1,
      relayUrl: pairing.relayUrl,
      relayWrapped: true,
      fallbackUrl: '',
      room: pairing.room,
      roomKey: pairing.roomKey,
      access: pairing.access,
      deviceId: 'desktop0001',
      phoneId: 'phone0001',
      token: 'x'.repeat(24),
      keys: { pcToPhone: KEY, phoneToPc: KEY },
      outSeq: 0,
      inSeq: 0,
      pairedAt: Date.now(),
      lastActiveAt: Date.now()
    },
    { onState: (state) => states.push(state) }
  )
  return { client, states }
}

test('配对链接里的 a 字段被接受并落到 access', () => {
  const parsed = validatePairingPayload(payload({ a: CODE }))
  assert.equal(parsed.access, CODE)
})

test('旧电脑端的配对链接没有 a，access 为空且不报错', () => {
  const parsed = validatePairingPayload(payload())
  assert.equal(parsed.access, '')
})

test('格式不对的 a 被忽略，不会拼进 relay.hello', () => {
  for (const bad of ['', 'no-separator', 'home:short', 42, null]) {
    const parsed = validatePairingPayload(payload({ a: bad }))
    assert.equal(parsed.access, '', `应忽略：${String(bad)}`)
  }
})

test('relay.hello 带上准入码，没开 STRICT 的中继也能兼容收下', (t) => {
  const pairing = validatePairingPayload(payload({ a: CODE }))
  const { client } = makeClient(pairing)
  t.after(() => client.stop())
  client.connect()
  const task = client.task
  task.open()

  const hello = JSON.parse(task.sent[0])
  assert.equal(hello.type, 'relay.hello')
  assert.equal(hello.role, 'phone')
  assert.equal(hello.access, CODE)
})

test('配对里没有准入码时不发 access 字段（保持与 0.2.2 一致）', (t) => {
  const pairing = validatePairingPayload(payload())
  const { client } = makeClient(pairing)
  t.after(() => client.stop())
  client.connect()
  const task = client.task
  task.open()

  const hello = JSON.parse(task.sent[0])
  assert.equal(hello.type, 'relay.hello')
  assert.equal('access' in hello, false)
})

test('中继要求准入码时给出可操作的提示，而不是原文“连接器要求准入码”', (t) => {
  const pairing = validatePairingPayload(payload())
  const { client, states } = makeClient(pairing)
  // 断言失败时也要收掉心跳定时器，否则 node --test 会一直挂着不退。
  t.after(() => client.stop())
  client.connect()
  client.task.open()
  client.task.receive({ type: 'relay.error', message: '连接器要求准入码' })

  const last = states.at(-1)
  assert.equal(last.state, 'reconnecting')
  assert.match(last.message, /准入码/)
  assert.match(last.message, /#k=/)
})

test('splitRelayUrl 接受安装脚本打印的整条连接串', () => {
  assert.deepEqual(splitRelayUrl(`wss://relay.example.com/c/9f3a#k=${CODE}`), {
    url: 'wss://relay.example.com/c/9f3a',
    access: CODE
  })
  assert.equal(splitRelayUrl('wss://relay.example.com/connector').access, '')
})
