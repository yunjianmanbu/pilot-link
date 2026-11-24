import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * 「连接 Pilot」（未配对首页）的顶部图标与扫码按钮布局。
 *
 * 两个真实踩过的坑写进断言：
 *   1. 顶部原来是一个 CSS 画的绿方块里写字母 "C"，和 App 图标（绿底白色 P + 右下白点）不一致；
 *   2. 「扫描电脑上的二维码」按钮是 inline-flex，宽度跟文字走，缩在卡片左侧，左右不对称。
 * 这里只做静态断言，渲染结果由 `tmp/verify-pair-page.mjs` 在真实 H5 产物里量。
 */
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const source = readFileSync(join(root, 'pages', 'pair', 'index.vue'), 'utf8')
const appSource = readFileSync(join(root, 'App.vue'), 'utf8')

/** 取 `.logo { ... }` 这条规则体。 */
function ruleBody(css, selector) {
  const start = css.indexOf(`${selector} {`)
  assert.ok(start >= 0, `找不到样式规则 ${selector}`)
  const end = css.indexOf('}', start)
  return css.slice(start, end)
}

test('顶部图标使用 App 品牌图，不再用 CSS 字块', () => {
  assert.match(source, /<image class="logo" src="\/static\/icons\/192\.png" mode="aspectFit" \/>/)
  assert.doesNotMatch(source, /<view class="logo">C<\/view>/)

  const rule = ruleBody(source, '.logo')
  assert.match(rule, /width:\s*112rpx/)
  assert.match(rule, /height:\s*112rpx/)
  // 图片自带绿底与圆角，样式里不能再铺主题渐变，否则会出现两层底色。
  assert.doesNotMatch(rule, /--accent-gradient/)
  assert.doesNotMatch(rule, /font-size/)
})

test('品牌图标文件是 192×192 的 PNG', () => {
  const file = join(root, 'static', 'icons', '192.png')
  const buffer = readFileSync(file)
  assert.ok(statSync(file).size > 500, '图标文件过小，可能是空白占位')
  assert.equal(buffer.toString('hex', 0, 8), '89504e470d0a1a0a', '不是 PNG')
  assert.equal(buffer.readUInt32BE(16), 192, '图标宽度不是 192')
  assert.equal(buffer.readUInt32BE(20), 192, '图标高度不是 192')
})

test('扫码与开始配对按钮铺满卡片，左右对称', () => {
  assert.match(source, /<button v-if="!webRuntime" class="btn primary big block"/)
  assert.match(source, /<button class="btn primary big block" :disabled="store\.pairBusy" @click="confirm">/)
  // block 只补宽度，高度/字号仍由 .big 决定；两者缺一按钮就会缩回内容宽度。
  assert.match(appSource, /\.btn\.block\s*{\s*width:\s*100%;?\s*}/)
  assert.match(source, /\.big\s*{[^}]*height:\s*92rpx/)
})
