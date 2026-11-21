import test from 'node:test'
import assert from 'node:assert/strict'

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