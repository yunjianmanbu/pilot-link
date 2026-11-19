import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

const chat = read('pages/chat/index.vue')
const store = read('store/index.js')
const locale = read('lib/locale-en.js')

test('对话页标题可点击改名，「更多」里也有重命名入口', () => {
  const titleStart = chat.indexOf('class="title"')
  assert.notEqual(titleStart, -1, '缺少对话页标题')
  const title = chat.slice(titleStart, chat.indexOf('</text>', titleStart))
  assert.ok(title.includes('@click="openRename"'), '标题没有绑定改名')
  assert.ok(title.includes(":class=\"{ editable: store.currentSessionId }\""), '标题缺少可编辑状态')

  const optionsStart = chat.indexOf('moreOptions() {')
  assert.notEqual(optionsStart, -1, '缺少 moreOptions')
  const options = chat.slice(optionsStart, chat.indexOf('\n    },', optionsStart))
  assert.ok(options.includes("t('重命名')"), '更多菜单缺少重命名')
  // 知识、文件之后排第三，下标要和 onMorePick 对上。
  assert.ok(options.indexOf("t('重命名')") > options.indexOf("t('文件')"))

  const pickStart = chat.indexOf('onMorePick(index) {')
  const pick = chat.slice(pickStart, chat.indexOf('\n    },', pickStart))
  assert.ok(pick.includes('pick === 2) this.openRename()'), '更多菜单下标没有接到改名')
})

test('改名弹层预填当前标题，空名称不能提交', () => {
  assert.ok(chat.includes(':visible="renameOpen"'), '缺少改名弹层')
  assert.ok(chat.includes("t('修改任务名称')"), '弹层缺少标题')
  assert.ok(chat.includes('v-model="renameValue"'), '弹层缺少名称输入框')
  assert.ok(chat.includes(':maxlength="120"'), '名称长度没有限制在 120')
  assert.ok(chat.includes(':focus="renameFocus"'), '打开弹层时应聚焦输入框')
  assert.ok(chat.includes('@confirm="submitRename"'), '键盘回车应保存')

  const openStart = chat.indexOf('openRename() {')
  assert.notEqual(openStart, -1, '缺少 openRename')
  const open = chat.slice(openStart, chat.indexOf('\n    },', openStart))
  assert.ok(open.includes('store.currentSession?.title'), '没有预填当前任务名称')
  assert.ok(open.includes('renameFocus = true'), '打开后没有聚焦输入框')

  const canStart = chat.indexOf('canRename() {')
  assert.notEqual(canStart, -1, '缺少 canRename')
  const can = chat.slice(canStart, chat.indexOf('\n    },', canStart))
  assert.ok(can.includes('trim()'), '空名称应被拦下')
  assert.ok(can.includes('!this.renameSaving'), '保存中应禁止重复提交')

  const submitStart = chat.indexOf('async submitRename() {')
  const submit = chat.slice(submitStart, chat.indexOf('\n    },', submitStart))
  assert.ok(submit.includes('await renameSession(store.currentSessionId, title)'), '没有调用改名')
  assert.ok(submit.includes('renameError'), '保存失败时应显示错误')
  assert.ok(submit.includes("t('任务名称已更新')"), '成功后应有提示')
})

test('改名走电脑端 sessions.rename，并把返回的会话写回列表', () => {
  const start = store.indexOf('export async function renameSession(sessionId, title)')
  assert.notEqual(start, -1, '缺少 renameSession')
  // 只截取 renameSession 本身；后面新增的复制/删除会话各自有独立测试。
  const body = store.slice(start, store.indexOf('\nexport async function forkSession', start))

  assert.ok(body.includes("request('sessions.rename', { sessionId: id, title: next })"), '没有调用电脑端改名')
  assert.ok(body.includes('.trim().slice(0, 120)'), '名称应先去掉首尾空格并限制长度')
  assert.ok(body.includes('if (!next) throw'), '空名称应报错')
  assert.ok(body.includes('isConnected()'), '电脑端离线时应直接报错')
  assert.ok(body.includes('applySessionUpdate(updated)'), '应把电脑端返回的会话摘要写回列表')
  // 兼容旧电脑端：没有回传摘要时只改标题，不动计划、队列等其它字段。
  assert.ok(body.includes('{ ...store.sessions[index], title: next }'), '缺少本地标题兜底')
  assert.ok(body.includes('store.currentSession.title = next'), '当前会话标题没有同步')
  assert.doesNotMatch(body, /store\.todos\s*=/, '改名不应清空待办')
  assert.doesNotMatch(body, /store\.messages\s*=/, '改名不应清空消息')
})

test('改名的中英文文案齐全', () => {
  for (const key of [
    '重命名',
    '修改任务名称',
    '只改标题，不影响工作区和执行记录',
    '输入任务名称',
    '名称最多 120 个字',
    '任务名称不能为空',
    '任务名称已更新',
    '修改失败，请稍后再试',
    '没有选中的任务'
  ]) {
    assert.ok(locale.includes(`"${key}":`), `英文词典缺少「${key}」`)
  }
})
