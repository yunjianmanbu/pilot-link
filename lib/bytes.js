/**
 * 字节、编码与随机数工具。
 *
 * App 端（Android / iOS 的 JSCore、V8）没有浏览器里的 btoa / atob /
 * TextEncoder，也不保证有 WebCrypto，因此这里全部用纯 JS 实现。
 * 随机数优先使用 WebCrypto，其次使用 App 运行时的原生 UUID
 * （Android 的 java.util.UUID、iOS 的 NSUUID 都是安全随机源），
 * 最后才退回到时间 + Math.random 的混合熵（仅用于老旧 H5 调试）。
 */

import { sha256 } from '@noble/hashes/sha256'
import { t } from './i18n.js'

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const B64_LOOKUP = (() => {
  const table = new Int16Array(256).fill(-1)
  for (let index = 0; index < B64_ALPHABET.length; index += 1) {
    table[B64_ALPHABET.charCodeAt(index)] = index
  }
  return table
})()

export function base64url(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let output = ''
  let index = 0
  for (; index + 2 < source.length; index += 3) {
    const value = (source[index] << 16) | (source[index + 1] << 8) | source[index + 2]
    output +=
      B64_ALPHABET[(value >>> 18) & 63] +
      B64_ALPHABET[(value >>> 12) & 63] +
      B64_ALPHABET[(value >>> 6) & 63] +
      B64_ALPHABET[value & 63]
  }
  if (index < source.length) {
    const first = source[index]
    const second = index + 1 < source.length ? source[index + 1] : 0
    const value = (first << 16) | (second << 8)
    output += B64_ALPHABET[(value >>> 18) & 63] + B64_ALPHABET[(value >>> 12) & 63]
    if (index + 1 < source.length) output += B64_ALPHABET[(value >>> 6) & 63]
  }
  return output
}

export function fromBase64url(value, label = t("参数")) {
  if (typeof value !== 'string') throw new Error(t("{v1}格式不正确", { v1: label }))
  const text = value.replace(/=+$/, '')
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error(t("{v1}格式不正确", { v1: label }))
  const bytes = new Uint8Array(Math.floor((text.length * 6) / 8))
  let buffer = 0
  let bits = 0
  let offset = 0
  for (let index = 0; index < text.length; index += 1) {
    const code = B64_LOOKUP[text.charCodeAt(index)]
    if (code < 0) throw new Error(t("{v1}格式不正确", { v1: label }))
    buffer = ((buffer << 6) | code) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[offset] = (buffer >>> bits) & 0xff
      offset += 1
    }
  }
  return bytes
}

// 部分运行时（较新的 Android 引擎、H5）自带 TextEncoder / TextDecoder，
// 大段文本走原生实现比逐字符循环快一个数量级；没有时仍用下面的纯 JS 版本。
const nativeTextEncoder = (() => {
  try {
    return typeof TextEncoder !== 'undefined' ? new TextEncoder() : null
  } catch {
    return null
  }
})()

const nativeTextDecoder = (() => {
  try {
    return typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null
  } catch {
    return null
  }
})()

/** 把 JS 字符串按 UTF-8 编码，正确处理代理对。 */
export function utf8Encode(text) {
  const value = String(text == null ? '' : text)
  if (nativeTextEncoder) return nativeTextEncoder.encode(value)
  const output = []
  for (let index = 0; index < value.length; index += 1) {
    let code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
        index += 1
      } else {
        code = 0xfffd
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd
    }
    if (code < 0x80) {
      output.push(code)
    } else if (code < 0x800) {
      output.push(0xc0 | (code >>> 6), 0x80 | (code & 63))
    } else if (code < 0x10000) {
      output.push(0xe0 | (code >>> 12), 0x80 | ((code >>> 6) & 63), 0x80 | (code & 63))
    } else {
      output.push(
        0xf0 | (code >>> 18),
        0x80 | ((code >>> 12) & 63),
        0x80 | ((code >>> 6) & 63),
        0x80 | (code & 63)
      )
    }
  }
  return Uint8Array.from(output)
}

