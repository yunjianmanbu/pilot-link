import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { keepLinkAlive, releaseLinkKeepAlive } from '../lib/background-link.js'

function fakePlus({ platform = 'Android', withManager = true, failAcquire = false } = {}) {
  const calls = {
    acquired: 0,
    released: 0,
    referenceCounted: null,
    flags: null,
    tag: '',
    service: ''
  }
  const lock = {
    setReferenceCounted(value) {
      calls.referenceCounted = value
    },
    acquire() {
      if (failAcquire) throw new Error('not allowed')
      calls.acquired += 1
    },
    release() {
      calls.released += 1
    }
  }
  const manager = {
    newWakeLock(flags, tag) {
      calls.flags = flags
      calls.tag = tag
      return lock
    }
  }
  const main = {
    getSystemService(name) {
      calls.service = name
      return withManager ? manager : null
    }
  }
  const plus = {
    os: { name: platform },
    android: {
      runtimeMainActivity: () => main,
      importClass: () => ({}),
      invoke: (target, method, ...args) => target[method](...args)
    }
  }
  return { plus, calls }
}

afterEach(() => {
  releaseLinkKeepAlive()
})

test('Android 退到后台申请 CPU 唤醒锁，重复调用只申请一次', () => {
  const { plus, calls } = fakePlus()

  assert.equal(keepLinkAlive(plus), true)
  assert.equal(keepLinkAlive(plus), true)
  assert.equal(calls.acquired, 1)
  assert.equal(calls.flags, 1)
  assert.equal(calls.tag, 'Pilot:connection')
  assert.equal(calls.referenceCounted, false)
  assert.equal(calls.service, 'power')

  assert.equal(releaseLinkKeepAlive(), true)
  assert.equal(calls.released, 1)
  assert.equal(releaseLinkKeepAlive(), false)
})

test('非 Android 环境不做任何改动', () => {
  const { plus, calls } = fakePlus({ platform: 'iOS' })
  assert.equal(keepLinkAlive(plus), false)
  assert.equal(calls.acquired, 0)
})

test('系统服务不可用或申请失败时静默跳过', () => {
  const missing = fakePlus({ withManager: false })
  assert.equal(keepLinkAlive(missing.plus), false)
  assert.equal(missing.calls.acquired, 0)

  const failing = fakePlus({ failAcquire: true })
  assert.equal(keepLinkAlive(failing.plus), false)
  assert.equal(releaseLinkKeepAlive(), false)
})

test('没有 plus 时静默跳过', () => {
  assert.doesNotThrow(() => keepLinkAlive(null))
  assert.equal(releaseLinkKeepAlive(), false)
})
