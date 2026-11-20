/**
 * 与 Pilot 电脑端的长连接。
 *
 * - 云端连接器：先发 relay.hello 加入房间，再发业务 hello，并等待
 *   hello.challenge -> hello.proof 挑战应答；局域网直连则直接发 hello；
 * - 所有业务消息用 ECDH 派生的 AES-256-GCM 密钥加密；
 * - 收发序号持久化在配对信息里，重启 App 后继续递增，不会重放；
 * - 断线自动重连（指数退避 + 抖动），15 秒心跳，45 秒无任何帧主动重连；
 * - 连续两次心跳没有回帧就判定假在线，不必等满 45 秒；
 * - 连接维持不足 45 秒就断开时保留退避等级，避免弱网下每秒重连；
 * - Android 的 onError 不保证会跟一个 onClose，发送失败与网络恢复都会主动重连。
 */

import { randomBase64url } from './bytes.js'
import { decryptPayload, encryptPayload, importKey, tokenProof } from './e2e.js'
import { savePairing } from './storage.js'
import { t } from './i18n.js'

const REQUEST_TIMEOUT = 20_000
const LONG_TIMEOUT = 60_000
const PING_INTERVAL = 15_000
const SILENCE_TIMEOUT = 45_000
// 回到前台后的链路复验：只有「后台期间一个帧都没收到」才需要探活。短超时连探
// 几次都没有回帧，才说明后台期间连接已经死了，立刻重建，而不是等满 45 秒静默。
// 3 轮而不是 2 轮：手机刚从后台回来时射频可能还在休眠，第一个包要等
// RRC 重建，单次 3 秒经常不够；误判会直接把一条健康连接拆掉，而多等一轮
// 最多 3 秒，比 45 秒短得多。
const FOREGROUND_PROBE_TIMEOUT = 3_000
const FOREGROUND_PROBE_ROUNDS = 3
const WELCOME_TIMEOUT = 25_000
// 局域网直连握手只要几秒；失败后尽快回退中继，不能让用户干等。
const LAN_WELCOME_TIMEOUT = 4_500
// 直连失败后先安静一段时间，避免每次重连都白等一个直连超时。
const LAN_RETRY_MS = 90_000
// 已经连上中继时，在后台尝试升级到局域网直连。
const LAN_UPGRADE_DELAY = 1_500
const LAN_UPGRADE_TIMEOUT = 5_000
// 连接稳定这么久才把重连退避清零；更快断开会继续累积退避。
const STABLE_CONNECTION_MS = 45_000
const RECONNECT_MAX_MS = 6_000
const ACTIVE_SAVE_INTERVAL = 60_000
// 发送序号按窗口预留：每次写盘预留 64 个序号，消息发送时只用内存自增，
// 避免每条请求都做一次同步存储写入（App 端每次写盘都要过原生桥，很费时）。
const SEQ_WINDOW = 64

function isWrapped(candidate) {
  return Boolean(candidate && candidate.wrapped && candidate.room && candidate.roomKey)
}

export class RelayClient {
  constructor(pairing, handlers = {}) {
    this.pairing = pairing
    this.handlers = handlers
    this.keys = {
      pcToPhone: importKey(pairing.keys.pcToPhone),
      phoneToPc: importKey(pairing.keys.phoneToPc)
    }
    if (!Array.isArray(pairing.lanUrls)) pairing.lanUrls = []
    this.candidates = []
    this.rebuildCandidates()
    this.urlIndex = 0
    this.current = null
    // 'lan' | 'relay'，界面用它显示“局域网直连”还是普通“已连接”。
    this.transport = ''
    // 直连最近失败时的时间点；在此之前重连直接走中继。
    this.lanRetryAt = 0
    // 正在后台尝试的直连升级套接字。
    this.upgradeTask = null
    this.upgradeTimer = null
    this.expectReplace = false
    // pairing.outSeq 始终指向“已预留但还没用”的窗口起点。
    this.nextSeq = Number(pairing.outSeq) || 0
    this.outSeq = this.nextSeq
    this.inSeq = Number(pairing.inSeq) || 0
    this.reserveSeqWindow()
    this.task = null
    this.state = 'idle'
    this.connected = false
    this.relayReady = false
    this.stopped = false
    this.pending = new Map()
    this.requestSeq = 0
    this.attempt = 0
    this.welcomeTimer = null
    this.pingTimer = null
    this.reconnectTimer = null
    this.lastFrameAt = 0
    this.lastActiveSavedAt = 0
    this.connectedAt = 0
    this.pingFailures = 0
    this.lastPingAt = 0
    this.lastError = ''
    // App 是否在前台。后台时 JS 定时器可能被系统冻结或降频，不能用墙钟
    // 判断“多久没收到帧”，否则回到前台的第一次心跳会误杀仍然健康的连接。
    this.foreground = true
    // 进入后台的时刻。回到前台时用它判断后台期间有没有收到过帧：有帧说明
    // 连接真的活着，没有帧才值得探活。
    this.backgroundAt = 0
    // 后台期间收到的帧数。0 帧说明进程或网络在后台被挂起，探活才有意义。
    this.hiddenFrames = 0
    // 最近一次套接字被判定不可用的时刻与原因，以及最近一次前台复验的结果。
    // 设置页把它们和后台报告放在一起：只看「又要重连」分不清是 ROM 掐断、
    // 网络没了，还是我们自己探活误判。
    this.lastCloseAt = 0
    this.lastCloseReason = ''
    this.lastProbe = null
    // 前台复验进行中：这期间心跳不做静默判定，避免墙钟差值误杀。
    this.linkProving = false
    this.linkProbe = null
    // 上一次心跳的墙钟时间。用它算定时器漂移：Android 冻结 WebView 后
    // setInterval 会晚几分钟才恢复，漂移量能直接暴露「刚从后台回来」，不依赖
    // onShow/onHide 是否可靠触发。
    this.lastTickAt = 0
  }

