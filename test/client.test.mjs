/**
 * 长连接恢复策略的单元测试。
 *
 * 手机端最容易“经常断连”的几个来源：
 * - 部分 Android 运行时只回调 onError，没有 onClose，旧逻辑要等 75 秒静默超时；
 * - 每次 welcome 都无条件清零退避，弱网下会形成每秒重连风暴；
 * - Wi-Fi/移动网络切换后没有系统网络事件，只能干等退避计时。
 *
 * 这里用假的 uni.connectSocket / SocketTask 验证这些路径都会主动收尾并重连。
 */

import './locale-zh.mjs'

import test from 'node:test'
import assert from 'node:assert/strict'

import { RelayClient } from '../lib/client.js'

const KEY = Buffer.alloc(32, 7).toString('base64url')
const storage = new Map()
const sockets = []

function makeTask() {
  return {
    sent: [],
    closed: false,
    failSend: false,
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
      if (this.failSend) {
        payload.fail?.()
        return
      }
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
    },
    error(message = 'boom') {
      this.errorCb?.({ errMsg: message })
    }
  }
}

globalThis.uni = {
  getStorageSync: (key) => (storage.has(key) ? storage.get(key) : ''),
  setStorageSync: (key, value) => {
    storage.set(key, value)
  },
  removeStorageSync: (key) => {
    storage.delete(key)
  },
  connectSocket: (options) => {
    const task = makeTask()
    task.url = options?.url || ''
    sockets.push(task)
    return task
  }
}

function makeClient() {
  const pairing = {
    v: 1,
    relayUrl: 'wss://relay.test/connector',
    relayWrapped: false,
    fallbackUrl: '',
    room: '',
    roomKey: '',
    deviceId: 'dev-1',
    phoneId: 'phone-1',
    token: 'x'.repeat(24),
    keys: { pcToPhone: KEY, phoneToPc: KEY },
    outSeq: 0,
    inSeq: 0,
    pairedAt: Date.now(),
    lastActiveAt: Date.now()
  }
  const states = []
  const client = new RelayClient(pairing, { onState: (state) => states.push(state) })
  return { client, states }
}

function welcome(client) {
  client.task.receive({ type: 'welcome', deviceId: 'dev-1', phoneId: 'phone-1' })
  assert.equal(client.isConnected(), true)
}

test('onError 立即收尾并重连，不必等 onClose', () => {
  const { client, states } = makeClient()
  client.connect()
  const task = client.task
  task.open()
  task.error('network down')

  assert.equal(client.task, null)
  assert.equal(client.isConnected(), false)
  assert.ok(client.reconnectTimer)
  assert.equal(task.closed, true)
  assert.equal(states.at(-1).state, 'reconnecting')
  assert.equal(states.at(-1).message, 'network down')
  client.stop()
})

test('网络恢复立即重连并清零退避', () => {
  const { client } = makeClient()
  client.connect()
  client.task.open()
  client.task.error('offline')
  assert.ok(client.reconnectTimer)
  assert.equal(client.attempt, 1)

  const before = sockets.length
  client.onNetworkOnline()

  assert.equal(sockets.length, before + 1)
  assert.equal(client.attempt, 0)
  assert.ok(client.task)
  client.stop()
})

test('短命连接断开会保留退避等级', () => {
  const { client } = makeClient()
  client.connect()
  client.task.open()
  welcome(client)
  client.task.error('flaky link')

  // 没有清零：退避从 0 升到 1，下次仍按 600ms 起步并继续累积。
  assert.equal(client.attempt, 1)
  client.stop()
})

test('稳定连接断开后才清零退避', () => {
  const { client } = makeClient()
  client.connect()
  client.task.open()
  welcome(client)
  client.attempt = 3
  client.connectedAt = Date.now() - 60_000

  client.task.error('drop after long run')

  assert.equal(client.attempt, 1)
  client.stop()
})

test('发送失败视为断线并重连', () => {
  const { client } = makeClient()
  client.connect()
  client.task.open()
  welcome(client)
  client.task.failSend = true

  assert.equal(client.sendRaw({ type: 'ping' }, false), true)
  assert.equal(client.task, null)
  assert.ok(client.reconnectTimer)
  client.stop()
})

test('连接中遇到网络恢复会丢弃旧套接字并重开', () => {
  const { client } = makeClient()
  client.connect()
  const first = client.task
  assert.ok(first)

  const before = sockets.length
  client.onNetworkOnline()

  assert.equal(first.closed, true)
  assert.equal(sockets.length, before + 1)
  assert.notEqual(client.task, first)
  client.stop()
})

