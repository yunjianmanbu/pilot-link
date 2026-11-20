import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { MANUAL_IMAGES, MANUAL_MARKDOWN } from '../lib/manual-content.js'
import { renderMarkdown } from '../lib/markdown.js'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, '..')
const docs = join(appRoot, '..', 'docs', '操作手册.md')
const settings = readFileSync(join(appRoot, 'pages', 'settings', 'index.vue'), 'utf8')
const pagesJson = readFileSync(join(appRoot, 'pages.json'), 'utf8')
const manualPage = readFileSync(join(appRoot, 'pages', 'manual', 'index.vue'), 'utf8')


// 拆仓后本仓库不含桌面端源码与工作区文档：读不到就跳过，而不是判失败。
const skipCross = existsSync(docs) ? false : '独立仓库不含桌面端源码（pilot/pilot）与工作区文档（pilot/docs），跳过跨仓库一致性检查'
test('内置使用手册与 docs/操作手册.md 保持同步', { skip: skipCross }, () => {
  const source = readFileSync(docs, 'utf8').replace(/\r\n?/g, '\n')
  assert.equal(MANUAL_MARKDOWN, source, '手册内容过期，运行 node pilot/scripts/gen-manual.mjs')
})

test('使用手册页已在 pages.json 注册', () => {
  assert.match(pagesJson, /"path":\s*"pages\/manual\/index"/)
})

test('帮助分区同时提供帮助与反馈、使用手册', () => {
  const helpStart = settings.indexOf("activeSection === 'settings-help'")
  assert.ok(helpStart >= 0, '设置页缺少帮助分区')
  const helpBlock = settings.slice(helpStart, settings.indexOf('<app-dialog', helpStart))
  assert.match(helpBlock, /t\('帮助与反馈'\)/)
  assert.match(helpBlock, /t\('问题反馈 \/ 提需求 \/ 提建议'\)/)
  assert.match(helpBlock, /t\('使用手册'\)/)
  assert.match(helpBlock, /openManual/)
  assert.match(settings, /openManual\(\)\s*\{[^}]*pages\/manual\/index/)
})

test('使用手册页用内置 Markdown 渲染，离线可看', { skip: skipCross }, () => {
  assert.match(manualPage, /MANUAL_MARKDOWN/)
  assert.match(manualPage, /renderMarkdown\(MANUAL_MARKDOWN/)
  assert.match(manualPage, /allowImages:\s*true/)
  assert.match(manualPage, /resolveImage/)
  const nodes = renderMarkdown(MANUAL_MARKDOWN, { theme: 'dark' })
  assert.ok(nodes.length > 20, `手册渲染结果过少：${nodes.length}`)
  assert.equal(nodes[0]?.name, 'h1')
  assert.ok(
    JSON.stringify(nodes).includes('手机端'),
    '使用手册里应包含手机端操作说明'
  )
})

test('手册引用的每张截图都已内联为 data URL', () => {
  const references = [...MANUAL_MARKDOWN.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map(
    (match) => match[1]
  )
  assert.ok(references.length >= 10, `手册截图过少：${references.length}`)
  for (const src of references) {
    const data = MANUAL_IMAGES[src]
    assert.ok(data, `缺少内联截图：${src}，运行 node pilot/scripts/gen-manual.mjs`)
    assert.match(data, /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/)
  }
  assert.deepEqual(
    Object.keys(MANUAL_IMAGES).sort(),
    [...new Set(references)].sort(),
    'MANUAL_IMAGES 与手册图片引用不一致'
  )
})

test('手册按图片解析模式渲染出全部截图节点', { skip: skipCross }, () => {
  const references = [...MANUAL_MARKDOWN.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)]
  const nodes = renderMarkdown(MANUAL_MARKDOWN, {
    theme: 'dark',
    allowImages: true,
    resolveImage: (src) => MANUAL_IMAGES[src] || ''
  })
  const images = []
  const walk = (list) => {
    for (const node of list || []) {
      if (node?.name === 'img') images.push(node)
      walk(node?.children)
    }
  }
  walk(nodes)
  assert.equal(images.length, references.length)
  for (const image of images) assert.match(image.attrs.src, /^data:image\//)
})
