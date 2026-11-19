/**
 * Markdown 渲染节点测试：输出必须始终是受控的 rich-text 节点，
 * 常见语法能正确转换，原始 HTML 只能作为文本出现。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { renderMarkdown } from '../lib/markdown.js'

function findNode(nodes, name) {
  for (const node of nodes || []) {
    if (node?.name === name) return node
    const found = findNode(node?.children, name)
    if (found) return found
  }
  return null
}

function collectText(nodes) {
  let value = ''
  for (const node of nodes || []) {
    if (node?.type === 'text') value += node.text
    else value += collectText(node?.children)
  }
  return value
}

test('段落与行内语法', () => {
  const nodes = renderMarkdown('你好 **世界**，这是 *斜体* 和 `code`。')
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].name, 'p')
  assert.equal(collectText(nodes), '你好 世界，这是 斜体 和 code。')
  assert.ok(findNode(nodes, 'strong'))
  assert.ok(findNode(nodes, 'em'))
  assert.equal(findNode(nodes, 'code').children[0].text, 'code')
})

test('标题最多渲染为 h4', () => {
  const nodes = renderMarkdown('# 一级\n\n###### 六级')
  assert.equal(nodes[0].name, 'h1')
  assert.equal(nodes[1].name, 'h4')
  assert.equal(collectText([nodes[0]]), '一级')
})

test('代码块保留原始内容和缩进', () => {
  const nodes = renderMarkdown('```js\nconst a = 1\n  console.log(a)\n```')
  const pre = findNode(nodes, 'pre')
  assert.ok(pre)
  assert.equal(findNode(pre.children, 'code').children[0].text, 'const a = 1\n  console.log(a)')
})

test('无序 / 有序列表与嵌套', () => {
  const unordered = renderMarkdown('- 一\n- 二\n  - 二点一')
  const ul = findNode(unordered, 'ul')
  assert.ok(ul)
  assert.equal(ul.children.length, 2)
  assert.ok(findNode(ul.children[1].children, 'ul'))

  const ordered = renderMarkdown('1. 第一步\n2. 第二步')
  const ol = findNode(ordered, 'ol')
  assert.ok(ol)
  assert.equal(ol.children.length, 2)
})

test('表格渲染为 thead / tbody', () => {
  const nodes = renderMarkdown('| 名称 | 值 |\n| --- | --- |\n| a | 1 |\n| b | 2 |')
  const table = findNode(nodes, 'table')
  assert.ok(table)
  assert.ok(findNode(table.children, 'thead'))
  const body = findNode(table.children, 'tbody')
  assert.equal(body.children.length, 2)
  assert.equal(collectText([body.children[0]]), 'a1')
})

test('引用与分隔线', () => {
  const nodes = renderMarkdown('> 引用内容\n\n---')
  assert.equal(findNode(nodes, 'blockquote').children[0].name, 'p')
  assert.equal(collectText([findNode(nodes, 'blockquote')]), '引用内容')
  assert.ok(findNode(nodes, 'hr'))
})

test('链接显示为带标题的文本节点', () => {
  const nodes = renderMarkdown('见 [文档](https://example.com/a) 和 <https://example.com/b>')
  const links = []
  const walk = (list) => {
    for (const node of list || []) {
      if (node?.name === 'span' && node.attrs?.title) links.push(node)
      walk(node?.children)
    }
  }
  walk(nodes)
  assert.equal(links.length, 2)
  assert.equal(collectText([links[0]]), '文档')
  assert.equal(links[0].attrs.title, 'https://example.com/a')
  assert.equal(collectText([links[1]]), 'https://example.com/b')
})

test('图片默认不解析，避免聊天内容触发远程图片请求', () => {
  const nodes = renderMarkdown('![截图](https://example.com/a.jpg)')
  assert.equal(findNode(nodes, 'img'), null)
  assert.equal(collectText(nodes), '!截图')
})

test('显式允许时通过 resolveImage 渲染内联 data URL 图片并保留图注', () => {
  const resolved = []
  const nodes = renderMarkdown('![手机端设置](assets/manual/phone-settings.jpg)', {
    allowImages: true,
    resolveImage: (src) => {
      resolved.push(src)
      return 'data:image/jpeg;base64,AAAA'
    }
  })
  assert.deepEqual(resolved, ['assets/manual/phone-settings.jpg'])
  const img = findNode(nodes, 'img')
  assert.ok(img)
  assert.equal(img.attrs.src, 'data:image/jpeg;base64,AAAA')
  assert.equal(img.attrs.alt, '手机端设置')
  assert.match(collectText(nodes), /手机端设置/)
})

test('图片解析失败或不是 data URL 时只保留图注', () => {
  for (const resolveImage of [
    () => 'https://example.com/a.jpg',
    () => '',
    () => {
      throw new Error('boom')
    },
    undefined
  ]) {
    const nodes = renderMarkdown('![图注](assets/a.jpg)', { allowImages: true, resolveImage })
    assert.equal(findNode(nodes, 'img'), null)
    assert.equal(collectText(nodes), '图注')
  }
})

test('原始 HTML 只作为文本，不生成标签节点', () => {
  const nodes = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>')
  assert.equal(findNode(nodes, 'script'), null)
  assert.equal(findNode(nodes, 'img'), null)
  assert.match(collectText(nodes), /<script>alert\(1\)<\/script>/)
  assert.match(collectText(nodes), /<img src=x onerror=alert\(1\)>/)
})

test('空文本返回空节点', () => {
  assert.deepEqual(renderMarkdown(''), [])
  assert.deepEqual(renderMarkdown(null), [])
})

test('浅色主题的标题、表格和代码块使用浅底深字', () => {
  const nodes = renderMarkdown('# 标题\n\n| 名称 | 值 |\n| --- | --- |\n| a | 1 |\n\n```js\nconst a = 1\n```', {
    theme: 'light'
  })
  assert.match(nodes[0].attrs.style, /color:#000000/)
  assert.match(findNode(nodes, 'th').attrs.style, /background:#f5f5f5/)
  assert.match(findNode(nodes, 'td').attrs.style, /color:#666666/)
  assert.match(findNode(nodes, 'pre').attrs.style, /background:#f7f7f7/)
  assert.match(findNode(nodes, 'code').attrs.style, /color:#111111/)
})

test('深色主题保持浅色文字，默认也是深色', () => {
  const explicit = renderMarkdown(
    '# 标题\n\n| 名称 | 值 |\n| --- | --- |\n| a | 1 |\n\n```js\nconst a = 1\n```',
    { theme: 'dark' }
  )
  const fallback = renderMarkdown('# 标题')
  assert.match(explicit[0].attrs.style, /color:#ffffff/)
  assert.match(findNode(explicit, 'th').attrs.style, /background:#131313/)
  assert.match(findNode(explicit, 'td').attrs.style, /color:#d4d4d4/)
  assert.match(findNode(explicit, 'pre').attrs.style, /border:1px solid #292929/)
  assert.match(findNode(explicit, 'code').attrs.style, /color:#e6e6e6/)
  assert.deepEqual(fallback, renderMarkdown('# 标题', { theme: 'dark' }))
})
