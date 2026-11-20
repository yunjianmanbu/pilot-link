/**
 * 手机端（纯 JS noble）与电脑端（Node crypto）端到端加密的字节级兼容测试。
 *
 * 电脑端实现直接复刻 pilot/pilot/src/main/companion/crypto.ts 的算法：
 * ECDH P-256 + HKDF-SHA256 + AES-256-GCM，AAD 为十进制序号。
 * 两端必须派生出一模一样的密钥、能互相解密，并且拒绝被篡改的密文。
 */

import './locale-zh.mjs'

import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import { encryptPayload as phoneEncrypt, decryptPayload as phoneDecrypt } from '../lib/e2e.js'
import {
  createKeyPair as createPhoneKeyPair,
  derivePairKeys as derivePhoneKeys
} from '../lib/pair-crypto.js'
import { base64url } from '../lib/bytes.js'

const require = createRequire(import.meta.url)
const nodeCrypto = require('node:crypto')

const INFO_PC_TO_PHONE = 'pilot-link-e2e-v1:pc-to-phone'
const INFO_PHONE_TO_PC = 'pilot-link-e2e-v1:phone-to-pc'
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16

const desktop = {
  base64url(buffer) {
    return Buffer.from(buffer).toString('base64url')
  },
  createKeyPair() {
    const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1'
    })
    const jwk = publicKey.export({ format: 'jwk' })
    const publicBase64 = desktop.base64url(
      Buffer.concat([
        Buffer.from(jwk.x, 'base64url'),
        Buffer.from(jwk.y, 'base64url')
      ])
    )
    return { privateKey, publicKey, publicBase64 }
  },
  randomSecret(bytes = 16) {
    return desktop.base64url(nodeCrypto.randomBytes(bytes))
  },
  derivePairKeys(privateKey, peerPublicBase64, pairSecretBase64) {
    const raw = Buffer.from(peerPublicBase64, 'base64url')
    const peerPublicKey = nodeCrypto.createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: desktop.base64url(raw.subarray(0, 32)),
        y: desktop.base64url(raw.subarray(32, 64))
      },
      format: 'jwk'
    })
    const secret = Buffer.from(pairSecretBase64, 'base64url')
    const shared = nodeCrypto.diffieHellman({ privateKey, publicKey: peerPublicKey })
    const derive = (info) =>
      Buffer.from(
        nodeCrypto.hkdfSync('sha256', shared, secret, Buffer.from(info, 'utf8'), KEY_BYTES)
      )
    return {
      pcToPhone: derive(INFO_PC_TO_PHONE),
      phoneToPc: derive(INFO_PHONE_TO_PC)
    }
  },
  encryptPayload(key, value, seq) {
    const iv = nodeCrypto.randomBytes(IV_BYTES)
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv, {
      authTagLength: TAG_BYTES
    })
    cipher.setAAD(Buffer.from(String(seq), 'utf8'))
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(JSON.stringify(value), 'utf8')),
      cipher.final()
    ])
    return {
      n: seq,
      iv: desktop.base64url(iv),
      data: desktop.base64url(Buffer.concat([ciphertext, cipher.getAuthTag()]))
    }
  },
  decryptPayload(key, envelope) {
    const decipher = nodeCrypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.iv, 'base64url'),
      { authTagLength: TAG_BYTES }
    )
    decipher.setAAD(Buffer.from(String(envelope.n), 'utf8'))
    const packed = Buffer.from(envelope.data, 'base64url')
    decipher.setAuthTag(packed.subarray(packed.length - TAG_BYTES))
    try {
      const plaintext = Buffer.concat([
        decipher.update(packed.subarray(0, packed.length - TAG_BYTES)),
        decipher.final()
      ])
      return { seq: envelope.n, value: JSON.parse(plaintext.toString('utf8')) }
    } catch {
      throw new Error('消息解密失败')
    }
  }
}

function asUint8(value) {
  return new Uint8Array(value)
}

function makePair() {
  const phone = createPhoneKeyPair()
  const pc = desktop.createKeyPair()
  const secret = desktop.randomSecret(24)
  const phoneKeys = derivePhoneKeys(phone.privateKey, pc.publicBase64, secret)
  const pcKeys = desktop.derivePairKeys(pc.privateKey, phone.publicBase64, secret)
  return { phone, pc, secret, phoneKeys, pcKeys }
}

test('base64url 编码与 Node 完全一致', () => {
  for (const length of [0, 1, 2, 3, 4, 5, 31, 32, 33, 64, 65]) {
    const bytes = nodeCrypto.randomBytes(length)
    assert.equal(base64url(bytes), Buffer.from(bytes).toString('base64url'))
  }
})

test('手机端与电脑端派生出相同的双向密钥', () => {
  const { phone, pcKeys, phoneKeys } = makePair()
  assert.equal(phone.publicBase64.length, 86)
  assert.match(phone.publicBase64, /^[A-Za-z0-9_-]{86}$/)
  assert.deepEqual(phoneKeys.pcToPhone, asUint8(pcKeys.pcToPhone))
  assert.deepEqual(phoneKeys.phoneToPc, asUint8(pcKeys.phoneToPc))
  assert.notDeepEqual(phoneKeys.pcToPhone, phoneKeys.phoneToPc)
})

test('电脑端加密 → 手机端解密', () => {
  const { phoneKeys, pcKeys } = makePair()
  const value = {
    type: 'pair.accept',
    lookup: 'abc',
    note: '中文与 emoji 👋 都要一致',
    nested: { list: [1, 2, 3], ok: true }
  }
  const envelope = desktop.encryptPayload(pcKeys.pcToPhone, value, 1)
  const opened = phoneDecrypt(phoneKeys.pcToPhone, envelope)
  assert.equal(opened.seq, 1)
  assert.deepEqual(opened.value, value)
})

test('手机端加密 → 电脑端解密', () => {
  const { phoneKeys, pcKeys } = makePair()
  const value = { type: 'request', method: 'sessions.list', params: {}, id: 'p-1' }
  const envelope = phoneEncrypt(phoneKeys.phoneToPc, value, 7)
  assert.match(envelope.iv, /^[A-Za-z0-9_-]{16}$/)
  const opened = desktop.decryptPayload(pcKeys.phoneToPc, envelope)
  assert.equal(opened.seq, 7)
  assert.deepEqual(opened.value, value)
})

test('双向密钥不能混用', () => {
  const { phoneKeys, pcKeys } = makePair()
  const value = { hello: 'world' }
  const envelope = desktop.encryptPayload(pcKeys.pcToPhone, value, 1)
  assert.throws(() => phoneDecrypt(phoneKeys.phoneToPc, envelope), /消息解密失败/)
  const reply = phoneEncrypt(phoneKeys.phoneToPc, value, 1)
  assert.throws(() => desktop.decryptPayload(pcKeys.pcToPhone, reply), /消息解密失败/)
})

test('篡改密文或序号都会解密失败', () => {
  const { phoneKeys, pcKeys } = makePair()
  const envelope = desktop.encryptPayload(pcKeys.pcToPhone, { secret: 'payload' }, 3)
  assert.doesNotThrow(() => phoneDecrypt(phoneKeys.pcToPhone, envelope))

  const tampered = {
    ...envelope,
    data: (envelope.data[0] === 'A' ? 'B' : 'A') + envelope.data.slice(1)
  }
  assert.throws(() => phoneDecrypt(phoneKeys.pcToPhone, tampered), /消息解密失败/)

  const wrongSeq = { ...envelope, n: envelope.n + 1 }
  assert.throws(() => phoneDecrypt(phoneKeys.pcToPhone, wrongSeq), /消息解密失败/)
})
