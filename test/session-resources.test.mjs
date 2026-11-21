import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  extractSessionLinks,
  hostOf,
  normalizeSessionLinks,
  normalizeSessionTools,
  tidyUrl,
  toolRiskLabel,
  toolSourceLabel
} from '../lib/session-resources.js'

function user(id, text, extra = {}) {
  return {
    id,
    role: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    blocks: [{ type: 'text', text }],
    ...extra
  }
}

function assistant(id, text) {
  return {
    id,
    role: 'assistant',
    createdAt: '2026-01-01T00:00:00.000Z',
    blocks: [{ type: 'text', text }]
  }
}

test('句末标点与中文标点不进入链接', () => {
  assert.equal(tidyUrl('https://a.com/x.'), 'https://a.com/x')
  assert.equal(tidyUrl('https://a.com/x），'), 'https://a.com/x')
  assert.equal(tidyUrl('https://a.com/x"]'), 'https://a.com/x')
})

test('配对括号保留，单独的右括号去掉', () => {
  assert.equal(tidyUrl('https://w.org/Foo_(bar)'), 'https://w.org/Foo_(bar)')
  assert.equal(tidyUrl('https://a.com/x)'), 'https://a.com/x')
})

test('host 去 www，非法地址返回空串', () => {
  assert.equal(hostOf('https://www.github.com/a'), 'github.com')
  assert.equal(hostOf('https://docs.rs/x'), 'docs.rs')
  assert.equal(hostOf('不是链接'), '')
  // 端口保留、userinfo 不计入主机，与 URL.host 的口径一致。
  assert.equal(hostOf('https://x.com:8443/a'), 'x.com:8443')
  assert.equal(hostOf('https://user:pw@y.com/a'), 'y.com')
  assert.equal(hostOf('https://'), '')
})

// uni-app 的 App 端跑在 V8 / JSCore 里，没有 WHATWG URL。
// 以前 hostOf 直接 `new URL()` 抛错，逐条链接都被丢弃：
// 手机上显示「31 条链接 · 只显示最近 0 条」而列表空白。
test('App 逻辑层没有全局 URL 时，链接仍然解析得出来', () => {
  const saved = globalThis.URL
  globalThis.URL = undefined
  try {
    assert.equal(hostOf('https://www.github.com/a'), 'github.com')
    const links = normalizeSessionLinks([
      { url: 'https://x.com/a', host: 'x.com' },
      { url: 'https://y.com/b' }
    ])
    assert.deepEqual(
      links.map((link) => link.host),
      ['x.com', 'y.com']
    )
    const local = extractSessionLinks([user('m1', '看 https://z.com/a 的说明')])
    assert.equal(local.length, 1)
    assert.equal(local[0].host, 'z.com')
  } finally {
    globalThis.URL = saved
  }
})

test('按最后出现位置从新到旧，同一链接只出现一次并累计次数', () => {
  const links = extractSessionLinks([
    user('m1', '看 https://a.com/one 和 https://b.com/two'),
    assistant('m2', '参考 https://a.com/one'),
    user('m3', '再看 https://c.com/three')
  ])
  assert.deepEqual(
    links.map((link) => link.url),
    ['https://c.com/three', 'https://a.com/one', 'https://b.com/two']
  )
  const one = links.find((link) => link.url === 'https://a.com/one')
  assert.equal(one.count, 2)
  // 首次出现的消息决定角色与上下文。
  assert.equal(one.role, 'user')
  assert.equal(one.messageId, 'm1')
})

test('上下文取第一行正文并去掉链接本身', () => {
  const [link] = extractSessionLinks([user('m1', '请读 https://a.com/x 里的说明\n第二行')])
  assert.equal(link.context, '请读 里的说明')
})

test('跳过内部续跑提醒、工具消息，以及没有权限的正文', () => {
  const links = extractSessionLinks([
    user('m1', 'https://keep.com/a', { internal: true }),
    user('m2', 'https://keep.com/b', { control: true }),
    { id: 'm3', role: 'tool', blocks: [{ type: 'text', text: 'https://keep.com/c' }] },
    user('m4', 'https://real.com/d')
  ])
  assert.deepEqual(
    links.map((link) => link.url),
    ['https://real.com/d']
  )
})

test('本地提取遵守条数上限', () => {
  const text = Array.from({ length: 30 }, (_, i) => `https://h.com/${i}`).join(' ')
  const links = extractSessionLinks([user('m1', text)], 5)
  assert.equal(links.length, 5)
})

test('电脑端返回值会被清洗、去重并补上主机名', () => {
  const links = normalizeSessionLinks([
    { url: 'https://x.com/a.', host: 'x.com', role: 'assistant', count: 3, context: 'c' },
    { url: 'https://x.com/a', host: 'x.com' },
    { url: '不是链接', host: '' },
    null
  ])
  assert.equal(links.length, 1)
  assert.equal(links[0].url, 'https://x.com/a')
  assert.equal(links[0].host, 'x.com')
  assert.equal(links[0].count, 3)
})

