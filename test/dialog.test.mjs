import test from 'node:test'
import assert from 'node:assert/strict'
import { closeAppDialog, openAppDialog, subscribeAppDialog } from '../lib/dialog.js'

test('打开弹框会通知订阅者，确认后 resolve true', async () => {
  const events = []
  const unsubscribe = subscribeAppDialog((state) => events.push({ ...state }))
  const pending = openAppDialog({
    title: '删除定时任务',
    message: '每天 9:00',
    cancelText: '保留',
    confirmText: '删除',
    danger: true
  })

  const opened = events.at(-1)
  assert.equal(opened.visible, true)
  assert.equal(opened.title, '删除定时任务')
  assert.equal(opened.cancelText, '保留')
  assert.equal(opened.confirmText, '删除')
  assert.equal(opened.danger, true)

  closeAppDialog(true)
  assert.equal(await pending, true)
  assert.equal(events.at(-1).visible, false)
  unsubscribe()
})

test('取消返回 false，cancelText 为空表示只显示主按钮', async () => {
  const events = []
  const unsubscribe = subscribeAppDialog((state) => events.push(state))
  const pending = openAppDialog({ title: '强制更新', cancelText: '', confirmText: '立即更新' })

  assert.equal(events.at(-1).cancelText, '')
  closeAppDialog(false)
  assert.equal(await pending, false)
  unsubscribe()
})

test('新弹框会先结束上一个，避免 promise 一直悬挂', async () => {
  const unsubscribe = subscribeAppDialog(() => {})
  const first = openAppDialog({ title: 'A' })
  const second = openAppDialog({ title: 'B' })

  assert.equal(await first, false)
  closeAppDialog(true)
  assert.equal(await second, true)
  unsubscribe()
})