test('连接器返回 relay.error 后重新连接', () => {
  const { client, states } = makeClient()
  client.connect()
  client.task.open()
  client.task.receive({ type: 'relay.error', message: '连接器暂时不可用' })

  assert.equal(client.task, null)
  assert.ok(client.reconnectTimer)
  assert.equal(states.at(-1).state, 'reconnecting')
  client.stop()
})

test('auth_required 表示电脑端已重启，自动重连并重新握手', () => {
  const { client, states } = makeClient()
  client.connect()
  client.task.open()
  welcome(client)

  try {
    client.task.receive({
      type: 'error',
      code: 'auth_required',
      message: '请先完成配对'
    })

    assert.equal(client.task, null)
    assert.ok(client.reconnectTimer)
    assert.equal(states.at(-1).message, '连接已失效，正在重新连接')
  } finally {
    client.stop()
  }
})

test('连续两次心跳都没有回帧会判定假在线并重连', () => {
  const { client } = makeClient()
  client.connect()
  client.task.open()
  welcome(client)

  try {
    // 用真实心跳回调驱动：模拟上一次心跳已经发过，之后一个帧都没收到。
    const tick = () => client.pingTimer._onTimeout()
    client.lastPingAt = Date.now()
    client.lastFrameAt = Date.now() - 1_000
    tick()
    assert.equal(client.pingFailures, 1)
    assert.notEqual(client.task, null)

    client.lastFrameAt = Date.now() - 1_000
    tick()
    assert.equal(client.task, null)
    assert.ok(client.reconnectTimer)
  } finally {
    client.stop()
  }
})

test('后台不按墙钟判定静默；回到前台探活健康就不重连', async () => {
  const { client } = makeClient()
  client.connect()
  client.task.open()
  welcome(client)
  const task = client.task

  try {
    client.setForeground(false)
    // 模拟后台被系统冻结十分钟：定时器恢复时墙钟差很大，但连接仍然健康。
    client.lastFrameAt = Date.now() - 10 * 60_000
    client.pingTimer._onTimeout()

    assert.equal(client.task, task)
    assert.equal(client.isConnected(), true)
    assert.equal(client.reconnectTimer, null)

    // 回到前台：距上一帧已经十分钟，先短探活；电脑有回包就直接复用连接。
    // 旧版在这里把 lastFrameAt 重置成「刚收到帧」，真正断掉的连接会被
    // 藏住 30-45 秒，用户看到的就是「切回前台还得重新连一次」。
    client.request = () => Promise.resolve({ ok: true })
    client.setForeground(true)
    await client.linkProbe

    assert.equal(client.task, task)
    assert.equal(client.isConnected(), true)
    assert.equal(client.reconnectTimer, null)
    assert.equal(client.pingFailures, 0)
  } finally {
    client.stop()
  }
})

test('回前台探活第二轮才成功就不重连，并记下探活轮数', async () => {
  const { client } = makeClient()
  client.connect()
  client.task.open()
  welcome(client)
  const task = client.task

  try {
    client.setForeground(false)
    client.lastFrameAt = Date.now() - 60_000
    // 第一轮丢掉（射频刚唤醒），第二轮回包：连接是健康的，不能拆。
    let calls = 0
    client.request = () => {
      calls += 1
      return calls === 1 ? Promise.reject(new Error('timeout')) : Promise.resolve({ ok: true })
    }
    client.setForeground(true)
    await client.linkProbe

    assert.equal(calls, 2)
    assert.equal(client.linkProbe, null)
    assert.equal(client.task, task)
    assert.equal(client.reconnectTimer, null)
    assert.equal(client.lastProbe.ok, true)
    assert.equal(client.lastProbe.rounds, 2)
  } finally {
    client.stop()
  }
})

test('后台回帧数与断开原因可以被诊断读取', () => {
  const { client } = makeClient()
  client.connect()
  client.task.open()
  welcome(client)

  try {
    client.setForeground(false)
    client.task.receive({ type: 'pong', t: Date.now() })
    client.task.receive({ type: 'pong', t: Date.now() })
    const alive = client.backgroundTrace()
    assert.equal(alive.frames, 2)
    assert.equal(alive.closeAt, 0)
    assert.equal(alive.closeReason, '')

    // 后台期间真的断开：记下时间和原因，设置页据此区分「ROM 掐断」与「没连上」。
    client.task.error('network down')
    const dropped = client.backgroundTrace()
    assert.ok(dropped.closeAt > 0)
    assert.equal(dropped.closeReason, 'network down')

    // 回前台后不再计入后台帧数
    client.setForeground(true)
    assert.equal(client.hiddenFrames, 0)
  } finally {
    client.stop()
  }
})

