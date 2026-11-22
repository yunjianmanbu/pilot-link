import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { messageTime } from '../lib/format.js'
import { createPressGesture, movedBeyond, touchPoint } from '../lib/press.js'
import { readClient, readClientTree } from './client-source.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

/** ChatView 的正文已经拆到 components/chat 下，两处一起读。 */
const readChatView = () =>
  [readClient('src/renderer/src/components/ChatView.tsx'), readClientTree('src/renderer/src/components/chat')]
    .filter(Boolean)
    .join('\n') || null

const sessions = read('pages/sessions/index.vue')
const chat = read('pages/chat/index.vue')
const fileLib = read('lib/files.js')
const evolution = read('pages/evolution/index.vue')
const knowledge = read('pages/knowledge/index.vue')
const files = read('pages/files/index.vue')
const settings = read('pages/settings/index.vue')
const store = read('store/index.js')
const protocol = readClientTree('src/main/companion')
const locale = read('lib/locale-en.js')


// 拆仓后本仓库不含桌面端源码与工作区文档：读不到就跳过，而不是判失败。
const skipCross = protocol != null ? false : '独立仓库不含桌面端源码（pilot/pilot）与工作区文档（pilot/docs），跳过跨仓库一致性检查'
test('首页长按会话可以重命名、复制和删除', () => {
  assert.ok(sessions.includes('@touchstart="startSessionPress(session, $event)"'), '会话卡片缺少长按入口')
  assert.ok(sessions.includes('@touchmove="moveSessionPress"'), '会话长按没有跟随手指移动')
  assert.ok(!sessions.includes('@longpress='), '会话列表不能再用原生 longpress，拖动列表会误触')
  assert.ok(sessions.includes('@scroll="onSessionListScroll"'), '列表滚动时没有取消长按')
  assert.ok(sessions.includes('this.sessionPress?.clickBlocked()'), '长按菜单打开后没有挡住随后的点击')
  assert.ok(sessions.includes("t('重命名')"), '缺少重命名动作')
  assert.ok(sessions.includes("t('复制任务')"), '缺少复制任务动作')
  assert.ok(sessions.includes("t('删除任务')"), '缺少删除任务动作')
  assert.ok(sessions.includes('@confirm="confirmDeleteSession"'), '删除缺少确认框')
  assert.ok(sessions.includes('forkSession'), '复制没有接到 store')
  assert.ok(sessions.includes('deleteSession'), '删除没有接到 store')
  assert.ok(sessions.includes('renameSession'), '重命名没有接到 store')
  // 长按必须和普通点击共存：点开任务不能变成菜单。
  assert.ok(sessions.includes('@click="open(session)"'), '普通点击打开会话丢失')
})

