/**
 * 会话正文里的网址要能点开。
 *
 * 这两处曾经点不动：用户 / 系统消息是纯文本 `<text>`，链接只是一串字；
 * 助手回复走 rich-text，里面的节点没有点击事件。现在用户与系统消息按
 * 「文字 / 链接」片段渲染，链接走和链接按钮同一条 previewLink 链路。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'pages', 'chat', 'index.vue'), 'utf8')

test('用户与系统消息的正文按片段渲染，链接内联可点', () => {
  assert.match(source, /import \{ extractLinks, linkLabel, linkifySegments \} from '\.\.\/\.\.\/lib\/media\.js'/)
  assert.match(source, /segments: message\.role === 'assistant' \? null : linkifySegments\(text\)/)
  assert.match(source, /@click\.stop="openInlineLink\(seg\.url\)"/)
  assert.match(source, /@longpress\.stop="openInlineLinkMenu\(seg\.url\)"/)
  // 链接段要拦住 touchstart，否则气泡的长按手势会同时弹出消息菜单。
  assert.match(source, /@touchstart\.stop/)
})

test('内联链接走和链接按钮同一条预览链路', () => {
  assert.match(
    source,
    /openInlineLink\(url\) \{[\s\S]*?this\.previewLink\(target, linkLabel\(target\)\)/
  )
  assert.match(
    source,
    /openInlineLinkMenu\(url\) \{[\s\S]*?this\.openLinkMenu\(\{ url: target, label: linkLabel\(target\) \}\)/
  )
  assert.match(source, /previewLink\(url, label\) \{[\s\S]*?openWebPreview\(url, label\)/)
})

test('正文里的链接有下划线，用户气泡沿用气泡的文字色', () => {
  assert.match(source, /\.msg-link \{[^}]*text-decoration: underline;/)
  assert.match(source, /\.user-bubble \.msg-link \{[^}]*color: var\(--accent-ink\);/)
})

test('系统消息也按片段渲染，多个文本块之间保留换行', () => {
  assert.match(source, /segmentsOf\(item\)/)
  assert.match(source, /rows\.push\(\{ index: `\$\{part\.key\}-sep`, kind: 'text', text: '\\n' \}\)/)
})