test('回到前台两轮探活都没回帧，清零退避立即重连', async () => {
  const { client, states } = makeClient()
  client.connect()
  client.task.open()
  welcome(client)
  const task = client.task

  try {
    client.attempt = 4
    client.setForeground(false)
    client.lastFrameAt = Date.now() - 5 * 60_000
    client.request = () => Promise.reject(new Error('timeout'))
    client.setForeground(true)
    await client.linkProbe

    assert.equal(client.task, null)
    assert.equal(task.closed, true)
    assert.ok(client.reconnectTimer)
    assert.equal(states.at(-1).state, 'reconnecting')
    // 回前台属于「用户正在等」，不能从第 4 级退避（≈6 秒）开始等。
    assert.ok(client.reconnectTimer._idleTimeout <= 1_300)
  } finally {
    client.stop()
  }
})

test('后台收到过帧就不探活，回前台直接复用连接', async () => {
  const { client } = makeClient()
  client.connect()
  client.task.open()
  welcome(client)
  const task = client.task

  try {
    client.setForeground(false)
    // 前台服务把进程托住了：后台期间仍有回帧，链路不需要复验。
    client.task.receive({ type: 'pong', t: Date.now() })
    client.request = () => {
      throw new Error('不应该探活')
    }
    client.setForeground(true)

    assert.equal(client.linkProbe, null)
    assert.equal(client.task, task)
    assert.equal(client.isConnected(), true)
  } finally {
    client.stop()
  }
})

test('定时器被冻结后恢复（ROM 漏掉前后台回调）也能自愈', async () => {
  const { client } = makeClient()
  client.connect()
  client.task.open()
  welcome(client)
  const task = client.task

  try {
    // 模拟只有心跳定时器晚到 5 分钟才恢复，onHide/onShow 一次都没触发。
    client.lastTickAt = Date.now() - 5 * 60_000
    client.lastFrameAt = Date.now() - 5 * 60_000
    client.request = () => Promise.resolve({ ok: true })
    client.pingTimer._onTimeout()

    assert.equal(client.linkProving, true)
    await client.linkProbe
    assert.equal(client.task, task)
    assert.equal(client.reconnectTimer, null)
  } finally {
    client.stop()
  }
})

test('后台心跳发送连续失败仍会收尾重连', () => {
  const { client } = makeClient()
  client.connect()
  client.task.open()
  welcome(client)

  try {
    client.setForeground(false)
    client.sendRaw = () => false
    client.pingTimer._onTimeout()
    assert.notEqual(client.task, null)
    client.pingTimer._onTimeout()
    assert.equal(client.task, null)
    assert.ok(client.reconnectTimer)
  } finally {
    client.stop()
  }
})

test('稳定连接后的离线通知不会累积退避', () => {
  const { client } = makeClient()
  client.connect()
  client.task.open()
  welcome(client)
  client.attempt = 3
  client.connectedAt = Date.now() - 60_000

  client.task.receive({ type: 'relay.error', message: '电脑已离线，正在等待重新连接' })

  // 稳定连接断开后从 0 重新计算退避，而不是在 3 的基础上继续加。
  assert.equal(client.attempt, 1)
  client.stop()
})

function makeLanClient() {
  const pairing = {
    v: 1,
    relayUrl: 'wss://relay.test/connector',
    relayWrapped: true,
    fallbackUrl: '',
    fallbackWrapped: false,
    lanUrls: ['ws://192.168.1.8:47831/ws'],
    room: 'room-1',
    roomKey: 'key-1',
    deviceId: 'dev-1',
    phoneId: 'phone-1',
    token: 'x'.repeat(24),
    keys: { pcToPhone: KEY, phoneToPc: KEY },
    outSeq: 0,
    inSeq: 0,
    pairedAt: Date.now(),
    lastActiveAt: Date.now()
  }
  const states = []
  const welcomes = []
  const client = new RelayClient(pairing, {
    onState: (state) => states.push(state),
    onWelcome: (frame) => welcomes.push(frame)
  })
  return { client, pairing, states, welcomes }
}