test('会话里的链接点按直接内置预览，长按再选浏览器或复制', () => {
  assert.ok(chat.includes('@click.stop="openLink(link)"'), '链接缺少点按入口')
  assert.ok(chat.includes('@longpress.stop="openLinkMenu(link)"'), '链接缺少长按菜单')
  const openStart = chat.indexOf('    openLink(link) {')
  assert.notEqual(openStart, -1, '缺少 openLink 方法')
  const openBody = chat.slice(openStart, chat.indexOf('    openLinkMenu(link) {', openStart))
  assert.ok(openBody.includes('this.previewLink('), '点按链接没有直接打开预览')
  assert.ok(!openBody.includes('linkSheetOpen = true'), '点按链接仍会先弹选择层')
  const menuStart = chat.indexOf('    openLinkMenu(link) {')
  assert.notEqual(menuStart, -1, '缺少 openLinkMenu 方法')
  const menuBody = chat.slice(menuStart, chat.indexOf('    previewLink(url, label) {', menuStart))
  assert.ok(menuBody.includes('linkSheetOpen = true'), '长按没有打开链接选项')
  assert.ok(chat.includes('openWebPreview(url, label)'), '没有调用内置网页预览')
  assert.ok(chat.includes('openExternalUrl(url)'), '没有保留系统浏览器入口')
  assert.ok(/t\(["']链接已复制["']\)/.test(chat), '没有保留复制链接入口')

  // 预览窗口不能把原生接口交给任意网页，地址仍只接受 http/https。
  assert.ok(fileLib.includes("plusrequire: 'none'"), '网页预览没有隔离原生接口')
  assert.ok(fileLib.includes('export function openWebPreview'), '缺少内置网页预览实现')
  assert.ok(fileLib.includes('isWebLink(target)'), '网页预览没有校验链接协议')
})

test('store 的会话动作分别走电脑端对应方法', () => {
  for (const [fn, method] of [
    ['renameSession', 'sessions.rename'],
    ['forkSession', 'sessions.fork'],
    ['deleteSession', 'sessions.delete'],
    ['retrySession', 'run.retry']
  ]) {
    const start = store.indexOf(`export async function ${fn}`)
    assert.notEqual(start, -1, `缺少 ${fn}`)
    const body = store.slice(start, store.indexOf('\nexport ', start + 10))
    assert.ok(body.includes(`request('${method}'`), `${fn} 没有调用 ${method}`)
    assert.ok(body.includes('isConnected()'), `${fn} 离线时没有报错`)
  }
  const deleteBody = store.slice(
    store.indexOf('export async function deleteSession'),
    store.indexOf('\nexport async function retrySession')
  )
  assert.ok(deleteBody.includes('resetStream()'), '删除当前会话后没有复位运行态')
  assert.ok(deleteBody.includes('store.todos = []'), '删除当前会话后没有清空待办')
})

test('每条指令和回复都显示发送时间', () => {
  assert.ok(chat.includes('messageTime(message.createdAt || message.timestamp)'), '会话消息没有读取发送时间')
  assert.ok(chat.includes('const showsTime ='), '没有区分指令、回复与工具结果')
  assert.ok(chat.includes('item.timeLabel || item.copyText'), '时间行没有和消息操作一起渲染')
  assert.ok(chat.includes('class="msg-time"'), '缺少消息时间样式')
  assert.ok(knowledge.includes('replyTime: messageTime(pair.replyAt)'), '知识库回复没有时间')
  assert.ok(knowledge.includes('pair.replyTime'), '知识库没有显示回复时间')
  assert.ok(knowledge.includes('time: messageTime(pair.instructionAt)'), '知识库指令没有显示具体时间')

  const now = new Date(2026, 10, 16, 15, 0).getTime()
  assert.equal(messageTime(new Date(2026, 10, 16, 14, 5).toISOString(), now), '14:05')
  assert.equal(messageTime(new Date(2026, 10, 15, 14, 5).toISOString(), now), '11-15 14:05')
  assert.equal(messageTime(new Date(2025, 10, 15, 14, 5).toISOString(), now), '2025-11-15 14:05')
  assert.equal(messageTime('not a date', now), '')
  assert.equal(messageTime('', now), '')
})

test('长按只在按住不动时触发，拖动或滚动都会取消', () => {
  let now = 1000
  let pending = null
  const fired = []
  const gesture = createPressGesture({
    onLongPress: (value) => fired.push(value),
    now: () => now,
    setTimer: (fn, ms) => {
      pending = { fn, at: now + ms }
      return 1
    },
    clearTimer: () => {
      pending = null
    }
  })
  const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }] })
  const advance = (ms) => {
    now += ms
    if (pending && now >= pending.at) {
      const { fn } = pending
      pending = null
      fn()
    }
  }

  // 按住不动满 500ms 才打开菜单，并挡住松手后的 click。
  gesture.start(touch(20, 20), 'a')
  advance(499)
  assert.deepEqual(fired, [])
  advance(1)
  assert.deepEqual(fired, ['a'])
  assert.equal(gesture.clickBlocked(), true)
  gesture.end()

  // 拖动超过阈值：计时取消，松手也不会误开菜单。
  gesture.start(touch(20, 20), 'b')
  gesture.move(touch(20, 40))
  assert.equal(gesture.clickBlocked(), true, '拖动之后没有挡住松手产生的点击')
  advance(1000)
  assert.deepEqual(fired, ['a'])
  gesture.end()

  // 列表正在滚动时，触摸只是为了让列表停下，不开始长按计时。
  now += 1000
  gesture.scroll()
  gesture.start(touch(10, 10), 'c')
  advance(1000)
  assert.deepEqual(fired, ['a'])

  // 普通轻点不算长按，也不能影响正常点击。
  now += 1000
  gesture.start(touch(10, 10), 'd')
  advance(200)
  gesture.end()
  assert.deepEqual(fired, ['a'])
  assert.equal(gesture.clickBlocked(), false)

  // 阈值内的轻微抖动仍然算按住。
  gesture.start(touch(10, 10), 'e')
  gesture.move(touch(14, 12))
  advance(500)
  assert.deepEqual(fired, ['a', 'e'])
  gesture.end()

  assert.equal(movedBeyond({ x: 0, y: 0 }, { x: 5, y: 5 }), false)
  assert.equal(movedBeyond({ x: 0, y: 0 }, { x: 0, y: 13 }), true)
  assert.deepEqual(touchPoint({ changedTouches: [{ pageX: 3, pageY: 4 }] }), { x: 3, y: 4 })
  assert.equal(touchPoint({}), null)
})

