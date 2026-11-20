/**
 * Pilot 配对链接解析与配对流程。
 *
 * 配对链接的 #p= 是 base64url 编码的 JSON：
 * { v, r, l, d, k, s, p, n, x, h }，与电脑端 relay.ts buildPairLink 一致。
 *
 * 云端连接器是盲中继：手机必须先发 relay.hello 加入房间，之后的业务帧
 * 用 relay.frame 包裹。两台设备在同一局域网时优先直连 l，省掉中继往返；
 * 直连在短时间内连不上就自动回退到云端。
 */

import { base64url, fromBase64url, utf8Decode } from './bytes.js'
import { decryptPayload } from './e2e.js'
import { derivePairKeys } from './pair-crypto.js'
import { t } from './i18n.js'

const LOOKUP_RE = /^[A-Za-z0-9_-]{22,128}$/
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/
const ROOM_RE = /^[A-Za-z0-9_-]{16,128}$/
const PUBLIC_KEY_RE = /^[A-Za-z0-9_-]{86}$/
// L1 准入码 `id:secret`。id 只用来区分设备，便于单独撑销；真正校验的是 secret。
const ACCESS_CODE_RE = /^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{16,128}$/
const PAIR_TIMEOUT_MS = 90_000
const ATTEMPT_TIMEOUT_MS = 15_000
// 局域网直连失败通常几秒内就有结论，不值得像云端那样等 15 秒。
const LAN_ATTEMPT_TIMEOUT_MS = 4_500

