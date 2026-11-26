/**
 * 抬手后合成 click 的防穿透窗口。
 *
 * 这条路径在真机上表现为「点了没反应」：入口在 touchend 阶段同步改了这一屏，
 * 紧随其后的 click 落到新内容上，把刚打开的东西又关掉。窗口开错（不开、开太长、
 * 永不过期）分别对应「旧故障复现」「返回/点行前 1 秒失灵」「整个页面再也点不动」，
 * 所以三条都要钉住。
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const { armTapGuard, resetTapGuard, tapGuarded } = await import('../lib/tap-guard.js')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('默认不开窗口，抬手余波之外的点击都要正常生效', () => {
  resetTapGuard()
  assert.equal(tapGuarded(), false)
})

test('arm 之后窗口内的点击被吞掉，窗口过了就恢复', async () => {
  resetTapGuard()
  armTapGuard(60)
  assert.equal(tapGuarded(), true)
  await wait(90)
  assert.equal(tapGuarded(), false)
})

test('重复 arm 取更晚的一个，不会被先到期的窗口提前放开', () => {
  resetTapGuard()
  armTapGuard(400)
  armTapGuard(10)
  // 第二次的 10ms 不该把 400ms 的窗口缩掉。
  assert.equal(tapGuarded(), true)
  resetTapGuard()
})

test('非法时长不 arm：不能因为一次参数写错让整个页面点不动', () => {
  resetTapGuard()
  // 不传参（undefined）走默认窗口，这是正常用法；其余非法值一律不开窗口。
  for (const bad of [null, 0, -5, NaN, 'abc', Infinity]) {
    armTapGuard(bad)
    assert.equal(tapGuarded(), false, `armTapGuard(${String(bad)}) 不该开窗口`)
  }
  armTapGuard()
  assert.equal(tapGuarded(), true, '不传参时应使用默认窗口')
  resetTapGuard()
})

test('窗口只覆盖抬手那一小段，不会长到影响正常操作', () => {
  const source = fs.readFileSync(new URL('../lib/tap-guard.js', import.meta.url), 'utf8')
  const match = /const DEFAULT_GUARD_MS = (\d+)/.exec(source)
  assert.ok(match, '缺 DEFAULT_GUARD_MS')
  const span = Number(match[1])
  assert.ok(span > 0 && span <= 800, `默认窗口 ${span}ms 超出可接受范围`)
})
