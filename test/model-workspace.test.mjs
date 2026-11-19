import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const settings = readFileSync(new URL('../pages/settings/index.vue', import.meta.url), 'utf8')
const localeEn = readFileSync(new URL('../lib/locale-en.js', import.meta.url), 'utf8')

test('设置页不再按项目指定会话模型，只保留全局会话模型', () => {
  // 项目级模型已经取消：模型只能按任务会话选，或跟随全局会话模型。
  assert.doesNotMatch(settings, /projectModelRows/)
  assert.doesNotMatch(settings, /workspaces\.model/)
  assert.doesNotMatch(settings, /项目会话模型/)
  assert.doesNotMatch(settings, /modelPickerKind === 'workspace'/)
  assert.match(settings, /t\('会话模型'\)/)
  assert.match(settings, /request\('models\.get', \{\}, 20_000\)/)
})

test('设置页不再读取项目列表来决定模型', () => {
  assert.doesNotMatch(settings, /loadModelWorkspaces/)
  assert.doesNotMatch(settings, /request\('workspaces\.list', \{\}, 20_000\)/)
})

test('新增文案都有英文翻译', () => {
  for (const key of ['会话模型', '跟随全局会话模型', '已配置密钥', '缺少密钥']) {
    assert.ok(localeEn.includes(`"${key}"`), `缺少英文翻译：${key}`)
  }
})

const chat = readFileSync(new URL('../pages/chat/index.vue', import.meta.url), 'utf8')
const store = readFileSync(new URL('../store/index.js', import.meta.url), 'utf8')

test('任务会话里用下拉选择本任务的会话模型，空值跟随全局', () => {
  assert.match(chat, /request\('models\.get', \{\}, 20_000\)/)
  assert.match(chat, /currentSession\?\.sessionModelId/)
  assert.match(chat, /跟随全局/)
  assert.match(chat, /setSessionModel\(sessionId, option\.value\)/)
  assert.match(chat, /t\('会话模型'\)/)
})

test('任务会话不再继承项目级模型', () => {
  assert.doesNotMatch(chat, /projectSessionModelId/)
  assert.doesNotMatch(chat, /modelWorkspaces/)
  // 模型读取只走 models.get；工作区列表只给「参照其他项目」用。
  const loadModels = chat.slice(chat.indexOf('async loadSessionModels'), chat.indexOf('async onModelPick'))
  assert.ok(loadModels.includes("request('models.get', {}, 20_000)"))
  assert.ok(!loadModels.includes("request('workspaces.list'"))
})

test('手机端保存任务模型走 sessions.model，空串清除覆盖', () => {
  assert.match(store, /request\('sessions\.model', \{ sessionId, modelId: value \}\)/)
  assert.match(store, /sessionModelId:\s*\n?\s*typeof session\.sessionModelId === 'string'/)
})

test('会话模型入口在右上角「更多」菜单里，输入区不再放胶囊', () => {
  const moreStart = chat.indexOf('moreOptions() {')
  assert.notEqual(moreStart, -1, '缺少 moreOptions')
  const more = chat.slice(moreStart, chat.indexOf('\n    },', moreStart))
  assert.ok(more.includes("t('会话模型')"), '更多菜单缺少会话模型入口')
  assert.ok(more.includes('hint: this.sessionModelMenuHint'), '菜单项没有带上当前模型副标题')

  const pickStart = chat.indexOf('onMorePick(index) {')
  const pick = chat.slice(pickStart, chat.indexOf('\n    },', pickStart))
  assert.ok(pick.includes('this.openModelSheet()'), '更多菜单没有接到模型选择')

  assert.ok(
    !chat.includes('class="mode-select model-select"'),
    '输入区不应再放会话模型胶囊'
  )
})

test('任务模型新增文案都有英文翻译', () => {
  for (const key of [
    '只影响这个任务，不会改统一设置',
    '跟随全局（{v1}）',
    '跟随全局会话模型',
    '读取模型失败，稍后重试。',
    '电脑端离线，暂时无法切换模型',
    '已切换这个任务的模型',
    '已跟随全局会话模型',
    '切换模型失败，稍后重试。',
    '请先打开一个任务'
  ]) {
    assert.ok(localeEn.includes(`"${key}"`), `缺少英文翻译：${key}`)
  }
})
