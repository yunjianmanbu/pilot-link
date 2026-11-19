import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

const storage = new Map()
globalThis.uni = {
  getStorageSync: (key) => storage.get(key) || '',
  setStorageSync: (key, value) => storage.set(key, value)
}

const {
  loadButtonScheme,
  normalizeButtonScheme,
  saveButtonScheme
} = await import('../lib/storage.js')

const appVue = read('App.vue')

test('四个按钮方案都有独立 token 块', () => {
  for (const scheme of ['accent', 'mono', 'soft', 'outline']) {
    const start = appVue.indexOf(`.btn-scheme-${scheme} {`)
    assert.notEqual(start, -1, `缺少 .btn-scheme-${scheme}`)
    const block = appVue.slice(start, appVue.indexOf('}', start))
    for (const token of [
      '--btn-primary-bg',
      '--btn-primary-fg',
      '--btn-secondary-bg',
      '--btn-secondary-fg',
      '--btn-danger-bg',
      '--btn-danger-fg'
    ]) {
      assert.ok(block.includes(token), `${scheme} 方案缺少 ${token}`)
    }
  }
})

test('按钮尺度由全局 token 定义，页面不再各写一套', () => {
  for (const token of [
    '--btn-h-xs: 48rpx',
    '--btn-h-sm: 64rpx',
    '--btn-h-md: 72rpx',
    '--btn-h-lg: 80rpx',
    '--btn-font-sm: calc(23rpx * var(--font-scale))',
    '--btn-font-md: calc(25rpx * var(--font-scale))',
    '--btn-font-lg: calc(27rpx * var(--font-scale))',
    '--btn-radius-sm: 12rpx',
    '--btn-radius: 16rpx',
    '--btn-radius-pill: 999rpx'
  ]) {
    assert.ok(appVue.includes(token), `App.vue 缺少 ${token}`)
  }
  for (const selector of ['.btn {', '.chip {', '.text-btn {', '.btn.primary {', '.btn.ghost {']) {
    assert.notEqual(appVue.indexOf(selector), -1, `App.vue 缺少 ${selector}`)
  }
})

test('所有页面根节点都挂载按钮方案 class', () => {
  const pagesRoot = path.join(ROOT, 'pages')
  for (const name of fs.readdirSync(pagesRoot)) {
    const file = path.join(pagesRoot, name, 'index.vue')
    if (!fs.existsSync(file)) continue
    const source = fs.readFileSync(file, 'utf8')
    const firstLine = source.split('\n').find((line) => line.includes('<view')) || ''
    assert.ok(
      firstLine.includes("'btn-scheme-' + store.buttonScheme") ||
        firstLine.includes('"btn-scheme-" + store.buttonScheme'),
      `${name} 页面根节点缺少按钮方案 class`
    )
  }
})

test('按钮方案会被持久化并回退到跟随主题', () => {
  assert.equal(normalizeButtonScheme('mono'), 'mono')
  assert.equal(normalizeButtonScheme('soft'), 'soft')
  assert.equal(normalizeButtonScheme('outline'), 'outline')
  assert.equal(normalizeButtonScheme('accent'), 'accent')
  assert.equal(normalizeButtonScheme('unknown'), 'accent')
  assert.equal(normalizeButtonScheme(''), 'accent')

  assert.equal(loadButtonScheme(), 'accent')
  saveButtonScheme('outline')
  assert.equal(loadButtonScheme(), 'outline')
  saveButtonScheme('not-a-scheme')
  assert.equal(loadButtonScheme(), 'accent')
})

test('设置页提供四套按钮方案入口', () => {
  const settings = read('pages/settings/index.vue')
  assert.ok(settings.includes("t('按钮方案')"))
  for (const value of ['accent', 'mono', 'soft', 'outline']) {
    assert.ok(settings.includes(`value: '${value}'`), `缺少 ${value} 方案入口`)
  }
  assert.ok(settings.includes('chooseButtonScheme'))
  assert.ok(settings.includes('setButtonScheme'))
  assert.ok(settings.includes('store.buttonScheme === option.value'))
})

test('主要按钮实现都引用统一 token', () => {
  const expectations = [
    ['pages/chat/index.vue', '--btn-h-lg', '.send-btn {'],
    ['pages/chat/index.vue', '--btn-h-sm', '.pbtn {'],
    ['pages/chat/index.vue', '--btn-h-sm', '.todo-add-btn {'],
    ['pages/chat/index.vue', '--btn-h-sm', '.attach-btn {'],
    ['pages/settings/index.vue', '--btn-h-md', '.btn.small-btn {'],
    ['pages/sessions/index.vue', '--btn-h-md', '.device-action {'],
    ['pages/sessions/index.vue', '--btn-h-sm', '.action {'],
    ['pages/file/index.vue', '--btn-h-md', '.file-action {'],
    ['pages/evolution/index.vue', '--btn-h-sm', '.evo-btn {'],
    ['pages/feedback/index.vue', '--btn-h-lg', '.btn {'],
    ['components/app-dialog/app-dialog.vue', '--btn-h-lg', '.app-dialog-btn {'],
    ['components/app-time-sheet/app-time-sheet.vue', '--btn-h-lg', '.time-sheet-btn {']
  ]
  for (const [file, token, selector] of expectations) {
    const source = read(file)
    const start = source.indexOf(selector)
    assert.notEqual(start, -1, `${file} 缺少 ${selector}`)
    const block = source.slice(start, source.indexOf('}', start))
    assert.ok(block.includes(token), `${file} 的 ${selector} 未使用 ${token}`)
  }
})

test('固定高度按钮文字水平垂直居中', () => {
  const selectors = [
    ['pages/chat/index.vue', '.send-btn {'],
    ['pages/chat/index.vue', '.ocr-btn {'],
    ['pages/chat/index.vue', '.pbtn {'],
    ['pages/chat/index.vue', '.todo-add-btn {'],
    ['pages/file/index.vue', '.file-action {']
  ]
  for (const [file, selector] of selectors) {
    const source = read(file)
    const start = source.indexOf(selector)
    assert.notEqual(start, -1, `${file} 缺少 ${selector}`)
    const block = source.slice(start, source.indexOf('}', start))
    assert.match(block, /display:\s*(inline-)?flex/, `${file} 的 ${selector} 缺少 flex 布局`)
    assert.match(block, /align-items:\s*center/, `${file} 的 ${selector} 未垂直居中`)
    assert.match(block, /justify-content:\s*center/, `${file} 的 ${selector} 未水平居中`)
  }
})

test('设置页操作按钮按组排布，避免逐个叠加外边距', () => {
  const settings = read('pages/settings/index.vue')
  assert.ok(settings.includes('.card-actions {'))
  assert.ok(settings.includes('.card-actions.grid .btn'))
  assert.ok(settings.includes('<view class="card-actions'))
  const start = settings.indexOf('.btn.small-btn {')
  const block = settings.slice(start, settings.indexOf('}', start))
  assert.doesNotMatch(block, /margin-top/)
})

test('主按钮文字颜色来自 accent-ink 或方案 token', () => {
  const primary = appVue.slice(appVue.indexOf('.btn.primary {'), appVue.indexOf('}', appVue.indexOf('.btn.primary {')))
  assert.ok(primary.includes('--btn-primary-fg'))
  assert.doesNotMatch(primary, /color:\s*#fff/i)
})