export function normalizeRelayUrl(value) {  let text = String(value || '').trim()
  if (!text) throw new Error(t("缺少中继地址"))
  if (!/^[a-z]+:\/\//i.test(text)) text = `wss://${text}`
  const match = /^(wss?|https?):\/\/([^/?#]+)([^?#]*)/i.exec(text)
  if (!match) throw new Error(t("中继地址格式不正确"))
  let protocol = match[1].toLowerCase()
  if (protocol === 'https') protocol = 'wss'
  if (protocol === 'http') protocol = 'ws'
  if (protocol !== 'ws' && protocol !== 'wss') {
    throw new Error(t("中继地址只支持 ws:// 或 wss://"))
  }
  const host = match[2]
  if (!host) throw new Error(t("中继地址格式不正确"))
  let path = match[3] || ''
  if (!path || path === '/') path = '/ws'
  path = path.replace(/\/+$/, '')
  return `${protocol}://${host}${path}`
}

/**
 * 拆分「中继地址 + 准入码」：用于把安装脚本打印的整条连接串写进日志或调整时复用，
 * 准入码只走 relay.hello，不能拼回 URL 路径。
 */
export function splitRelayUrl(value) {
  const text = String(value || '').trim()
  const url = normalizeRelayUrl(text)
  const marker = text.indexOf('#k=')
  const raw = marker >= 0 ? text.slice(marker + 3).trim() : ''
  return { url, access: ACCESS_CODE_RE.test(raw) ? raw : '' }
}

function cleanText(value, fallback, max = 80) {
  const text = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max)
  return text || fallback
}

export function validatePairingPayload(data) {
  if (!data || typeof data !== 'object') throw new Error(t("配对链接内容不正确"))
  if (data.v !== 1) throw new Error(t("配对链接版本不受支持，请在电脑上升级 Pilot"))
  if (typeof data.r !== 'string' || !data.r.trim()) throw new Error(t("配对链接缺少中继地址"))
  if (typeof data.d !== 'string' || !ID_RE.test(data.d)) throw new Error(t("配对链接缺少电脑标识"))
  if (typeof data.k !== 'string' || !LOOKUP_RE.test(data.k)) throw new Error(t("配对链接缺少配对标识"))
  if (typeof data.s !== 'string' || data.s.length < 20) throw new Error(t("配对链接缺少配对密钥"))
  if (typeof data.p !== 'string' || !PUBLIC_KEY_RE.test(data.p)) {
    throw new Error(t("配对链接中的电脑公钥不正确"))
  }
  const relayUrl = normalizeRelayUrl(data.r)
  const localRelayUrl =
    typeof data.l === 'string' && data.l.trim() ? normalizeRelayUrl(data.l) : ''
  const room = typeof data.x === 'string' && ROOM_RE.test(data.x) ? data.x : ''
  const roomKey = typeof data.h === 'string' && LOOKUP_RE.test(data.h) ? data.h : ''
  // 0.2.3 起电脑端会把准入码放进 a；旧电脑端没有这个字段，此时为空，
  // 中继若没开 STRICT 仍能连上，开了就会拿到 4009 并提示用户。
  const access = typeof data.a === 'string' && ACCESS_CODE_RE.test(data.a) ? data.a : ''
  // 云端房间必须同时带上房间号和房间密钥；局域网直连不依赖它们。
  if (/^wss:\/\//i.test(relayUrl) && (!room || !roomKey)) {
    throw new Error(t("配对链接缺少云端连接信息"))
  }
  return {
    v: 1,
    raw: data,
    relayUrl,
    localRelayUrl,
    room,
    roomKey,
    access,
    deviceId: data.d,
    deviceName: cleanText(data.n, t("未命名电脑"), 80),
    lookup: data.k,
    secret: data.s,
    publicKey: data.p
  }
}

export function decodePairingPayload(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error(t("配对链接缺少配对内容"))
  let json
  try {
    json = utf8Decode(fromBase64url(raw.trim(), t("配对链接")))
  } catch {
    throw new Error(t("配对链接格式不正确"))
  }
  let data
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error(t("配对链接内容无法解析"))
  }
  return validatePairingPayload(data)
}

/** 支持完整链接、#p= 片段或单独的配对载荷。 */
export function pairingPayloadFromText(text) {
  const value = String(text || '').trim()
  if (!value) throw new Error(t("请粘贴配对链接"))
  const marker = value.indexOf('#p=')
  if (marker >= 0) return decodePairingPayload(value.slice(marker + 3))
  if (/^[A-Za-z0-9_-]{40,}$/.test(value)) return decodePairingPayload(value)
  throw new Error(t("这看起来不是有效的配对链接"))
}

/** 云端连接器是否需要对业务帧做 relay.frame 包裹。 */
export function isWrappedCandidate(candidate) {
  return Boolean(candidate && candidate.wrapped && candidate.room && candidate.roomKey)
}

function candidatesFor(payload) {
  const list = []
  const push = (url, wrapped) => {
    if (!url) return
    if (list.some((item) => item.url === url)) return
    list.push({
      url,
      wrapped: Boolean(wrapped),
      room: payload.room,
      roomKey: payload.roomKey,
      access: payload.access || ''
    })
  }
  // 同一局域网时直连最快；连不上再走云端中继。
  push(payload.localRelayUrl, false)
  push(payload.relayUrl, Boolean(payload.room && payload.roomKey))
  return list
}

function sendFrame(task, candidate, frame, handshake = false) {
  const payload =
    !handshake && isWrappedCandidate(candidate)
      ? { type: 'relay.frame', data: frame }
      : frame
  return new Promise((resolve, reject) => {
    task.send({
      data: JSON.stringify(payload),
      success: resolve,
      fail: (error) => reject(new Error(error?.errMsg || t("发送失败")))
    })
  })
}

/**
 * 连接中继并完成一次配对，返回 { token, deviceName, keys, relayUrl, ... }。
 * 成功后连接会主动关闭，由 RelayClient 重新建立正式连接。
 */
export async function joinPairing({ payload, keyPair, phoneId, phoneName, onPending }) {
  const list = candidatesFor(payload)
  if (!list.length) throw new Error(t("配对链接缺少中继地址"))
  return new Promise((resolve, reject) => {
    let settled = false
    let task = null
    let index = -1
    let attemptTimer = null
    let current = null
    let lastError = ''

    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(attemptTimer)
      try {
        task?.close({})
      } catch {
        // ignore
      }
      if (error) reject(error)
      else resolve(result)
    }

    const timer = setTimeout(() => {
      finish(new Error(t("等待电脑确认超时，请在电脑上重新生成二维码")))
    }, PAIR_TIMEOUT_MS)

    const next = (error) => {
      if (settled) return
      if (error) lastError = error.message || String(error)
      clearTimeout(attemptTimer)
      try {
        task?.close({})
      } catch {
        // ignore
      }
      task = null
      index += 1
      if (index >= list.length) {
        finish(new Error(lastError || t("与电脑的连接已断开，请重试")))
        return
      }
      open(list[index])
    }

    const open = (candidate) => {
      current = candidate
      let socket
      try {
        socket = uni.connectSocket({
          url: candidate.url,
          complete: () => {}
        })
      } catch (error) {
        lastError = t("无法连接电脑：{v1}", { v1: error?.message || error })
        next()
        return
      }
      if (!socket) {
        lastError = t("无法建立 WebSocket 连接")
        next()
        return
      }
      task = socket
      let ready = false

      attemptTimer = setTimeout(() => {
        if (task !== socket || settled) return
        lastError = isWrappedCandidate(candidate) ? t("连接电脑超时") : t("局域网连接超时")
        next()
      }, isWrappedCandidate(candidate) ? ATTEMPT_TIMEOUT_MS : LAN_ATTEMPT_TIMEOUT_MS)

      const join = () => {
        if (task !== socket || settled) return
        const platform = (() => {
          try {
            return uni.getSystemInfoSync()?.platform || 'android'
          } catch {
            return 'android'
          }
        })()
        sendFrame(
          socket,
          candidate,
          {
            type: 'pair.join',
            lookup: payload.lookup,
            phoneId,
            name: phoneName,
            phonePub: keyPair.publicBase64,
            platform,
            protocol: 2
          },
          false
        ).catch((error) => next(error))
      }

      socket.onOpen(() => {
        if (task !== socket || settled) return
        if (isWrappedCandidate(candidate)) {
          sendFrame(
            socket,
            candidate,
            {
              type: 'relay.hello',
              role: 'phone',
              room: candidate.room,
              key: candidate.roomKey,
              protocol: 1,
              ...(candidate.access ? { access: candidate.access } : {})
            },
            true
          ).catch((error) => next(error))
        } else {
          join()
        }
      })

      socket.onMessage((response) => {
        if (task !== socket || settled) return
        let frame
        try {
          frame = JSON.parse(String(response?.data || ''))
        } catch {
          return
        }
        if (!frame || typeof frame.type !== 'string') return

        if (frame.type === 'relay.ready') {
          if (!ready) {
            ready = true
            join()
          }
          return
        }
        if (frame.type === 'relay.frame') {
          frame = frame.data
          if (!frame || typeof frame.type !== 'string') return
        }
        if (frame.type === 'relay.error' || frame.type === 'relay.offline') {
          const message = frame.message || ''
          // 中继开了 RELAY_ACCESS_STRICT 但本次连接没带准入码（或码已销）：
          // 4009 是策略拒绝，不是网络问题，直接翻译成能照着做的提示。
          lastError = /准入码/.test(message)
            ? t("中继器要求准入码，请让电脑端重新生成二维码（电脑端中继地址需带 #k=准入码）")
            : message || t("云端连接器暂时不可用")
          next()
          return
        }
        if (frame.type === 'pair.rejected' || frame.type === 'error') {
          finish(
            new Error(
              cleanText(
                frame.reason || frame.message,
                frame.type === 'pair.rejected' ? t("电脑端拒绝了配对") : t("中继服务器返回错误"),
                200
              )
            )
          )
          return
        }
        if (frame.type === 'pair.pending') {
          // The desktop is asking its user to confirm. The socket is up; waiting
          // for a person must not be mistaken for a slow connection.
          clearTimeout(attemptTimer)
          if (typeof onPending === 'function') onPending()
          return
        }
        if (frame.type !== 'pair.accepted' || settled) return

        clearTimeout(attemptTimer)
        try {
          const keys = derivePairKeys(keyPair.privateKey, payload.publicKey, payload.secret)
          const decoded = decryptPayload(keys.pcToPhone, frame.payload)
          if (decoded.seq !== 1) throw new Error(t("配对确认序号不正确"))
          const value = decoded.value
          if (!value || typeof value !== 'object' || value.type !== 'pair.accept') {
            throw new Error(t("电脑返回的配对确认不正确"))
          }
          if (value.deviceId !== payload.deviceId) {
            throw new Error(t("电脑身份与配对链接不一致，已取消配对"))
          }
          const token = typeof value.token === 'string' ? value.token : frame.token
          if (typeof token !== 'string' || token.length < 20) {
            throw new Error(t("中继没有返回手机凭证"))
          }
          const fallbackCandidate = list.find((item) => item.url !== candidate.url) || null
          const candidateIndex = list.indexOf(candidate)
          finish(null, {
            token,
            deviceName: cleanText(value.deviceName, payload.deviceName, 80),
            keys,
            relayUrl: candidate.url,
            relayWrapped: isWrappedCandidate(candidate),
            fallbackUrl: fallbackCandidate?.url || '',
            fallbackWrapped: fallbackCandidate
              ? isWrappedCandidate(fallbackCandidate)
              : false,
            room: payload.room,
            roomKey: payload.roomKey,
            // 只带上配对时还没被证伪的直连地址：如果直连刚刚超时，
            // 正式连接就别再白等一次，改由 welcome 广播新地址。
            lanUrls: list
              .filter(
                (item, index) => !isWrappedCandidate(item) && index >= candidateIndex
              )
              .map((item) => item.url)
          })
        } catch (error) {
          finish(error)
        }
      })

      socket.onError((error) => {
        if (task !== socket || settled) return
        lastError = error?.errMsg || t("连接电脑失败")
      })

      socket.onClose(() => {
        if (task !== socket || settled) return
        lastError = lastError || t("与电脑的连接已断开，请重试")
        next()
      })
    }

    next()
  })
}

export { base64url }