/** UTF-8 解码，遇到非法字节用 U+FFFD 代替。 */
export function utf8Decode(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (nativeTextDecoder) return nativeTextDecoder.decode(source)
  let output = ''
  let index = 0
  while (index < source.length) {
    const first = source[index]
    let code = 0xfffd
    let size = 1
    if (first < 0x80) {
      code = first
    } else if (first >= 0xc2 && first <= 0xdf && index + 1 < source.length) {
      code = ((first & 0x1f) << 6) | (source[index + 1] & 63)
      size = 2
    } else if (first >= 0xe0 && first <= 0xef && index + 2 < source.length) {
      code = ((first & 0x0f) << 12) | ((source[index + 1] & 63) << 6) | (source[index + 2] & 63)
      size = 3
    } else if (first >= 0xf0 && first <= 0xf4 && index + 3 < source.length) {
      code =
        ((first & 0x07) << 18) |
        ((source[index + 1] & 63) << 12) |
        ((source[index + 2] & 63) << 6) |
        (source[index + 3] & 63)
      size = 4
    }
    if (code > 0xffff) {
      code -= 0x10000
      output += String.fromCharCode(0xd800 + (code >>> 10), 0xdc00 + (code & 0x3ff))
    } else {
      output += String.fromCharCode(code)
    }
    index += size
  }
  return output
}

export function concatBytes(...parts) {
  let length = 0
  for (const part of parts) length += part.length
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function webCrypto() {
  try {
    const value = typeof globalThis !== 'undefined' ? globalThis : null
    if (value && value.crypto && typeof value.crypto.getRandomValues === 'function') {
      return value.crypto
    }
  } catch {
    // ignore
  }
  return null
}

/** App 运行时的原生安全随机源：用多个 UUID 拼出足够的熵。 */
function platformEntropy() {
  const parts = []
  try {
    if (typeof plus === 'undefined') return ''
    if (plus.android) {
      const UUID = plus.android.importClass('java.util.UUID')
      for (let index = 0; index < 4; index += 1) parts.push(String(UUID.randomUUID()))
    } else if (plus.ios) {
      const NSUUID = plus.ios.importClass('NSUUID')
      for (let index = 0; index < 4; index += 1) {
        const uuid = NSUUID.UUID()
        parts.push(String(uuid.UUIDString()))
        try {
          plus.ios.deleteObject(uuid)
        } catch {
          // ignore
        }
      }
    }
  } catch {
    return ''
  }
  return parts.join(':')
}

function fallbackEntropy() {
  let text = `${Date.now()}:`
  try {
    text += `${performance.now()}:`
  } catch {
    // ignore
  }
  for (let index = 0; index < 16; index += 1) {
    text += `${Math.random().toString(36).slice(2)}:${Math.random().toString(36).slice(2)}:`
  }
  return text
}

// 没有 WebCrypto 时，App 运行时的安全熵来自原生 UUID。每次生成随机数都走
// 一次 plus.android / plus.ios 桥接很慢（发消息时每条都要生成 IV），所以只在
// 第一次取熵，之后用 SHA-256 计数器派生，既能保持不可预测，也不再调用原生桥。
let entropySeed = null
let entropyCounter = 0

function nextEntropyBlock() {
  if (!entropySeed) {
    const seed = platformEntropy() || fallbackEntropy()
    entropySeed = sha256(utf8Encode(seed))
  }
  const block = sha256(concatBytes(entropySeed, utf8Encode(`:${entropyCounter}`)))
  entropyCounter += 1
  return block
}

export function randomBytes(length) {
  const size = Math.max(0, Math.floor(Number(length) || 0))
  const bytes = new Uint8Array(size)
  if (size === 0) return bytes

  const cryptoBox = webCrypto()
  if (cryptoBox) {
    cryptoBox.getRandomValues(bytes)
    return bytes
  }

  let offset = 0
  while (offset < size) {
    const block = nextEntropyBlock()
    bytes.set(block.subarray(0, Math.min(block.length, size - offset)), offset)
    offset += block.length
  }
  return bytes
}

export function randomBase64url(length = 16) {
  return base64url(randomBytes(length))
}