  /** App 前后台切换时由 store 调用。 */
  setForeground(value) {
    const next = value !== false
    if (next === false) {
      this.foreground = false
      this.backgroundAt = Date.now()
      this.hiddenFrames = 0
      return
    }
    const wasBackground = this.foreground === false
    this.foreground = true
    // 后台帧数只服务于「上一次后台」的报告，store 已经在 setForeground 之前
    // 读过 backgroundTrace，这里可以清零，避免下一次误报。
    this.hiddenFrames = 0
    this.pingFailures = 0
    this.lastPingAt = 0
    // 这里不再把 lastFrameAt 当成「刚收到帧」。那样会让真正断掉的连接被藏住
    // 30-45 秒（心跳要等满静默超时才收尾），用户看到的就是「切回前台还要
    // 重新连一次」。也不假设 onHide 一定触发过：只要当前时间距上一帧足够
    // 远，就当链路待复验。
    const now = Date.now()
    const gap = this.lastFrameAt ? now - this.lastFrameAt : Infinity
    if (!this.connected || gap <= PING_INTERVAL) return
    if (wasBackground) this.backgroundAt = this.backgroundAt || now
    void this.proveLink()
  }

  /**
   * 复验链路是否还活着。
   *
   * 后台期间收到过帧（前台服务把进程托住了，心跳和回帧都正常）：链路就是活的，
   * 不探活、不重连，避免每次切回来都重建连接。
   * 一帧都没有（进程被冻结/回收，或网络已经掉了）：短超时探活两轮，仍没有任何
   * 回帧就判定连接已死，清零退避立刻重建，而不是干等 45 秒静默超时。
   */
  async proveLink() {
    if (this.linkProving) return this.linkProbe
    if (!this.connected) return
    const since = this.lastFrameAt
    this.linkProving = true
    let rounds = 0
    const run = (async () => {
      try {
        for (let round = 0; round < FOREGROUND_PROBE_ROUNDS; round += 1) {
          if (!this.connected) return
          rounds = round + 1
          try {
            await this.request('ping', {}, FOREGROUND_PROBE_TIMEOUT)
            this.lastError = ''
            this.lastProbe = { at: Date.now(), rounds, ok: true }
            return
          } catch {
            // 探活失败可能只是这一帧丢了；只要期间有任一帧进来就算活着。
            if (this.lastFrameAt > since) {
              this.lastProbe = { at: Date.now(), rounds, ok: true, byFrame: true }
              return
            }
          }
        }
        if (!this.connected) return
        this.lastError = t("连接已失效，正在重连…")
        this.lastProbe = { at: Date.now(), rounds, ok: false }
        this.reconnectStaleLink()
      } catch {
        // 复验只是尽力而为，任何意外都不能变成未处理的 Promise 拒绝。
      } finally {
        this.linkProving = false
        // 复验结束后清掉引用，调用方（设置页、后台报告）可以据此判断“探活已结束”。
        if (this.linkProbe === run) this.linkProbe = null
      }
    })()
    this.linkProbe = run
    return run
  }

  /** 判定链路已死：不复用退避等级，立刻重建一次。 */
  reconnectStaleLink() {
    if (this.stopped) return
    this.attempt = 0
    const task = this.task
    if (task) {
      this.dropSocket(task)
      return
    }
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.connect()
  }

