/**
 * 手机端端到端加密（消息收发部分）。
 *
 * 与电脑端 pilot/client/src/main/companion/crypto.ts 保持字节级兼容：
 * ECDH(P-256) -> HKDF-SHA256(salt=配对密钥, 双向独立 info) -> AES-256-GCM。
 * 这里只保留 AES-GCM 与密钥导入；P-256 配对逻辑在 pair-crypto.js 里按需加载，
 * 避免每次启动都初始化曲线运算。
 */

import { gcm } from '@noble/ciphers/aes'
import { hmac } from '@noble/hashes/hmac'
import { sha256 } from '@noble/hashes/sha256'
import { base64url, fromBase64url, randomBytes, utf8Decode, utf8Encode } from './bytes.js'
import { t } from './i18n.js'

const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const MAX_ENVELOPE_BYTES = 5 * 1024 * 1024

export function importKey(value) {
  const raw = fromBase64url(value, t("加密密钥"))
  if (raw.length !== KEY_BYTES) throw new Error(t("加密密钥不正确"))
  return raw
}

export function encryptPayload(key, value, seq) {
  if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) throw new Error(t("加密密钥不正确"))
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error(t("消息序号不正确"))
  const iv = randomBytes(IV_BYTES)
  const plaintext = utf8Encode(JSON.stringify(value))
  const packed = gcm(key, iv, utf8Encode(String(seq))).encrypt(plaintext)
  return {
    n: seq,
    iv: base64url(iv),
    data: base64url(packed)
  }
}

/** Challenge-response proof so the cloud relay never sees the pairing token. */
export function tokenProof(token, challenge) {
  if (typeof token !== 'string' || !token) throw new Error(t("配对凭证不正确"))
  return base64url(hmac(sha256, utf8Encode(token), utf8Encode(String(challenge))))
}

export function decryptPayload(key, envelope) {
  if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) throw new Error(t("加密密钥不正确"))
  if (!envelope || typeof envelope !== 'object') throw new Error(t("加密消息格式不正确"))
  const seq = envelope.n
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error(t("消息序号不正确"))
  const iv = fromBase64url(envelope.iv, 'IV')
  if (iv.length !== IV_BYTES) throw new Error(t("IV 长度不正确"))
  const packed = fromBase64url(envelope.data, t("密文"))
  if (packed.length <= TAG_BYTES || packed.length > MAX_ENVELOPE_BYTES) {
    throw new Error(t("密文长度不正确"))
  }
  let plaintext
  try {
    plaintext = gcm(key, iv, utf8Encode(String(seq))).decrypt(packed)
  } catch {
    throw new Error(t("消息解密失败"))
  }
  return { seq, value: JSON.parse(utf8Decode(plaintext)) }
}

export { KEY_BYTES, IV_BYTES, TAG_BYTES }
