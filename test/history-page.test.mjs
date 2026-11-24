import test from 'node:test'
import assert from 'node:assert/strict'

import { EARLIER_MAX_ROUNDS, earlierContinue } from '../lib/history-page.js'

// 一次「加载更早」= 一页正文。旧版电脑端会忽略 conversation 参数、仍按原始消息
// 返回一页，此时这一页过滤后可能一条正文都没有，必须在同一次点击里继续补页。

test('一页里拿到正文就停下，不多请求', () => {
  assert.equal(
    earlierContinue({ round: 0, received: 25, conversationCount: 2, hasMore: true }),
    false
  )
})

test('整页都是工具步骤时继续往前补', () => {
  assert.equal(
    earlierContinue({ round: 0, received: 25, conversationCount: 0, hasMore: true }),
    true
  )
})

test('电脑端说到头了就不再请求', () => {
  assert.equal(
    earlierContinue({ round: 3, received: 25, conversationCount: 0, hasMore: false }),
    false
  )
})

test('返回空页时停手，避免同一游标反复请求', () => {
  // hasMore 与空页同时出现是异常响应（或丢帧），继续请求只会原地打转。
  assert.equal(earlierContinue({ round: 0, received: 0, conversationCount: 0, hasMore: true }), false)
})

test('补页有上限，一次点击不会吞下整段历史', () => {
  const atLimit = EARLIER_MAX_ROUNDS - 1
  assert.equal(
    earlierContinue({ round: atLimit, received: 25, conversationCount: 0, hasMore: true }),
    false
  )
  assert.equal(
    earlierContinue({ round: atLimit - 1, received: 25, conversationCount: 0, hasMore: true }),
    true
  )
})