  /**
   * 直连地址永远排在前面：同一局域网时不用经过中继，响应更快，也不消耗
   * 公网流量。中继地址排在后面作为回退。
   */
  rebuildCandidates() {
    const pairing = this.pairing
    if (!pairing) return
    const list = []
    const seen = new Set()
    const push = (url, wrapped) => {
      if (!url || typeof url !== 'string' || seen.has(url)) return
      seen.add(url)
      list.push({
        url,
        wrapped: Boolean(wrapped) && Boolean(pairing.room) && Boolean(pairing.roomKey),
        room: pairing.room || '',
        roomKey: pairing.roomKey || '',
        access: pairing.access || ''
      })
    }
    for (const url of pairing.lanUrls || []) push(url, false)
    push(pairing.relayUrl, Boolean(pairing.relayWrapped))
    push(pairing.fallbackUrl, Boolean(pairing.fallbackWrapped))
    this.candidates = list
  }

  chooseCandidate() {
    const list = this.candidates
    if (!list.length) return null
    const preferred = list[this.urlIndex % list.length]
    if (Date.now() >= this.lanRetryAt) return preferred
    // 直连刚失败过：优先回到中继，别再一次次白等直连超时。
    return list.find((item) => isWrapped(item)) || preferred
  }

  noteLanFailure() {
    this.lanRetryAt = Date.now() + LAN_RETRY_MS
  }

  isConnected() {
    return this.connected
  }

  setState(state, extra = {}) {
    this.state = state
    try {
      this.handlers.onState?.({ state, ...extra })
    } catch {
      // ignore
    }
  }

  connect() {
    if (this.stopped || !this.pairing) return
    this.abortUpgrade()
    this.closeSocket()
    this.connected = false
    this.relayReady = false
    this.lastError = ''
    const candidate = this.chooseCandidate() || this.candidates[0]
    if (!candidate) {
      this.lastError = t("配对信息缺少连接地址")
      this.scheduleReconnect()
      return
    }
    this.current = candidate
    const direct = !isWrapped(candidate)
    this.transport = direct ? 'lan' : 'relay'
    this.setState(this.attempt > 0 ? 'reconnecting' : 'connecting', {
      message:
        this.attempt > 0
          ? t("正在重新连接电脑…")
          : direct
            ? t("正在直连电脑…")
            : t("正在连接中继服务器…")
    })

    let task
    try {
      task = uni.connectSocket({
        url: candidate.url,
        complete: () => {}
      })
    } catch (error) {
      this.lastError = error?.message || String(error)
      if (direct) this.noteLanFailure()
      this.scheduleReconnect()
      return
    }
    if (!task) {
      this.lastError = t("无法建立 WebSocket 连接")
      if (direct) this.noteLanFailure()
      this.scheduleReconnect()
      return
    }

    this.task = task
    task.onOpen(() => {
      if (this.task !== task || this.stopped) return
      this.lastFrameAt = Date.now()
      if (isWrapped(candidate)) {
        this.sendRaw(
          {
            type: 'relay.hello',
            role: 'phone',
            room: candidate.room,
            key: candidate.roomKey,
            protocol: 1,
            ...(candidate.access ? { access: candidate.access } : {})
          },
          false
        )
      } else {
        this.sendHello()
      }
    })

    task.onMessage((response) => {
      if (this.task !== task) return
      this.lastFrameAt = Date.now()
      let frame
      try {
        frame = JSON.parse(String(response?.data || ''))
      } catch {
        return
      }
      this.handleFrame(frame)
    })

    task.onError((error) => {
      if (this.task !== task) return
      // 部分 Android 运行时只报 error 不报 close；这里主动收尾，否则要等
      // 心跳静默超时才会发现连接已经不可用。
      this.lastError = error?.errMsg || t("连接电脑失败")
      this.dropSocket(task)
    })

    task.onClose(() => {
      if (this.task !== task) return
      this.lastError = this.lastError || t("连接已断开")
      this.dropSocket(task)
    })

    clearTimeout(this.welcomeTimer)
    this.welcomeTimer = setTimeout(() => {
      if (this.task !== task || this.connected) return
      this.lastError = t("电脑没有响应")
      if (direct) this.noteLanFailure()
      this.closeSocket()
      this.scheduleReconnect()
    }, direct ? LAN_WELCOME_TIMEOUT : WELCOME_TIMEOUT)
  }

