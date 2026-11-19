import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildKnowledgePairs,
  filterKnowledgePairs,
  highlightMarkdownNodes,
  highlightParts,
  pathKey,
  searchLocalKnowledge,
  sortKnowledgePairsNewestFirst
} from '../lib/knowledge.js'
import { renderMarkdown } from '../lib/markdown.js'

function message(partial) {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial
  }
}

function session(id, extra = {}) {
  return {
    id,
    title: `会话 ${id}`,
    workspacePath: 'C:\\work\\demo',
    lastModified: 1,
    ...extra
  }
}

function textMessage(id, role, text, createdAt = '2026-01-01T00:00:00.000Z') {
  return message({ id, role, createdAt, blocks: [{ type: 'text', text }] })
}

test('检索用户与 Pilot 正文并跳过工具过程和内部指令', () => {
  const sessions = [session('s1')]
  const histories = {
    s1: {
      messages: [
        textMessage('m1', 'user', '帮我把登录超时改成 30 秒'),
        textMessage('m2', 'assistant', '已修改登录超时配置'),
        message({ id: 'm3', role: 'tool', blocks: [{ type: 'text', text: '登录超时工具输出' }] }),
        message({
          id: 'm4',
          role: 'user',
          control: true,
          blocks: [{ type: 'text', text: '登录超时 继续' }]
        })
      ]
    }
  }

  const hits = searchLocalKnowledge(sessions, histories, '登录超时')
  assert.deepEqual(
    hits.map((hit) => hit.messageId),
    ['m2', 'm1']
  )
  assert.equal(hits[0].role, 'assistant')
  assert.equal(hits[0].sessionTitle, '会话 s1')
  assert.equal(hits[0].workspacePath, 'C:\\work\\demo')
  assert.match(hits[0].snippet, /登录超时/)
})

test('支持工作区、角色与时间筛选', () => {
  const sessions = [
    session('a', { lastModified: 2 }),
    session('b', { workspacePath: 'D:\\other', lastModified: 1 })
  ]
  const messages = [
    textMessage('u1', 'user', 'deploy token', '2026-01-01T00:00:00.000Z'),
    textMessage('a1', 'assistant', 'deploy token ok', '2026-02-01T00:00:00.000Z')
  ]
  const histories = { a: { messages }, b: { messages } }

  const byWorkspace = searchLocalKnowledge(sessions, histories, 'deploy', {
    filter: { workspacePath: 'd:/OTHER/' }
  })
  assert.deepEqual(byWorkspace.map((hit) => hit.sessionId), ['b', 'b'])

  const byRole = searchLocalKnowledge(sessions, histories, 'deploy', {
    filter: { role: 'assistant' }
  })
  assert.deepEqual(byRole.map((hit) => hit.role), ['assistant', 'assistant'])

  const bySince = searchLocalKnowledge(sessions, histories, 'deploy', {
    filter: { since: '2026-01-15T00:00:00.000Z' }
  })
  assert.deepEqual(bySince.map((hit) => hit.messageId), ['a1', 'a1'])

  const bySession = searchLocalKnowledge(sessions, histories, 'deploy', {
    filter: { sessionId: 'a' }
  })
  assert.deepEqual(bySession.map((hit) => hit.sessionId), ['a', 'a'])
})

test('每个会话最多返回 8 条，并遵守总条数上限', () => {
  const messages = Array.from({ length: 20 }, (_, index) =>
    textMessage(`m${index}`, 'assistant', 'needle')
  )
  const sessions = [
    session('a', { lastModified: 2 }),
    session('b', { lastModified: 1 })
  ]
  const histories = { a: { messages }, b: { messages } }

  assert.equal(searchLocalKnowledge(sessions, histories, 'needle', { limit: 5 }).length, 5)
  const all = searchLocalKnowledge(sessions, histories, 'needle', { limit: 120 })
  const perSession = {}
  for (const hit of all) perSession[hit.sessionId] = (perSession[hit.sessionId] || 0) + 1
  assert.equal(perSession.a, 8)
  assert.equal(perSession.b, 8)
})

test('没有关键词或没有缓存时返回空结果', () => {
  assert.deepEqual(searchLocalKnowledge([session('a')], {}, '   '), [])
  assert.deepEqual(searchLocalKnowledge([session('a')], {}, 'needle'), [])
})

test('高亮片段按关键词切开并保留大小写', () => {
  const parts = highlightParts('Fix the LOGIN bug, login again', 'login')
  assert.deepEqual(
    parts.map((part) => part.text),
    ['Fix the ', 'LOGIN', ' bug, ', 'login', ' again']
  )
  assert.deepEqual(
    parts.map((part) => part.hit),
    [false, true, false, true, false]
  )
  assert.deepEqual(highlightParts('nothing here', 'zzz'), [{ text: 'nothing here', hit: false }])
})

test('工作区路径比较忽略斜杠方向、盘符大小写和末尾分隔符', () => {
  assert.equal(pathKey('C:\\Work\\Demo\\'), 'c:/work/demo')
  assert.equal(pathKey('c:/work/demo'), 'c:/work/demo')
})