test('同一局域网时优先直连，中继只作为回退', () => {
  const { client } = makeLanClient()
  assert.deepEqual(
    client.candidates.map((item) => item.url),
    ['ws://192.168.1.8:47831/ws', 'wss://relay.test/connector']
  )
  client.connect()
  assert.equal(client.task.url, 'ws://192.168.1.8:47831/ws')
  assert.equal(client.transport, 'lan')
  client.stop()
})

test('直连无响应时快速回退中继，并冷却一段时间', () => {
  const { client } = makeLanClient()
  client.connect()
  const direct = client.task
  assert.equal(direct.url, 'ws://192.168.1.8:47831/ws')

  client.welcomeTimer._onTimeout()

  assert.equal(direct.closed, true)
  assert.ok(client.lanRetryAt > Date.now())
  assert.ok(client.reconnectTimer)

  client.reconnectTimer._onTimeout()
  assert.equal(client.task.url, 'wss://relay.test/connector')
  assert.equal(client.transport, 'relay')
  client.stop()
})

test('中继连接会采纳电脑广播的局域网地址并静默升级', () => {
  const { client, pairing, welcomes } = makeLanClient()
  pairing.lanUrls = []
  client.rebuildCandidates()
  client.connect()
  const relay = client.task
  assert.equal(relay.url, 'wss://relay.test/connector')
  relay.open()
  relay.receive({
    type: 'welcome',
    deviceId: 'dev-1',
    phoneId: 'phone-1',
    lan: ['ws://192.168.1.9:47831/ws']
  })

  assert.equal(client.isConnected(), true)
  assert.equal(client.transport, 'relay')
  assert.deepEqual(pairing.lanUrls, ['ws://192.168.1.9:47831/ws'])
  assert.equal(welcomes.length, 1)

  // 跳过等待，直接开始后台升级。
  clearTimeout(client.upgradeTimer)
  client.upgradeTimer = null
  client.tryUpgradeToLan()
  const upgrade = sockets.at(-1)
  assert.ok(upgrade && upgrade !== relay)
  assert.equal(upgrade.url, 'ws://192.168.1.9:47831/ws')

  upgrade.open()
  assert.match(upgrade.sent[0], /"type":"hello"/)
  upgrade.receive({ type: 'hello.challenge', challenge: 'abc' })
  assert.match(upgrade.sent.at(-1), /"type":"hello.proof"/)

  // 电脑端完成新连接后，会先把旧的中继连接标记为 replaced 再关闭。
  relay.receive({ type: 'error', code: 'replaced', message: '这个配对正在另一处使用' })
  relay.close()

  upgrade.receive({ type: 'welcome', deviceId: 'dev-1', phoneId: 'phone-1' })

  assert.equal(client.task, upgrade)
  assert.equal(client.isConnected(), true)
  assert.equal(client.transport, 'lan')
  assert.equal(client.current.url, 'ws://192.168.1.9:47831/ws')
  assert.equal(relay.closed, true)
  // 只是换了传输路径，不触发整页刷新。
  assert.equal(welcomes.length, 1)

  // 升级后的套接字必须继续走正常消息处理，否则响应和事件都会丢。
  client.lastFrameAt = 0
  upgrade.receive({ type: 'pong' })
  assert.ok(client.lastFrameAt > 0)
  client.stop()
})

test('后台直连升级失败不影响现有中继连接', () => {
  const { client, pairing } = makeLanClient()
  pairing.lanUrls = []
  client.rebuildCandidates()
  client.connect()
  const relay = client.task
  relay.open()
  relay.receive({
    type: 'welcome',
    deviceId: 'dev-1',
    phoneId: 'phone-1',
    lan: ['ws://192.168.1.9:47831/ws']
  })

  clearTimeout(client.upgradeTimer)
  client.upgradeTimer = null
  client.tryUpgradeToLan()
  const upgrade = sockets.at(-1)
  assert.notEqual(upgrade, relay)

  upgrade.error('no route')

  assert.equal(client.task, relay)
  assert.equal(client.isConnected(), true)
  assert.equal(client.transport, 'relay')
  assert.ok(client.lanRetryAt > Date.now())
  // 冷却结束后还会再试一次，住家 Wi-Fi 恢复后能自动切回直连。
  assert.ok(client.upgradeTimer)
  client.stop()
})