  closeSocket() {
    clearTimeout(this.welcomeTimer)
    this.welcomeTimer = null
    const task = this.task
    this.task = null
    this.connected = false
    this.relayReady = false
    this.connectedAt = 0
    this.lastPingAt = 0
    this.stopHeartbeat()
    if (!task) return
    try {
      task.close({})
    } catch {
      // ignore
    }
  }

  /** 当前套接字已被判定不可用：统一收尾并进入重连流程。 */
  dropSocket(task) {
    if (this.task !== task) return
    this.lastCloseAt = Date.now()
    this.lastCloseReason = String(this.lastError || '')
    // 还没收到 welcome 就失败，说明这个直连地址大概率不可达。
    if (!this.connectedAt && this.current && !isWrapped(this.current)) {
      this.noteLanFailure()
    }
    // 后台升级直连后，电脑会主动踢掉旧的中继连接；这不是故障，
    // 交给升级流程决定是接管还是恢复中继。
    const replacing = Boolean(this.upgradeTask) && this.expectReplace
    clearTimeout(this.welcomeTimer)
    this.welcomeTimer = null
    this.task = null
    this.connected = false
    this.relayReady = false
    this.lastPingAt = 0
    this.stopHeartbeat()
    this.rejectPending(t("连接已断开"))
    try {
      task.close({})
    } catch {
      // ignore
    }
    if (this.stopped || replacing) return
    this.setState('disconnected', { message: this.lastError || t("连接已断开") })
    this.scheduleReconnect()
  }

