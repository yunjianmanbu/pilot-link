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
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'components',
      'session-resources',
      'session-resources.vue'
    ),
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

// 五个分类都只由一个组件渲染，页面壳只负责把 URL 参数传进去：
// 合并页带标签条，行内快捷入口各进一个独立页面。
test('会话资源组件注册并识别链接、工具、记忆、知识库、文件五个分类', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const pages = JSON.parse(readFileSync(join(root, 'pages.json'), 'utf8'))
  const panel = readFileSync(
    join(root, 'components', 'session-resources', 'session-resources.vue'),
    'utf8'
  )
  assert.ok(
    panel.includes("const TABS = ['links', 'tools', 'memory', 'knowledge', 'files']"),
    '组件没有声明五个分类'
  )
  assert.ok(
    panel.includes("TABS.includes(this.startTab) ? this.startTab : 'links'"),
    '组件没有按 startTab 选择初始分类'
  )
  for (const tab of ['links', 'tools', 'memory', 'knowledge', 'files']) {
    assert.ok(panel.includes(`setTab('${tab}')`), `缺少 ${tab} 分类的切换入口`)
  }
  // 独立页面只有一种分类，标签条不能再出现。
  assert.ok(panel.includes('v-if="showTabs"'), '标签条没有按独立页面隐藏')
  assert.ok(panel.includes('return !this.single'), 'showTabs 没有依据 single 判断')
  // 知识库与文件有独立完整页面，从会话资源页带 sessionId 跳过去。
  assert.ok(panel.includes('/pages/knowledge/index?sessionId='), '知识库没有带上会话 ID 跳转')
  assert.ok(panel.includes('/pages/files/index?sessionId='), '文件没有带上会话 ID 跳转')

  // 合并页 + 三个独立页：链接 / 工具 / 记忆各一个路由。
  for (const [route, tab] of [
    ['pages/session-resources/index', null],
    ['pages/session-links/index', 'links'],
    ['pages/session-tools/index', 'tools'],
    ['pages/session-memory/index', 'memory']
  ]) {
    assert.ok(
      pages.pages.some((page) => page.path === route),
      `pages.json 没有注册 ${route}`
    )
    const file = readFileSync(join(root, ...route.split('/').slice(0, -1), 'index.vue'), 'utf8')
    assert.ok(file.includes('<session-resources'), `${route} 没有渲染会话资源面板`)
    if (!tab) continue
    assert.ok(file.includes(`start-tab="${tab}"`), `${route} 没有固定 ${tab} 分类`)
    assert.ok(/\sstandalone/.test(file), `${route} 没有关掉标签条`)
  }
})