test('把每次指令和紧随其后的 Pilot 回复整理成对', () => {
  const pairs = buildKnowledgePairs([
    textMessage('u1', 'user', '帮我把登录超时改成 30 秒'),
    textMessage('a1', 'assistant', '先检查配置'),
    textMessage('a2', 'assistant', '已经改好了'),
    message({
      id: 't1',
      role: 'tool',
      blocks: [{ type: 'tool_result', content: '工具输出' }]
    }),
    textMessage('u2', 'user', '再跑一下测试'),
    textMessage('a3', 'assistant', '测试通过')
  ])

  assert.deepEqual(
    pairs.map((pair) => [pair.index, pair.instruction, pair.reply]),
    [
      [1, '帮我把登录超时改成 30 秒', '先检查配置\n\n已经改好了'],
      [2, '再跑一下测试', '测试通过']
    ]
  )
  assert.equal(pairs[0].instructionId, 'u1')
  assert.equal(pairs[0].replyId, 'a1')
  assert.equal(pairs[0].replyCount, 2)
  assert.equal(pairs[1].instructionAt, '2026-01-01T00:00:00.000Z')
})

test('跳过内部续跑指令，保留还没有回复的指令', () => {
  const pairs = buildKnowledgePairs([
    message({
      id: 'c1',
      role: 'user',
      control: true,
      blocks: [{ type: 'text', text: '继续' }]
    }),
    textMessage('u1', 'user', '还在等回复')
  ])
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0].instruction, '还在等回复')
  assert.equal(pairs[0].reply, '')
  assert.equal(pairs[0].replyCount, 0)
})

test('知识库搜索同时匹配指令和回复', () => {
  const pairs = buildKnowledgePairs([
    textMessage('u1', 'user', '把部署脚本改成静默模式'),
    textMessage('a1', 'assistant', '已经修改 deploy.ps1'),
    textMessage('u2', 'user', '登录超时是多少'),
    textMessage('a2', 'assistant', '30 秒')
  ])
  assert.deepEqual(
    filterKnowledgePairs(pairs, 'deploy').map((pair) => pair.index),
    [1]
  )
  assert.deepEqual(
    filterKnowledgePairs(pairs, '登录').map((pair) => pair.index),
    [2]
  )
  assert.equal(filterKnowledgePairs(pairs, '').length, 2)
})

test('知识库按 Markdown 渲染节点，搜索命中标在节点里', () => {
  const nodes = renderMarkdown('## 修复完成\n\n- 修改了 **deploy.ps1**\n- 新增 `--quiet`')
  assert.equal(nodes[0].name, 'h2')
  const source = JSON.stringify(nodes)
  // 语法标记已被解析，不能把 ** 和反引号原样显示出来。
  assert.equal(source.includes('**'), false)
  assert.equal(source.includes('`--quiet`'), false)

  const highlighted = highlightMarkdownNodes(nodes, 'deploy')
  const flat = JSON.stringify(highlighted)
  assert.ok(flat.includes('font-weight:600'))
  // 命中词被拆成高亮片段，剩余文本仍完整保留。
  assert.ok(flat.includes('deploy'))
  assert.ok(flat.includes('.ps1'))
  // 关键词以外的大写、换行等结构保持原样。
  assert.equal(highlightMarkdownNodes(nodes, ''), nodes)
  assert.deepEqual(
    highlightMarkdownNodes(nodes, '不存在的词'),
    nodes
  )
})

test('知识库展示按时间倒序，轮次编号保持原始时间顺序', () => {
  const pairs = [
    { key: 'a', index: 1, instructionAt: '2026-01-01T08:00:00.000Z', instruction: '第一轮' },
    { key: 'b', index: 2, instructionAt: '2026-01-02T08:00:00.000Z', instruction: '第二轮' },
    { key: 'c', index: 3, instructionAt: '2026-01-03T08:00:00.000Z', instruction: '第三轮' }
  ]
  const ordered = sortKnowledgePairsNewestFirst(pairs)
  assert.deepEqual(
    ordered.map((pair) => pair.key),
    ['c', 'b', 'a']
  )
  // 不修改调用方的数组，轮次编号也不跟着反转。
  assert.deepEqual(
    pairs.map((pair) => pair.key),
    ['a', 'b', 'c']
  )
  assert.deepEqual(
    ordered.map((pair) => pair.index),
    [3, 2, 1]
  )
  // 乱序输入也要按时间排出倒序。
  assert.deepEqual(
    sortKnowledgePairsNewestFirst([pairs[1], pairs[2], pairs[0]]).map((pair) => pair.key),
    ['c', 'b', 'a']
  )
  assert.deepEqual(sortKnowledgePairsNewestFirst(null), [])
})

test('时间戳缺失或相同时退回落轮次编号，顺序保持稳定', () => {
  const pairs = [
    { key: 'a', index: 1, instructionAt: '' },
    { key: 'b', index: 2, instructionAt: '' },
    { key: 'c', index: 3, instructionAt: '2026-01-03T08:00:00.000Z' }
  ]
  assert.deepEqual(
    sortKnowledgePairsNewestFirst(pairs).map((pair) => pair.key),
    ['c', 'b', 'a']
  )
  const same = [
    { key: 'x', index: 1, instructionAt: '2026-01-01T00:00:00.000Z' },
    { key: 'y', index: 1, instructionAt: '2026-01-01T00:00:00.000Z' }
  ]
  assert.deepEqual(
    sortKnowledgePairsNewestFirst(same).map((pair) => pair.key),
    ['y', 'x']
  )
})
