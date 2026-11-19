import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SPLASH_GUARD_MS,
  SPLASH_RETRY_DELAYS,
  closeSplash,
  installSplashGuard,
  resolveSplashDelay,
  scheduleSplashClose
} from '../lib/splash.js'

function fakePlus({ throws = false } = {}) {
  const calls = { close: 0 }
  return {
    plus: {
      navigator: {
        closeSplashscreen() {
          calls.close += 1
          if (throws) throw new Error('not supported')
        }
      }
    },
    calls
  }
}

test('有 plus 时调用一次原生关闭接口', () => {
  const { plus, calls } = fakePlus()
  assert.equal(closeSplash(plus), true)
  assert.equal(calls.close, 1)
})

test('没有 plus 时返回 false 且不抛错', () => {
  assert.equal(closeSplash(null), false)
  assert.doesNotThrow(() => closeSplash(undefined))
})

test('plus 缺少 navigator 或接口时返回 false', () => {
  assert.equal(closeSplash({}), false)
  assert.equal(closeSplash({ navigator: {} }), false)
  assert.equal(closeSplash({ navigator: { closeSplashscreen: 'nope' } }), false)
})

test('ROM 拒绝关闭启动图时静默忽略', () => {
  const { plus } = fakePlus({ throws: true })
  assert.doesNotThrow(() => closeSplash(plus))
  assert.equal(closeSplash(plus), false)
})

test('延时归一：非法值回落到默认，合法值原样保留', () => {
  assert.equal(resolveSplashDelay(), SPLASH_GUARD_MS)
  assert.equal(resolveSplashDelay(''), SPLASH_GUARD_MS)
  assert.equal(resolveSplashDelay('abc'), SPLASH_GUARD_MS)
  assert.equal(resolveSplashDelay(-1), SPLASH_GUARD_MS)
  assert.equal(resolveSplashDelay(0), 0)
  assert.equal(resolveSplashDelay(1200), 1200)
  assert.equal(resolveSplashDelay(undefined, 300), 300)
})

test('延时可注入定时器，到期后关闭启动图', () => {
  const { plus, calls } = fakePlus()
  const scheduled = []
  const timer = scheduleSplashClose(plus, {
    delay: 0,
    setTimeout: (fn, ms) => {
      scheduled.push(ms)
      fn()
      return 'timer-1'
    }
  })
  assert.equal(timer, 'timer-1')
  assert.deepEqual(scheduled, [0])
  assert.equal(calls.close, 1)
})

test('延时不合法时按默认 800ms 调度', () => {
  const { plus } = fakePlus()
  const scheduled = []
  scheduleSplashClose(plus, {
    delay: 'oops',
    setTimeout: (fn, ms) => {
      scheduled.push(ms)
      return null
    }
  })
  assert.deepEqual(scheduled, [SPLASH_GUARD_MS])
})

test('没有定时器接口时安全返回 null', () => {
  const previous = globalThis.setTimeout
  try {
    // 显式传 null 让函数走「没有可用定时器」的分支。
    globalThis.setTimeout = undefined
    assert.equal(scheduleSplashClose(null, { setTimeout: null }), null)
  } finally {
    globalThis.setTimeout = previous
  }
})

test('多时段兜底：每个时间点到期都关一次启动图', () => {
  const { plus, calls } = fakePlus()
  const pending = []
  const scheduled = []
  installSplashGuard({
    plus,
    setTimeout: (fn, ms) => {
      scheduled.push(ms)
      pending.push(fn)
      return { ms }
    }
  })
  assert.deepEqual(scheduled, SPLASH_RETRY_DELAYS)
  assert.equal(calls.close, 0)
  // 模拟前两个兜底时间点到达（冷启动慢，关闭接口被忽略了一次）。
  pending[0]()
  pending[1]()
  assert.equal(calls.close, 2)
})

test('兜底可取消：清理后不再调用关闭接口', () => {
  const { plus, calls } = fakePlus()
  const pending = []
  const cleared = []
  const cancel = installSplashGuard({
    plus,
    delays: [100, 200],
    setTimeout: (fn, ms) => {
      pending.push(fn)
      return `t-${ms}`
    },
    clearTimeout: (timer) => cleared.push(timer)
  })
  cancel()
  assert.deepEqual(cleared, ['t-100', 't-200'])
  pending.forEach((fn) => fn())
  assert.equal(calls.close, 0)
})

test('没有定时器时兜底返回空操作函数', () => {
  const previous = globalThis.setTimeout
  try {
    globalThis.setTimeout = undefined
    const cancel = installSplashGuard({ setTimeout: null })
    assert.equal(typeof cancel, 'function')
    assert.doesNotThrow(() => cancel())
  } finally {
    globalThis.setTimeout = previous
  }
})