  scheduleReconnect() {
    if (this.stopped) return
    // 稳定连接断开才重置退避；快速反复断线时保留等级，避免弱网里每秒重连。
    if (this.connectedAt && Date.now() - this.connectedAt >= STABLE_CONNECTION_MS) {
      this.attempt = 0
    }
    this.connectedAt = 0
    clearTimeout(this.reconnectTimer)
    const attempt = Math.min(this.attempt, 8)
    const base = Math.min(RECONNECT_MAX_MS, 600 * Math.pow(1.7, attempt))
    const delay = Math.round(base * (0.8 + Math.random() * 0.4))
    this.attempt += 1
    this.urlIndex += 1
    this.setState('reconnecting', {
      message: this.lastError || t("连接已断开，正在重连…")
    })
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  /**
   * 系统网络恢复（例如 Wi-Fi/移动网络切换）：取消退避，立刻重连一次。
   * 由 store 层订阅 uni.onNetworkStatusChange 后调用。
   */
  onNetworkOnline() {
    if (this.stopped) return
    // 换了网络后直连地址可能已经可用（例如从移动网络回到家里的 Wi-Fi）。
    this.lanRetryAt = 0
    if (this.connected) {
      if (isWrapped(this.current)) this.scheduleLanUpgrade(800)
      return
    }
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.attempt = 0
    this.lastError = ''
    // 网络切换时旧套接字往往卡在 CONNECTING，不会自己报错；直接重开一个。
    if (this.task) this.closeSocket()
    this.connect()
  }

  /** 用户手动“重新连接”。 */
  reconnect() {
    this.stopped = false
    this.attempt = 0
    this.lastError = ''
    this.lanRetryAt = 0
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.abortUpgrade()
    this.connect()
  }

  stop() {
    this.stopped = true
    this.linkProving = false
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.abortUpgrade()
    this.closeSocket()
    this.rejectPending(t("连接已关闭"))
    this.setState('idle', {})
  }

  helloFrame() {
    const frame = {
      type: 'hello',
      role: 'phone',
      deviceId: this.pairing.deviceId,
      phoneId: this.pairing.phoneId,
      protocol: 2
    }
    // Legacy fallback: only if the desktop never sealed our token.
    if (this.pairing.legacyToken) frame.token = this.pairing.token
    return frame
  }

  sendHello() {
    this.sendRaw(this.helloFrame(), true)
  }

  handleFrame(frame, options = {}) {
    if (!frame || typeof frame.type !== 'string') return
    this.lastFrameAt = Date.now()
    if (!this.foreground) this.hiddenFrames += 1

    switch (frame.type) {
      case 'relay.ready': {
        if (!this.relayReady) {
          this.relayReady = true
          this.sendHello()
        }
        return
      }
      case 'relay.frame': {
        const inner = frame.data
        if (inner && typeof inner === 'object') this.handleFrame(inner, options)
        return
      }
      case 'hello.challenge': {
        try {
          const proof = tokenProof(this.pairing.token, String(frame.challenge || ''))
          this.sendRaw(
            {
              type: 'hello.proof',
              deviceId: this.pairing.deviceId,
              phoneId: this.pairing.phoneId,
              proof
            },
            true
          )
        } catch {
          this.lastError = t("配对凭证不正确，请重新扫码")
          this.closeSocket()
          this.scheduleReconnect()
        }
        return
      }
      case 'hello.legacy': {
        // 电脑端还没有封存 token 时才会走到这里，只用一次。
        this.pairing.legacyToken = true
        this.sendRaw(
          {
            type: 'hello',
            role: 'phone',
            deviceId: this.pairing.deviceId,
            phoneId: this.pairing.phoneId,
            token: this.pairing.token
          },
          true
        )
        return
      }
      case 'welcome': {
        if (
          frame.deviceId !== this.pairing.deviceId ||
          frame.phoneId !== this.pairing.phoneId
        ) {
          this.lastError = t("电脑返回的身份信息不一致")
          this.closeSocket()
          this.scheduleReconnect()
          return
        }
        clearTimeout(this.welcomeTimer)
        this.welcomeTimer = null
        this.connected = true
        this.connectedAt = Date.now()
        this.pingFailures = 0
        this.lastPingAt = 0
        this.lastError = ''
        this.pairing.legacyToken = false
        this.adoptLanUrls(frame)
        this.promoteCurrent()
        this.startHeartbeat()
        this.touchActive(true)
        if (!this.transport) {
          this.transport = isWrapped(this.current) ? 'relay' : 'lan'
        }
        this.setState('connected', { transport: this.transport })
        if (!options.silent) {
          try {
            this.handlers.onWelcome?.(frame)
          } catch {
            // ignore
          }
        }
        // 当前走中继但电脑在同一条局域网：后台试一次直连，成功就无缝切换。
        if (isWrapped(this.current)) this.scheduleLanUpgrade()
        return
      }
      case 'message':
        this.handleEnvelope(frame.payload)
        return
      case 'relay.error': {
        const message = String(frame.message || '')
        // 中继开了 RELAY_ACCESS_STRICT 但这次连接没带准入码（或码已被销）：
        // 4009 是策略拒绝，不是网络抖动，要给出能照着做的提示。
        this.lastError = /准入码/.test(message)
          ? t("中继器要求准入码，请让电脑端重新生成二维码（电脑端中继地址需带 #k=准入码）")
          : message || t("云端连接器暂时不可用")
        // 用 dropSocket 而不是 closeSocket：保留 connectedAt，稳定连接后
        // 出现的“电脑离线”才不会被误当成弱网反复断线、把退避越积越大。
        this.dropSocket(this.task)
        return
      }
      case 'error':
        this.handleError(frame)
        return
      case 'pair.revoked':
        this.fatal('revoked', String(frame.reason || t("电脑已解除这台手机的配对")))
        return
      case 'pong':
        return
      default:
        return
    }
  }

  promoteCurrent() {
    const current = this.current
    if (!current || !this.pairing) return
    const others = this.candidates.filter((item) => item.url !== current.url)
    // fallback 记录另一条链路：直连成功后回退中继，中继成功后备选直连。
    const fallback = isWrapped(current)
      ? others.find((item) => !isWrapped(item)) || others[0]
      : others.find((item) => isWrapped(item)) || others[0]
    this.pairing.relayUrl = current.url
    this.pairing.relayWrapped = isWrapped(current)
    this.pairing.fallbackUrl = fallback?.url || ''
    this.pairing.fallbackWrapped = fallback ? isWrapped(fallback) : false
    if (isWrapped(current)) {
      this.pairing.lanUrls = (this.pairing.lanUrls || []).filter(
        (url) => url !== current.url
      )
    } else {
      const list = this.pairing.lanUrls || []
      this.pairing.lanUrls = list.includes(current.url)
        ? list
        : [current.url, ...list].slice(0, 8)
    }
    this.rebuildCandidates()
    // 下一次重连仍从直连开始，而不是沿用“上次用的是哪条链路”。
    this.urlIndex = 0
    savePairing(this.pairing)
  }

  /** 电脑端在 welcome 里带上当前局域网地址；DHCP 变化时随之刷新。 */
  adoptLanUrls(frame) {
    if (!Array.isArray(frame?.lan)) return
    const next = []
    for (const url of frame.lan) {
      if (typeof url !== 'string' || !/^wss?:\/\//i.test(url)) continue
      if (!next.includes(url)) next.push(url)
      if (next.length >= 8) break
    }
    const before = (this.pairing.lanUrls || []).join('\n')
    this.pairing.lanUrls = next
    this.rebuildCandidates()
    if (next.join('\n') !== before) savePairing(this.pairing)
  }

  scheduleLanUpgrade(delay = LAN_UPGRADE_DELAY) {
    if (this.stopped) return
    clearTimeout(this.upgradeTimer)
    this.upgradeTimer = setTimeout(() => {
      this.upgradeTimer = null
      this.tryUpgradeToLan()
    }, delay)
  }

  /**
   * 已经通过中继连上时，在后台尝试局域网直连。失败完全不影响现有连接；
   * 成功则静默切换，界面上只表现为连接方式变成“局域网直连”。
   */
  tryUpgradeToLan() {
    if (this.stopped || !this.connected || this.upgradeTask) return
    if (!isWrapped(this.current)) return
    if (!(this.pairing.lanUrls || []).length) return
    const wait = this.lanRetryAt - Date.now()
    if (wait > 0) {
      // 刚失败过：过一会儿再试，期间不打扰中继连接。
      this.scheduleLanUpgrade(Math.min(wait, 30_000))
      return
    }
    // 有请求在等回复时不换连接，避免旧套接字被顶掉导致请求失败。
    if (this.pending.size) {
      this.scheduleLanUpgrade()
      return
    }
    this.startLanUpgrade()
  }

  startLanUpgrade() {
    const url = (this.pairing.lanUrls || []).find(
      (item) => item && item !== this.current?.url
    )
    if (!url) return
    let task
    try {
      task = uni.connectSocket({ url, complete: () => {} })
    } catch {
      this.noteLanFailure()
      return
    }
    if (!task) {
      this.noteLanFailure()
      return
    }
    const upgrade = { task, url, timer: null }
    this.upgradeTask = upgrade
    upgrade.timer = setTimeout(() => {
      if (this.upgradeTask === upgrade) this.finishUpgrade(upgrade, null)
    }, LAN_UPGRADE_TIMEOUT)

    const send = (frame) => {
      try {
        task.send({ data: JSON.stringify(frame) })
      } catch {
        this.finishUpgrade(upgrade, null)
      }
    }

    task.onOpen(() => {
      if (this.upgradeTask !== upgrade) return
      send(this.helloFrame())
    })

    task.onMessage((response) => {
      if (this.upgradeTask === upgrade) {
        let frame
        try {
          frame = JSON.parse(String(response?.data || ''))
        } catch {
          return
        }
        if (!frame || typeof frame.type !== 'string') return
        if (frame.type === 'hello.challenge') {
          try {
            send({
              type: 'hello.proof',
              deviceId: this.pairing.deviceId,
              phoneId: this.pairing.phoneId,
              proof: tokenProof(this.pairing.token, String(frame.challenge || ''))
            })
          } catch {
            this.finishUpgrade(upgrade, null)
          }
          return
        }
        if (frame.type === 'welcome') {
          if (
            frame.deviceId !== this.pairing.deviceId ||
            frame.phoneId !== this.pairing.phoneId
          ) {
            this.finishUpgrade(upgrade, null)
            return
          }
          this.finishUpgrade(upgrade, frame)
          return
        }
        if (frame.type === 'error') this.finishUpgrade(upgrade, null)
        return
      }
      // 升级成功后这条套接字就是正式连接，后续消息要走正常处理。
      if (this.task !== task) return
      this.lastFrameAt = Date.now()
      let frame
      try {
        frame = JSON.parse(String(response?.data || ''))
      } catch {
        return
      }
      this.handleFrame(frame)
    })

    task.onError((error) => {
      if (this.upgradeTask === upgrade) {
        this.finishUpgrade(upgrade, null)
        return
      }
      if (this.task !== task) return
      this.lastError = error?.errMsg || t("连接电脑失败")
      this.dropSocket(task)
    })
    task.onClose(() => {
      if (this.upgradeTask === upgrade) {
        this.finishUpgrade(upgrade, null)
        return
      }
      if (this.task !== task) return
      this.lastError = this.lastError || t("连接已断开")
      this.dropSocket(task)
    })
  }

  finishUpgrade(upgrade, frame) {
    if (this.upgradeTask !== upgrade) return
    clearTimeout(upgrade.timer)
    this.upgradeTask = null
    this.expectReplace = false
    if (!frame) {
      this.noteLanFailure()
      try {
        upgrade.task.close({})
      } catch {
        // ignore
      }
      // 旧连接可能已经被电脑端踢掉；确保中继重连不会被漏掉。
      if (!this.connected && !this.reconnectTimer) this.scheduleReconnect()
      // 中继仍然健康：等冷却结束再试一次，住家 Wi-Fi 恢复后能自动切回直连。
      else if (this.connected && isWrapped(this.current)) {
        this.scheduleLanUpgrade(LAN_RETRY_MS + 500)
      }
      return
    }
    const previous = this.task
    this.task = upgrade.task
    this.current = { url: upgrade.url, wrapped: false, room: '', roomKey: '' }
    this.transport = 'lan'
    this.connected = false
    this.connectedAt = 0
    this.relayReady = false
    this.lastPingAt = 0
    this.pingFailures = 0
    this.stopHeartbeat()
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.attempt = 0
    if (previous && previous !== upgrade.task) {
      try {
        previous.close({})
      } catch {
        // ignore
      }
    }
    // 走同一条 welcome 流程（心跳、promote、保存），但不重复触发 onWelcome
    // 的整页刷新：连接只是换了传输路径。
    this.handleFrame(frame, { silent: true })
  }

  abortUpgrade() {
    clearTimeout(this.upgradeTimer)
    this.upgradeTimer = null
    const upgrade = this.upgradeTask
    this.upgradeTask = null
    this.expectReplace = false
    if (!upgrade) return
    clearTimeout(upgrade.timer)
    try {
      upgrade.task.close({})
    } catch {
      // ignore
    }
  }

  handleError(frame) {
    const message = String(frame?.message || t("中继服务器返回错误")).slice(0, 300)
    const code = frame?.code
    this.lastError = message

    if (code === 'replaced') {
      if (this.upgradeTask) {
        // 直连升级会顶掉旧连接，电脑端先把旧连接标记为 replaced；
        // 这是预期行为，不能当成“配对被抢走”。
        this.expectReplace = true
        this.lastError = ''
        return
      }
      this.fatal('replaced', t("这个配对正在另一处使用"), false)
      return
    }
    if (code === 'auth_failed') {
      this.fatal('auth', message)
      return
    }
    if (code === 'auth_required') {
      // 电脑端重启后虚拟连接会变成未认证；重连一次并重新握手即可恢复，
      // 不需要让用户重新扫码。
      this.lastError = t("连接已失效，正在重新连接")
      this.dropSocket(this.task)
      return
    }
    if (code === 'pair_expired') {
      this.fatal('expired', message || t("已超过 7 天未使用，请在电脑上重新生成配对二维码"))
      return
    }
    this.rejectPending(message)
    try {
      this.handlers.onServerError?.(message, code)
    } catch {
      // ignore
    }
  }

  fatal(kind, message, stop = true) {
    if (stop) this.stopped = true
    this.abortUpgrade()
    this.closeSocket()
    this.rejectPending(message)
    this.setState(kind, { message })
    try {
      this.handlers.onFatal?.(kind, message)
    } catch {
      // ignore
    }
  }

  handleEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object') return
    const seq = envelope.n
    if (!Number.isSafeInteger(seq) || seq <= this.inSeq) return
    let decoded
    try {
      decoded = decryptPayload(this.keys.pcToPhone, envelope)
    } catch {
      return
    }
    this.inSeq = decoded.seq
    this.pairing.inSeq = decoded.seq
    this.touchActive(false)
    const value = decoded.value
    if (!value || typeof value !== 'object') return

    if (value.type === 'response') {
      const pending = this.pending.get(value.id)
      if (!pending) return
      this.pending.delete(value.id)
      clearTimeout(pending.timer)
      if (value.ok) pending.resolve(value.data)
      else pending.reject(new Error(String(value.error || t("操作失败"))))
      return
    }
    if (value.type === 'event') {
      const event = value.data && typeof value.data === 'object' ? value.data : null
      if (event) {
        try {
          this.handlers.onEvent?.(event)
        } catch {
          // ignore
        }
      }
      return
    }
    if (value.type === 'pong') {
      this.lastFrameAt = Date.now()
    }
  }

  /** 记录最近活动时间，供本地 7 天判断；写盘最多每分钟一次。 */
  touchActive(force) {
    const now = Date.now()
    this.pairing.lastActiveAt = now
    if (force || now - this.lastActiveSavedAt > ACTIVE_SAVE_INTERVAL) {
      this.lastActiveSavedAt = now
      savePairing(this.pairing)
    }
  }

  sendRaw(frame, wrap = true) {
    const task = this.task
    if (!task) return false
    const payload =
      wrap && isWrapped(this.current) ? { type: 'relay.frame', data: frame } : frame
    try {
      task.send({
        data: JSON.stringify(payload),
        fail: () => {
          if (this.task !== task) return
          this.lastError = t("连接发送失败")
          this.dropSocket(task)
        }
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * 预留下一个发送序号窗口。写盘的永远是“窗口尽头”，所以即使进程在窗口
   * 中途被杀死，重启后序号也只会跳到更大的值，不会重复使用。
   */
  reserveSeqWindow() {
    if (!this.pairing) return
    const floor = Math.max(this.nextSeq, Number(this.pairing.outSeq) || 0)
    this.pairing.outSeq = floor + SEQ_WINDOW
    savePairing(this.pairing)
  }

  /** 加密发送；序号按窗口预留，正常发送不再逐条写盘。 */
  sendEncrypted(value) {
    const seq = this.nextSeq + 1
    if (!Number.isSafeInteger(seq) || seq < 1) throw new Error(t("消息序号不正确"))
    const envelope = encryptPayload(this.keys.phoneToPc, value, seq)
    this.nextSeq = seq
    this.outSeq = seq
    this.pairing.outSeq = Math.max(Number(this.pairing.outSeq) || 0, seq)
    if (this.nextSeq + 1 >= this.pairing.outSeq) this.reserveSeqWindow()
    this.touchActive(false)
    return this.sendRaw({ type: 'message', payload: envelope }, true)
  }

  request(method, params = {}, timeout = REQUEST_TIMEOUT) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error(t("尚未连接电脑")))
        return
      }
      const id = `p-${++this.requestSeq}-${randomBase64url(4)}`
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(t("电脑响应超时")))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer, method })
      try {
        if (!this.sendEncrypted({ type: 'request', id, method, params })) {
          clearTimeout(timer)
          this.pending.delete(id)
          reject(new Error(t("连接已断开")))
        }
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  rejectPending(message) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      try {
        pending.reject(new Error(message || t("连接已断开")))
      } catch {
        // ignore
      }
      this.pending.delete(id)
    }
  }

  startHeartbeat() {
    this.stopHeartbeat()
    this.lastFrameAt = Date.now()
    this.lastPingAt = 0
    this.lastTickAt = Date.now()
    this.pingTimer = setInterval(() => {
      if (!this.connected) return
      const now = Date.now()
      const drift = this.lastTickAt ? now - this.lastTickAt : 0
      this.lastTickAt = now
      // 定时器被系统冻结后又恢复：墙钟差值不代表链路状态，本轮不做静默判定，
      // 改成短探活复验（每 15 秒一次心跳，漂移超过 2 个周期就不是正常抖动）。
      // 这条路径不依赖 onShow 是否触发，ROM 漏掉生命周期回调时也能自愈。
      if (drift > PING_INTERVAL * 2) {
        void this.proveLink()
        return
      }
      // 前台复验进行中：静默判定交给 proveLink，避免自己先把健康连接拆了。
      if (this.foreground && this.linkProving) return
      if (this.foreground) {
        if (now - this.lastFrameAt > SILENCE_TIMEOUT) {
          this.lastError = t("连接无响应，正在重连")
          this.dropSocket(this.task)
          return
        }
        // 上一次心跳之后一个帧都没收到（中继或电脑已经假在线）。
        if (this.lastPingAt && this.lastFrameAt < this.lastPingAt) {
          this.pingFailures += 1
          if (this.pingFailures >= 2) {
            this.lastError = t("连接无响应，正在重连")
            this.dropSocket(this.task)
            return
          }
        } else {
          this.pingFailures = 0
        }
      }
      // 后台只保活、不做静默判定：定时器被冻结时墙钟会差出几分钟，但
      // 套接字可能一直正常。发送失败仍计两次后收尾，避免卡在死连接上。
      if (!this.sendRaw({ type: 'ping', t: now }, true)) {
        this.pingFailures += 1
        // 单次发送失败可能只是瞬时拥塞；连续两次失败才判定连接已死。
        if (this.pingFailures >= 2) {
          this.lastError = t("连接已断开，正在重连")
          this.dropSocket(this.task)
        }
        return
      }
      // 前台的无响应计数要保留到下一次心跳比较；后台没有静默判定，
      // 发送成功即可清零。
      if (!this.foreground) this.pingFailures = 0
      this.lastPingAt = now
    }, PING_INTERVAL)
  }

  /** 后台期间的链路明细，供设置页诊断显示。 */
  backgroundTrace() {
    return {
      frames: this.hiddenFrames,
      closeAt: this.lastCloseAt,
      closeReason: this.lastCloseReason,
      probe: this.lastProbe
    }
  }

  stopHeartbeat() {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
  }
}

export { REQUEST_TIMEOUT, LONG_TIMEOUT }
