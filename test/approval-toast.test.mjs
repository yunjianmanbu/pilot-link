import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const storeSource = readFileSync(new URL('../store/index.js', import.meta.url), 'utf8')
const localeSource = readFileSync(new URL('../lib/locale-en.js', import.meta.url), 'utf8')

test('审批卡因超时或任务中断自动关闭时，手机端会说明原因', () => {
  assert.match(storeSource, /event\.decidedBy === 'timeout'/, '缺少超时提示分支')
  assert.match(storeSource, /审批超时，已自动拒绝/)
  assert.match(storeSource, /event\.decidedBy === 'interrupted'/, '缺少中断提示分支')
  assert.match(storeSource, /任务已中断，待审批操作已取消/)
})

test('审批提示的英文文案已补齐', () => {
  assert.match(localeSource, /"审批超时，已自动拒绝":\s*"Approval timed out/)
  assert.match(localeSource, /"任务已中断，待审批操作已取消":\s*"The task was interrupted/)
})