test('对话页失败横幅可重试，评审报告和消息编辑都有入口', { skip: skipCross }, () => {
  assert.ok(chat.includes('@click="retryFailedRun"'), '失败消息缺少重试按钮')
  assert.ok(chat.includes("t('正在重试…')"), '重试按钮缺少进行中文案')
  assert.ok(chat.includes('@touchstart="startMessagePress(item, $event)"'), '用户消息缺少长按编辑入口')
  assert.ok(chat.includes('@scroll="onScroll"'), '聊天列表缺少滚动事件')
  assert.ok(chat.includes('this.messagePress?.scroll()'), '聊天滚动时没有取消消息长按')
  assert.ok(chat.includes('@click="submitEditMessage"'), '编辑弹层缺少保存入口')
  assert.ok(chat.includes('chat.edit') || chat.includes('editMessage('), '编辑没有接到 store')
  assert.ok(chat.includes('canDeleteMessage('), '未回复指令没有删除条件')
  assert.ok(chat.includes('confirmDeleteMessage'), '删除指令没有确认入口')
  assert.ok(chat.includes("t('删除这条还没有回复的指令？')"), '缺少删除未回复指令的确认文案')
  assert.ok(chat.includes('deleteMessage(sessionId, target.id)'), '删除指令没有接到 store')
  const view = readChatView()
  assert.ok(view.includes('onDeleteMessage'), '桌面端没有接口删除指令')
  assert.ok(
    view.includes('transcript[transcript.length - 1]?.id'),
    '桌面端没有限制只删除最后一条未回复指令'
  )
  assert.ok(
    view.includes('window.confirm(t("删除这条还没有回复的指令？"))'),
    '桌面端删除指令没有确认'
  )
  assert.ok(chat.includes("t('评审报告')"), '缺少评审报告卡片')
  assert.ok(chat.includes('reviewReport.scores') || chat.includes('reviewReport.findings'), '评审报告没有渲染明细')
  assert.ok(chat.includes('v-if="store.newChat'), '新会话欢迎页缺少快捷指令')
  assert.ok(chat.includes('loadQuickCommands()'), '欢迎页没有读取快捷指令')
})

test('删除未回复指令走电脑端校验并刷新会话', () => {
  const start = store.indexOf('export async function deleteMessage')
  assert.notEqual(start, -1, '缺少 deleteMessage')
  const body = store.slice(start, store.indexOf('\nexport ', start + 10))
  assert.ok(body.includes("request('chat.deleteMessage'"), '没有调用 chat.deleteMessage')
  assert.ok(body.includes('reloadHistory()'), '删除后没有刷新消息')
  assert.ok(body.includes('isConnected()'), '离线时没有报错')
})

test('回退点、变更审阅、记忆三个手机通道都已接线', { skip: skipCross }, () => {
  for (const method of [
    'checkpoints.list',
    'checkpoints.create',
    'checkpoints.restore',
    'changes.list',
    'changes.revert',
    'memory.list',
    'memory.add',
    'memory.remove',
    'chat.edit',
    'chat.deleteMessage',
    'chat.regenerate',
    'quickCommands.get',
    'quickCommands.save'
  ]) {
    assert.ok(protocol.includes(`case '${method}'`), `电脑端协议缺少 ${method}`)
  }
  assert.ok(protocol.includes('当前电脑端版本不支持手机'), '缺少旧电脑端的能力提示')
  assert.ok(protocol.includes("notify({ type: 'session.changed'"), '恢复后没有通知会话变化')
  assert.ok(protocol.includes("type: 'memory.changed'"), '记忆变化没有通知手机')
  // 恢复与还原会改动工作区，执行中必须拒绝。
  assert.ok(protocol.includes('请先等待当前任务结束再回退'), '恢复缺少执行中保护')
  assert.ok(protocol.includes('请先等待当前任务结束再撤销变更'), '还原缺少执行中保护')
  // 手机页面入口。
  assert.ok(chat.includes("t('回退点')"), '更多菜单缺少回退点')
  assert.ok(chat.includes("t('变更审阅')"), '更多菜单缺少变更审阅')
  assert.ok(chat.includes("t('项目记忆')"), '更多菜单缺少项目记忆')
  assert.ok(chat.includes('askRestoreCheckpoint'), '回退点恢复没有确认')
  assert.ok(chat.includes('askRevertChange'), '文件还原没有确认')
  assert.ok(chat.includes('askRemoveMemory'), '记忆删除没有确认')
})

