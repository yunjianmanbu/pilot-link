/**
 * 配对阶段的 P-256 / HKDF 代码。
 *
 * 与 lib/e2e.js（收发消息用的 AES-GCM）分开，便于单独测试配对密钥派生，
 * 也让配对协议的代码更集中。
 */

import { p256 } from '@noble/curves/p256'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { base64url, fromBase64url, randomBytes, utf8Encode } from './bytes.js'
import { t } from './i18n.js'

const INFO_PC_TO_PHONE = 'pilot-link-e2e-v1:pc-to-phone'
const INFO_PHONE_TO_PC = 'pilot-link-e2e-v1:phone-to-pc'
const KEY_BYTES = 32
const PUBLIC_KEY_BYTES = 64

function prefixPublicKey(raw) {
  if (raw.length !== PUBLIC_KEY_BYTES) throw new Error(t("公钥长度不正确"))
  const point = new Uint8Array(65)
  point[0] = 4
  point.set(raw, 1)
  return point
}

export function createKeyPair() {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const privateKey = randomBytes(32)
    try {
      const publicKey = p256.getPublicKey(privateKey, false)
      if (publicKey.length !== 65) continue
      return {
        privateKey,
        publicBase64: base64url(publicKey.subarray(1))
      }
    } catch {
      // 随机数不满足曲线要求时重试。
    }
  }
  throw new Error(t("无法生成手机密钥"))
}

export function derivePairKeys(privateKey, peerPublicBase64, pairSecretBase64) {
  const peer = fromBase64url(peerPublicBase64, t("公钥"))
  const peerPoint = prefixPublicKey(peer)
  const secret = fromBase64url(pairSecretBase64, t("配对密钥"))
  if (secret.length < 16) throw new Error(t("配对密钥过短"))
  // getSharedSecret 返回压缩点（33 字节），去掉前缀就是 ECDH 共享密钥的 X 坐标，
  // 与 Node crypto.diffieHellman / WebCrypto deriveBits(256) 的 32 字节输出一致。
  const shared = p256.getSharedSecret(privateKey, peerPoint, true).subarray(1)
  if (shared.length !== KEY_BYTES) throw new Error(t("共享密钥长度不正确"))
  return {
    pcToPhone: Uint8Array.from(hkdf(sha256, shared, secret, utf8Encode(INFO_PC_TO_PHONE), KEY_BYTES)),
    phoneToPc: Uint8Array.from(hkdf(sha256, shared, secret, utf8Encode(INFO_PHONE_TO_PC), KEY_BYTES))
  }
}

export function exportKey(key) {
  if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) throw new Error(t("加密密钥不正确"))
  return base64url(key)
}

export { INFO_PC_TO_PHONE, INFO_PHONE_TO_PC, KEY_BYTES }