test('工具条目补上风险与来源标签，丢弃无名条目', () => {
  const tools = normalizeSessionTools([
    { name: 'read_file', description: 'x', risk: 'read', source: 'builtin' },
    { name: 'bad-manifest', risk: 'exec', source: 'dynamic', approved: false, version: 2 },
    { name: '   ' },
    null
  ])
  assert.equal(tools.length, 2)
  assert.equal(tools[0].riskLabel, '只读')
  assert.equal(tools[0].sourceLabel, '内置')
  assert.equal(tools[0].enabled, true)
  assert.equal(tools[1].sourceLabel, '自写')
  assert.equal(tools[1].approved, false)
  assert.equal(tools[1].version, 2)
  // 没有中文说明的条目给空串，页面回落到英文原文，不会出现 undefined。
  assert.equal(tools[0].descriptionZh, '')
})

test('中文说明随工具条目一起带到手机端', () => {
  const tools = normalizeSessionTools([
    {
      name: 'read_file',
      description: 'Read a UTF-8 text file from the workspace.',
      descriptionZh: '读取工作区里的文本文件，可指定行区间；改文件前先读一遍。',
      risk: 'read',
      source: 'builtin'
    }
  ])
  assert.equal(tools[0].descriptionZh, '读取工作区里的文本文件，可指定行区间；改文件前先读一遍。')
  assert.match(tools[0].description, /Read a UTF-8/)
})

test('未知风险等级按最保守的命令处理', () => {
  assert.equal(toolRiskLabel('nope'), '命令')
  assert.equal(toolRiskLabel('control'), '控制')
  assert.equal(toolSourceLabel('mcp'), 'MCP')
  assert.equal(toolSourceLabel(undefined), '内置')
})

test('超长描述被截断以免撑爆一帧', () => {
  const [tool] = normalizeSessionTools([{ name: 'x', description: 'a'.repeat(1000) }])
  assert.equal(tool.description.length, 321)
  assert.ok(tool.description.endsWith('…'))
})

// 页面上的风险/来源标签必须与 lib 的口径一致，否则同一个工具在两个地方叫法不同。
test('预览页的风险与来源标签和 lib 口径一致', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'pages', 'session-resources', 'index.vue'),
    'utf8'
  )
  for (const [method, label, values] of [
    ['riskText', toolRiskLabel, ['read', 'write', 'exec', 'control']],
    ['sourceText', toolSourceLabel, ['builtin', 'control', 'mcp', 'dynamic']]
  ]) {
    const start = source.indexOf(`    ${method}(tool) {`)
    assert.notEqual(start, -1, `缺少 ${method}`)
    const body = source.slice(start, source.indexOf('\n    },', start))
    for (const value of values) {
      const match = body.match(new RegExp(`tool\\.${method === 'riskText' ? 'risk' : 'source'} === '${value}'\\) return t\\('([^']+)'\\)`))
      assert.ok(match, `${method} 没有处理 ${value}`)
      assert.equal(match[1], label(value), `${method} 对 ${value} 的标签与 lib 不一致`)
    }
  }
})

// 任务卡片上的四个入口指向同一页的不同分类，页面必须认得 tab 参数。
test('会话资源页注册并识别链接、工具、知识库、文件四个分类', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const pages = JSON.parse(readFileSync(join(root, 'pages.json'), 'utf8'))
  assert.ok(
    pages.pages.some((page) => page.path === 'pages/session-resources/index'),
    'pages.json 没有注册会话资源页'
  )
  const page = readFileSync(join(root, 'pages', 'session-resources', 'index.vue'), 'utf8')
  assert.ok(
    page.includes("const TABS = ['links', 'tools', 'knowledge', 'files']"),
    '页面没有声明四个分类'
  )
  assert.ok(
    page.includes('TABS.includes(options?.tab) ? options.tab : \'links\''),
    '页面没有按 tab 参数选择初始分类'
  )
  for (const tab of ['links', 'tools', 'knowledge', 'files']) {
    assert.ok(page.includes(`setTab('${tab}')`), `缺少 ${tab} 分类的切换入口`)
  }
  // 知识库与文件有独立完整页面，从会话资源页带 sessionId 跳过去。
  assert.ok(page.includes('/pages/knowledge/index?sessionId='), '知识库没有带上会话 ID 跳转')
  assert.ok(page.includes('/pages/files/index?sessionId='), '文件没有带上会话 ID 跳转')
  assert.ok(page.includes("'/pages/session-resources/index") === false, '页面不应反向跳自己')
})