test('知识页支持本会话、本项目、全部三档范围', () => {
  assert.ok(/t\((["'])本会话\1\)/.test(knowledge), '缺少本会话范围')
  assert.ok(/t\((["'])本项目\1\)/.test(knowledge), '缺少本项目范围')
  assert.ok(/t\((["'])全部\1\)/.test(knowledge), '缺少全部工作区范围')
  assert.ok(knowledge.includes('searchKnowledge('), '项目/全部没有走全库搜索')
  assert.ok(knowledge.includes("workspacePath: this.projectPath"), '项目范围没有按工作区过滤')
  assert.ok(knowledge.includes('jumpHit(hit)'), '命中结果不能跳回会话')
  assert.ok(knowledge.includes('hit.snippet'), '命中结果没有摘要')
  assert.ok(knowledge.includes('hit.sessionTitle'), '命中结果没有会话标题')
})

test('文件页有会话文件和工作区两个标签，工作区只读浏览', () => {
  assert.ok(files.includes("t('会话文件')"), '缺少会话文件标签')
  assert.ok(files.includes("t('工作区')"), '缺少工作区标签')
  assert.ok(files.includes("request(\n          'files.list'") || files.includes("'files.list'"), '工作区没有调用 files.list')
  assert.ok(files.includes('workspaceUp'), '缺少上一级导航')
  assert.ok(files.includes('openWorkspaceFile'), '工作区文件不能打开')
  assert.ok(files.includes("t('只读浏览：点文件即可预览，修改仍要在电脑端进行。')"), '缺少只读提示')
})

test('设置页只读展示沙箱和工具清单，并可编辑快捷指令', () => {
  assert.ok(settings.includes("t('安全与能力')"), '缺少安全与能力卡片')
  assert.ok(settings.includes('loadSandboxStatus()'), '没有读取沙箱状态')
  assert.ok(settings.includes('loadTools('), '没有读取工具清单')
  assert.ok(settings.includes("t('只读展示；沙箱、权限和工具启停仍在电脑端设置。')"), '缺少只读边界说明')
  assert.ok(settings.includes("t('编辑快捷指令')"), '缺少快捷指令编辑入口')
  assert.ok(settings.includes('saveQuickCommands('), '快捷指令没有保存')
  assert.ok(settings.includes('this.quickList.length >= 8'), '快捷指令没有限制 8 条')
})

test('待办的全部发送、单条发送和删除都先弹框确认', { skip: skipCross }, () => {
  assert.ok(chat.includes(':visible="!!todoConfirm"'), '待办确认框没有挂载')
  assert.ok(chat.includes('@confirm="confirmTodoAction"'), '确认框没有接到执行方法')
  for (const [method, title] of [
    ['sendTodoItem', '发送这条待办？'],
    ['sendAllTodoItems', '全部发送这 {v1} 条待办？'],
    ['removeTodoItem', '删除这条待办？']
  ]) {
    const start = chat.indexOf(`    ${method}(`)
    assert.notEqual(start, -1, `缺少 ${method}`)
    const body = chat.slice(start, chat.indexOf('\n    },', start))
    assert.ok(body.includes(`title: t('${title}'`), `${method} 没有先打开确认框`)
    assert.ok(body.includes('this.todoConfirm ='), `${method} 没有设置确认内容`)
  }
  const confirm = chat.slice(
    chat.indexOf('async confirmTodoAction()'),
    chat.indexOf('\n    },', chat.indexOf('async confirmTodoAction()'))
  )
  assert.ok(confirm.includes('await sendTodo(action.todoId)'), '确认后没有发送单条待办')
  assert.ok(confirm.includes('await sendAllTodos()'), '确认后没有全部发送')
  assert.ok(confirm.includes('await removeTodo(action.todoId)'), '确认后没有删除待办')
  assert.ok(confirm.includes('this.todoConfirmBusy'), '确认执行时没有防止重复提交')

  // 全部发送收在展开后的待办列表底部，收起时待办栏头只保留数量。
  const panelStart = chat.indexOf('<view v-if="store.currentSessionId && !store.newChat" class="todo-panel">')
  const panelEnd = chat.indexOf(
    '<view v-if="store.currentSessionId && !store.newChat" class="todo-panel schedule-panel">',
    panelStart
  )
  assert.ok(panelStart >= 0 && panelEnd > panelStart, '找不到待办面板')
  const panel = chat.slice(panelStart, panelEnd)
  const bodyStart = panel.indexOf('<view v-if="todoOpen" class="todo-body">')
  assert.ok(bodyStart > 0, '待办面板没有展开区域')
  assert.ok(!panel.slice(0, bodyStart).includes('sendAllTodoItems'), '全部发送不应放在待办栏头部')
  const body = panel.slice(bodyStart)
  const sendAllAt = body.indexOf('sendAllTodoItems')
  assert.ok(sendAllAt > 0, '展开后的待办列表缺少全部发送')
  assert.ok(sendAllAt > body.indexOf('class="todo-add-row"'), '全部发送应在待办列表底部')

  // 桌面端同款动作也必须先确认。
  const view = readChatView()
  assert.ok(view.includes('window.confirm(t("发送这条待办？"))'), '桌面端单条发送没有确认')
  assert.ok(
    view.includes('window.confirm(t("全部发送这 {v1} 条待办？", { v1: pending.length }))'),
    '桌面端全部发送没有确认'
  )
  assert.ok(view.includes('window.confirm(t("删除这条待办？"))'), '桌面端删除待办没有确认')
})

test('手机端可以从内置源码开启改造对话', { skip: skipCross }, () => {
  assert.ok(evolution.includes("t('和 Pilot 聊源码改造')"), '缺少源码改造对话入口')
  assert.ok(evolution.includes('@click="chatSource"'), '入口没有接到开启对话方法')
  const start = evolution.indexOf('async chatSource()')
  assert.notEqual(start, -1, '缺少 chatSource 方法')
  const body = evolution.slice(start, evolution.indexOf('\n    },', start))
  assert.ok(body.includes("perform('personalOpenSource')"), '没有先准备内置源码')
  assert.ok(body.includes('startNewChat('), '没有在源码工作区新建对话')
  assert.ok(body.includes('this.hasKey'), '没有检查 API Key')
  assert.ok(body.includes("url: '/pages/chat/index?new=1'"), '没有进入会话页')

  // store 记住开场白，会话页只预填一次，不自动发送。
  assert.ok(store.includes('export function startNewChat(cwd, prompt'), 'startNewChat 不能接收开场白')
  assert.ok(store.includes('prompt: String(prompt'), '新对话没有保存开场白')
  assert.ok(chat.includes('store.newChat?.prompt'), '会话页没有读取开场白')
  assert.ok(chat.includes('this.draft = seed'), '开场白没有预填到输入框')
  assert.ok(chat.includes('store.newChat.prompt = '), '开场白没有在预填后清掉')

  // 桌面端同样有“聊源码改造”入口，并打开一个新对话。
  const panel = readClient('src/renderer/src/components/EvolutionPanel.tsx')
  const app = readClient('src/renderer/src/App.tsx')
  assert.ok(panel.includes('onChatSelfSource'), '桌面端缺少聊源码改造回调')
  assert.ok(panel.includes('t("和 Pilot 聊源码改造")'), '桌面端缺少聊源码改造入口')
  assert.ok(app.includes('const chatSelfSource'), '桌面端缺少聊源码改造实现')
  assert.ok(app.includes('await newSession(result.path)'), '桌面端没有新开源码改造对话')
  assert.ok(app.includes('setComposerSeed({'), '桌面端没有预填改造开场白')
})

test('新增的中英文文案齐全', () => {
  const keys = [
    '任务操作',
    '复制任务',
    '删除任务？',
    '消息操作',
    '编辑并重新生成',
    '回退点',
    '恢复文件',
    '全部恢复',
    '变更审阅',
    '项目记忆',
    '评审报告',
    '正确性',
    '重新生成',
    '搜索知识库',
    '项目知识库',
    '全部知识库',
    '会话文件',
    '工作区文件',
    '安全与能力',
    '动态工具',
    '快捷指令',
    '发送这条待办？',
    '全部发送这 {v1} 条待办？',
    '发送后会按顺序立即执行。',
    '删除这条待办？',
    '删除这条还没有回复的指令？',
    '删除后不会执行，也不会留在对话里。',
    '指令已删除。',
    '和 Pilot 聊源码改造',
    '正在准备…',
    '我想改造自己的 Pilot。请先读 SELF.md，了解源码结构和构建方式，然后用简短的话说明可以定制哪些地方，并问我最想改什么。先不要改代码，等我确认。',
    '直接和 Pilot 聊你想怎么改造，它会读内置源码、修改、跑测试并构建个人版；版本可保存、恢复和提交官方。'
  ]
  for (const key of keys) {
    assert.ok(locale.includes(`"${key}":`), `英文词典缺少「${key}」`)
  }
})