// 新会话根本没用到记忆时，「记忆」点进去不能是一片空白。
test('会话记忆为空时用项目记忆兜底，并先补齐工作区路径', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const panel = readFileSync(
    join(root, 'components', 'session-resources', 'session-resources.vue'),
    'utf8'
  )
  // 会话记忆返回空 → 再去拉工作区级记忆（在线才拉，离线拉也只会报错）。
  const loadStart = panel.indexOf('async loadSessionMemory() {')
  assert.notEqual(loadStart, -1, '缺少 loadSessionMemory')
  const loadBody = panel.slice(loadStart, panel.indexOf('\n    },', loadStart))
  assert.ok(
    /if \(rows\.length === 0[^\n]*\)\s*await this\.loadMemoryFallback\(seq\)/.test(loadBody),
    '会话记忆为空时没有兜底展示项目记忆'
  )
  // 电脑端没响应时先用手机上的记忆快照上屏，否则页面会空等十几秒。
  assert.ok(loadBody.includes('cachedSessionMemory(this.sessionId)'), '没有先用缓存记忆上屏')
  assert.ok(loadBody.includes('loadSessionMemoryDetails(this.sessionId)'), '没有用带 source 的记忆读取')
  // 中继「假在线」恢复后要补读：只监听 connectionState 会让页面永久停在空态。
  assert.ok(panel.includes("'store.agentOnline'(online)"), '没有监听电脑端在线状态补读')
  assert.ok(panel.includes('retryWhenStale()'), '缺少链路恢复后的补读逻辑')
  // 兜底前先向电脑端要一次工作区路径，否则从任务卡片进来永远拿不到路径。
  const fallbackStart = panel.indexOf('async loadMemoryFallback(seq) {')
  assert.notEqual(fallbackStart, -1, '缺少 loadMemoryFallback')
  const fallbackBody = panel.slice(fallbackStart, panel.indexOf('\n    },', fallbackStart))
  assert.ok(fallbackBody.includes('if (!this.workspacePath) await this.resolveWorkspace()'), '兜底前没有补齐工作区路径')
  assert.ok(fallbackBody.includes('await loadMemory(path)'), '兜底没有读取项目记忆')
  assert.ok(fallbackBody.includes('this.memoryTotal = this.memoryFallback.length'), '兜底条目没有计入条数')
  // 渲染与计数都走 memoryRows，避免「0 条记忆」却列着一屏内容。
  assert.ok(panel.includes('return this.memories.length > 0 ? this.memories : this.memoryFallback'), 'memoryRows 没有兜底')
  assert.ok(panel.includes('v-for="entry in memoryRows"'), '记忆列表没有渲染兜底条目')
  assert.ok(panel.includes("if (this.tab === 'memory') return this.memoryRows"), '记忆条数没有按兜底列表统计')
})

// 链接点开先进 App 内置浏览器，内置预览不可用才交给系统浏览器。
test('链接点开走内置网页预览，失败才交给系统浏览器', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const panel = readFileSync(
    join(root, 'components', 'session-resources', 'session-resources.vue'),
    'utf8'
  )
  assert.ok(
    panel.includes("import { fileActionLabel, openWebPreview } from '../../lib/files.js'"),
    '没有引入内置网页预览'
  )
  const openStart = panel.indexOf('    openLink(link) {')
  assert.notEqual(openStart, -1, '缺少 openLink')
  const openBody = panel.slice(openStart, panel.indexOf('\n    },', openStart))
  assert.ok(openBody.includes('openWebPreview(url'), '链接没有走内置预览')
  assert.ok(openBody.includes('.catch('), '内置预览失败时没有回退')
  const externalStart = panel.indexOf('    openLinkExternal(url, link) {')
  assert.notEqual(externalStart, -1, '缺少 openLinkExternal')
  const externalBody = panel.slice(externalStart, panel.indexOf('\n    },', externalStart))
  assert.ok(externalBody.includes('plus.runtime.openURL'), '回退没有交给系统浏览器')
  // 内置预览本身仍然存在，且是 WebView 而不是跳出 App。
  const files = readFileSync(join(root, 'lib', 'files.js'), 'utf8')
  assert.ok(files.includes('export function openWebPreview(url, name, options = {})'), 'lib/files.js 没有内置预览入口')
})

// 模板里调用的函数必须挂在实例上：Vue 3 的模板不认模块作用域的 import，
// 漏挂一个就会渲染抛错、整页只剩背景色（链接页/记忆页空白页的真实成因）。
test('模板里调用的 relativeTime 已挂到 methods，不会再整页渲染失败', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  for (const file of [
    'components/session-resources/session-resources.vue',
    'pages/knowledge/index.vue'
  ]) {
    const source = readFileSync(join(root, file), 'utf8')
    const template = source.slice(0, source.lastIndexOf('</template>'))
    if (template.includes('relativeTime(')) {
      const methodsStart = source.indexOf('  methods: {')
      assert.notEqual(methodsStart, -1, `${file} 没有 methods 段`)
      const methodsBody = source.slice(methodsStart)
      assert.match(
        methodsBody,
        /methods: \{[\s\S]*?\n {4}relativeTime,/,
        `${file} 模板调了 relativeTime()，但没挂到 methods（会整页白屏）`
      )
    }
  }
})