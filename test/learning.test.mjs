import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = path.join(ROOT, '..', 'pilot')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const readClient = (relative) => {
  const abs = path.join(CLIENT, relative)
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null
}

const page = read('pages/learning/index.vue')
const pages = read('pages.json')
const settings = read('pages/settings/index.vue')
const store = read('store/index.js')
const protocol = readClient('src/main/companion/server.ts')
const learning = readClient('src/main/agent/learning.ts')
const locale = read('lib/locale-en.js')


// 拆仓后本仓库不含桌面端源码与工作区文档：读不到就跳过，而不是判失败。
const skipCross = protocol != null && learning != null ? false : '独立仓库不含桌面端源码（pilot/pilot）与工作区文档（pilot/docs），跳过跨仓库一致性检查'
test('自主探索学习页已注册，设置页有入口', { skip: skipCross }, () => {
  assert.ok(pages.includes('"pages/learning/index"'), 'pages.json 缺少自主探索学习页')
  assert.ok(settings.includes('@click="openLearning"'), '设置页缺少自主探索学习入口')
  assert.ok(
    settings.includes("uni.navigateTo({ url: '/pages/learning/index' })"),
    '设置页入口没有跳到学习页'
  )
})

test('store 通过电脑端协议读取学习状态和保存设置', { skip: skipCross }, () => {
  for (const [fn, method] of [
    ['loadLearningState', 'learning.state'],
    ['saveLearningSettings', 'learning.settings']
  ]) {
    const start = store.indexOf(`export async function ${fn}`)
    assert.notEqual(start, -1, `缺少 ${fn}`)
    const body = store.slice(start, store.indexOf('\nexport ', start + 10))
    assert.ok(body.includes(`'${method}'`), `${fn} 没有调用 ${method}`)
    assert.ok(body.includes('isConnected()'), `${fn} 离线时没有报错`)
    assert.ok(body.includes('尚未打开工作区'), `${fn} 没有检查工作区`)
  }
})

test('电脑端协议只接受 GET/HEAD 白名单，并继续走工作区校验', { skip: skipCross }, () => {
  for (const method of ['learning.state', 'learning.settings']) {
    assert.ok(protocol.includes(`case '${method}'`), `电脑端缺少 ${method}`)
  }
  assert.ok(protocol.includes('assertWorkspace(workspacePath)'), '学习接口没有校验工作区')
  assert.ok(
    protocol.includes('normalizeLearningHostsInput(record[\'hosts\'])'),
    '学习白名单没有经过主机名校验'
  )
  assert.ok(
    protocol.includes("this.options.onEvent?.({\n          type: 'settings.changed'"),
    '手机改学习设置后没有同步电脑端设置窗'
  )
  assert.ok(protocol.includes('PHONE_LEARNING_ENTRY_LIMIT'), '学习账本没有限制回传条数')
  assert.ok(protocol.includes("ledger: '.pilot/learning/ledger.jsonl'"), '没有说明账本位置')

  // 形状校验必须在共享守门层里，而不是只在页面上裁剪。
  assert.ok(learning.includes('normalizeLearningHostsInput'), '守门层缺少手机白名单校验')
  assert.ok(learning.includes('LEARNING_HOST_PATTERN'), '守门层缺少主机名形状校验')
  assert.ok(learning.includes('学习来源白名单最多'), '守门层缺少白名单条数上限')
})

test('学习页明确展示只读、不上传和逐阶段确认的边界', () => {
  for (const text of [
    '只允许 GET/HEAD',
    '上传、提交、发布、推送类命令会被拒绝',
    '每个阶段成果都要你确认才算完成',
    '完整账本保存在工作区',
    '不会上传'
  ]) {
    assert.ok(page.includes(text), `学习页缺少边界说明：${text}`)
  }
  // 关掉开关不能沿用旧状态显示为开启。
  assert.ok(page.includes('this.state?.enabled === true'), '开关状态没有从电脑端状态派生')
  assert.ok(page.includes('friendlyError'), '页面没有处理旧版电脑端')
  assert.ok(page.includes('版本较旧'), '页面没有提示升级电脑端')
})

test('学习页的英文文案齐全', () => {
  for (const text of [
    '自主探索学习',
    '学习来源白名单',
    '学习账本',
    '只读研究',
    '阶段成果',
    '待确认',
    '实际生效：{v1}',
    '这台电脑的 Pilot 版本较旧，不支持在手机上控制自主探索学习。请先在电脑上安装新版 Pilot。'
  ]) {
    if (text === '阶段成果') {
      assert.ok(page.includes(text), '学习页缺少阶段成果文案')
      continue
    }
    assert.ok(locale.includes(`"${text}"`), `英文词典缺少：${text}`)
  }
})
