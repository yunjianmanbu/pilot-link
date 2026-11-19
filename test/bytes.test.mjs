/**
 * 字节工具测试：纯 JS 编解码、原生 TextEncoder 快路径，以及无 WebCrypto
 * 时的随机数派生都必须和标准库结果一致。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import { base64url, fromBase64url, randomBytes, utf8Decode, utf8Encode } from '../lib/bytes.js'

const require = createRequire(import.meta.url)
const nodeCrypto = require('node:crypto')

const SAMPLES = [
  '',
  'hello 世界',
  '🧪 emoji 与代理对',
  'a'.repeat(5000),
  '中文'.repeat(2000)
]

test('原生 TextEncoder 路径与 Node Buffer 一致', () => {
  for (const sample of SAMPLES) {
    assert.deepEqual(
      Buffer.from(utf8Encode(sample)),
      Buffer.from(sample, 'utf8'),
      `encode: ${sample.slice(0, 10)}`
    )
    assert.equal(utf8Decode(utf8Encode(sample)), sample)
  }
})

test('无 TextEncoder 的纯 JS 路径与 Node Buffer 一致', async () => {
  const savedEncoder = globalThis.TextEncoder
  const savedDecoder = globalThis.TextDecoder
  try {
    delete globalThis.TextEncoder
    delete globalThis.TextDecoder
    // 重新加载模块，让模块初始化时拿不到 TextEncoder/TextDecoder。
    const pure = await import(`../lib/bytes.js?pure=${Date.now()}`)
    for (const sample of SAMPLES) {
      assert.deepEqual(
        Buffer.from(pure.utf8Encode(sample)),
        Buffer.from(sample, 'utf8'),
        `pure encode: ${sample.slice(0, 10)}`
      )
      assert.equal(pure.utf8Decode(pure.utf8Encode(sample)), sample)
    }
  } finally {
    globalThis.TextEncoder = savedEncoder
    globalThis.TextDecoder = savedDecoder
  }
})

test('base64url 往返并接受标准 base64url 字符集', () => {
  for (const length of [0, 1, 2, 3, 5, 12, 32, 33, 64]) {
    const bytes = nodeCrypto.randomBytes(length)
    const encoded = base64url(bytes)
    assert.equal(encoded, Buffer.from(bytes).toString('base64url'))
    assert.deepEqual(Buffer.from(fromBase64url(encoded)), Buffer.from(bytes))
  }
  assert.throws(() => fromBase64url('a+b/'), /格式不正确/)
})

test('randomBytes 长度正确且每次不同', () => {
  const first = randomBytes(32)
  const second = randomBytes(32)
  assert.equal(first.length, 32)
  assert.equal(second.length, 32)
  assert.notDeepEqual(Buffer.from(first), Buffer.from(second))
  assert.equal(randomBytes(0).length, 0)
})
