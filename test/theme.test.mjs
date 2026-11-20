import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * 手机端的配色来自 App.vue 里的 CSS 变量，桌面客户端的是
 * pilot/pilot/src/renderer/src/styles.css。两端保持同一套色值，
 * 这里直接读两边的样式文件比对，避免以后改了一边忘了另一边。
 */
const here = dirname(fileURLToPath(import.meta.url))
const APP_VUE = join(here, '..', 'App.vue')
const CLIENT_CSS = join(here, '..', '..', 'pilot', 'src', 'renderer', 'src', 'styles.css')
const PAGES_JSON = join(here, '..', 'pages.json')

/** 取某个选择器块里的自定义属性，返回 { --bg: '#131417', ... }。 */
function variables(block) {
  const found = {}
  for (const match of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    found[match[1]] = match[2].trim()
  }
  return found
}

/** 截取从 selector 开始到第一个配对的右花括号为止的块。 */
function blockOf(css, selector) {
  const start = css.indexOf(selector)
  assert.notEqual(start, -1, `找不到选择器 ${selector}`)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    else if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, index)
    }
  }
  throw new Error(`选择器 ${selector} 的样式块没有闭合`)
}

const appVue = readFileSync(APP_VUE, 'utf8')
const clientCss = existsSync(CLIENT_CSS) ? readFileSync(CLIENT_CSS, 'utf8') : null
const pagesJson = readFileSync(PAGES_JSON, 'utf8')

const appDark = variables(blockOf(appVue, 'page,\n:root'))
const appLight = variables(blockOf(appVue, '\n.theme-light {'))
const clientDark = clientCss ? variables(blockOf(clientCss, ':root {')) : {}
const clientLight = clientCss ? variables(blockOf(clientCss, ":root[data-theme='light']")) : {}

// 两端的变量名并不完全一样：客户端的 panel 在手机端叫 surface，faint 叫 dim。
// 这些成对变量每增加一条，就少一次“改了一边忘了另一边”的机会。
const DARK_PAIRS = [
  ['--bg', '--bg'],
  ['--page', '--page'],
  ['--surface', '--panel'],
  ['--surface-2', '--panel-2'],
  ['--surface-3', '--panel-3'],
  ['--surface-float', '--surface'],
  ['--hover', '--hover'],
  ['--hover-strong', '--hover-strong'],
  ['--border', '--border'],
  ['--line', '--line'],
  ['--line-strong', '--line-strong'],
  ['--text', '--text'],
  ['--text-strong', '--text'],
  ['--muted', '--muted'],
  ['--dim', '--faint'],
  ['--accent', '--accent']
]
const LIGHT_PAIRS = DARK_PAIRS


// 拆仓后本仓库不含桌面端源码与工作区文档：读不到就跳过，而不是判失败。
const skipCross = clientCss != null ? false : '独立仓库不含桌面端源码（pilot/pilot）与工作区文档（pilot/docs），跳过跨仓库一致性检查'
test('手机端深色主题与客户端同色', { skip: skipCross }, () => {
  for (const [appKey, clientKey] of DARK_PAIRS) {
    assert.equal(
      appDark[appKey]?.toLowerCase(),
      clientDark[clientKey]?.toLowerCase(),
      `${appKey} 与客户端 ${clientKey} 不一致`
    )
  }
})

test('手机端浅色主题与客户端同色', { skip: skipCross }, () => {
  for (const [appKey, clientKey] of LIGHT_PAIRS) {
    assert.equal(
      appLight[appKey]?.toLowerCase(),
      clientLight[clientKey]?.toLowerCase(),
      `浅色 ${appKey} 与客户端 ${clientKey} 不一致`
    )
  }
})

test('手机端次级文字与客户端同样可读', () => {
  // 移动端没有 --panel-hover 这类悬浮底色，卡片最深的底就是 surface-3，
  // 所以弱化文字只要在 surface-3 上达到 4.5:1 就算达标。
  for (const [mode, palette] of [
    ['深色', appDark],
    ['浅色', appLight]
  ]) {
    for (const token of ['--text', '--muted', '--dim']) {
      const ratio = contrastRatio(palette[token], palette['--surface-3'])
      assert.ok(
        ratio >= 4.5,
        `${mode} ${token} 在最深卡片上的对比度只有 ${ratio.toFixed(2)}，低于 4.5`
      )
    }
  }
})

test('暖白的次级文字同样可读', () => {
  for (const [mode, selector] of [
    ['深色', '\n.accent-claude {'],
    ['浅色', '\n.theme-light.accent-claude {']
  ]) {
    const palette = variables(blockOf(appVue, selector))
    for (const token of ['--muted', '--dim']) {
      const ratio = contrastRatio(palette[token], palette['--surface-3'])
      assert.ok(
        ratio >= 4.5,
        `${mode} Claude ${token} 的对比度只有 ${ratio.toFixed(2)}，低于 4.5`
      )
    }
  }
})

test('功能色在深色和浅色下都独立存在', () => {
  for (const [mode, palette] of [
    ['深色', appDark],
    ['浅色', appLight]
  ]) {
    const keys = ['--knowledge', '--file', '--pause', '--stop', '--resume', '--review']
    for (const key of keys) assert.ok(palette[key], `${mode}缺少 ${key}`)
    assert.equal(new Set(keys.map((key) => palette[key])).size, keys.length, `${mode}功能色重复`)
  }
})

test('强调色上的文字使用 accent-ink，不写死白色', { skip: skipCross }, () => {
  assert.equal(appDark['--accent-ink']?.toLowerCase(), clientDark['--accent-ink']?.toLowerCase())
  assert.equal(appLight['--accent-ink']?.toLowerCase(), clientLight['--accent-ink']?.toLowerCase())
  assert.doesNotMatch(appVue, /\.btn\.primary\s*\{[^}]*color:\s*#fff/i)
})

test('pages.json 的窗口底色跟随深色主题', () => {
  const matches = pagesJson.match(/"backgroundColor(?:Top|Bottom)?"\s*:\s*"([^"]+)"/g) || []
  assert.ok(matches.length > 0, 'pages.json 里没有 backgroundColor')
  for (const entry of matches) {
    assert.match(entry, new RegExp(appDark['--bg'], 'i'))
  }
})

/** 从 linear-gradient(...) 里按顺序取出两个色值。 */
function gradientStops(value) {
  return [...String(value).matchAll(/#[0-9a-f]{6}/gi)].map((match) => match[0].toLowerCase())
}

test('单边分隔线与虚线空态框用 --line，不用永远透明的 --border', () => {
  // 两端都把 --border 定成 transparent（卡片靠色阶分层），所以只画一边的
  // 边框一旦用 --border 就等于什么都不画，聊天分隔、设置分组、模块检查
  // 卡片之间会粘成一整块。桌面端由 theme-tokens.test.ts 守，这里守手机端。
  const pagesDir = join(here, '..', 'pages')
  const files = [APP_VUE]
  for (const entry of readdirSync(pagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const page = join(pagesDir, entry.name, 'index.vue')
    if (existsSync(page)) files.push(page)
  }
  const offenders = []
  for (const file of files) {
    const name = file.split(/[\\/]/).slice(-2).join('/')
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(
      /border-(?:top|bottom|left|right)\s*:\s*[\d.]+r?px\s+(?:[a-z]+\s+)?(?:solid|dashed|dotted)\s+var\(--border\)/g
    )) {
      offenders.push(`${name}: ${match[0]}`)
    }
    // 虚线空态框：`border: 1rpx dashed var(--border)` 同样画不出东西。
    for (const match of source.matchAll(
      /border\s*:\s*[\d.]+r?px\s+(?:dashed|dotted)\s+var\(--border\)/g
    )) {
      offenders.push(`${name}: ${match[0]}`)
    }
    // 用 background 画 1rpx 分隔线（pair 页 .divider）也会静默消失。
    for (const match of source.matchAll(
      /background(?:-color)?\s*:\s*var\(--border(?:-strong)?\)/g
    )) {
      offenders.push(`${name}: ${match[0]}`)
    }
    // --border-strong 名字更像「更重的线」，实际也在每个调色板里是 transparent。
    for (const match of source.matchAll(/var\(--border-strong[^)]*\)/g)) {
      offenders.push(`${name}: ${match[0]}`)
    }
  }
  assert.deepEqual(offenders, [], `分隔线不该用透明 token：${offenders.slice(0, 4).join(' | ')}`)
  for (const [mode, palette] of [
    ['深色', appDark],
    ['浅色', appLight]
  ]) {
    for (const token of ['--line', '--line-strong']) {
      assert.ok(palette[token], `${mode}缺少 ${token}`)
      assert.notEqual(palette[token], 'transparent', `${mode} ${token} 不能透明`)
    }
  }
})

test('两端的分隔线随对比度档同步递增', { skip: skipCross }, () => {
  // 桌面端手写块与两端生成层都由 gen-appearance-css.mjs 产出，但取值写在
  // 脚本的 LINE_ALPHAS 里；这里比对最终 CSS 里的实际值，一旦只改了一端就报。
  const declOf = (css, selector, token) => {
    const palette = variables(blockOf(css, selector))
    return palette[token]
  }
  for (const level of ['low', 'standard', 'high']) {
    for (const [mode, appSel, clientSel] of [
      ['深色', `.contrast-${level} {`, `:root[data-contrast='${level}'] {`],
      ['浅色', `.theme-light.contrast-${level} {`, `:root[data-theme='light'][data-contrast='${level}'] {`]
    ]) {
      for (const token of ['--line', '--line-strong']) {
        assert.equal(
          declOf(appVue, appSel, token)?.replace(/\s+/g, ' '),
          declOf(clientCss, clientSel, token)?.replace(/\s+/g, ' '),
          `${mode} ${level} 的 ${token} 两端不一致`
        )
      }
    }
  }
  const alpha = (value) => Number(/rgba\([^)]*?([\d.]+)\s*\)$/.exec(value)[1])
  for (const [mode, sel] of [
    ['深色', (level) => `.contrast-${level} {`],
    ['浅色', (level) => `.theme-light.contrast-${level} {`]
  ]) {
    const [low, standard, high] = ['low', 'standard', 'high'].map((level) =>
      alpha(declOf(appVue, sel(level), '--line'))
    )
    assert.ok(
      low < standard && standard < high,
      `${mode} 行线强度未随对比度递增：${low} / ${standard} / ${high}`
    )
  }
})

function rgbOf(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex).trim())
  assert.ok(match, `无效色值 ${hex}`)
  return [0, 2, 4].map((index) => parseInt(match[1].slice(index, index + 2), 16))
}

function luminance(hex) {
  return rgbOf(hex)
    .map((value) => value / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
}

function contrastRatio(foreground, background) {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

function colorDistance(a, b) {
  const left = rgbOf(a)
  const right = rgbOf(b)
  return Math.sqrt(left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0))
}

for (const name of [
  'pine',
  'indigo',
  'clay',
  'ocean',
  'moss',
  'plum',
  'rose',
  'sand',
  'orange',
  'celadon',
  'claude'
]) {
  test(`手机端 ${name} 主题色与客户端一致`, { skip: skipCross }, () => {
    const appDarkAccent = variables(blockOf(appVue, `\n.accent-${name} {`))
    const appLightAccent = variables(blockOf(appVue, `\n.theme-light.accent-${name} {`))
    const clientDarkAccent = variables(blockOf(clientCss, `:root[data-accent='${name}']`))
    const clientLightAccent = variables(
      blockOf(clientCss, `:root[data-theme='light'][data-accent='${name}']`)
    )

    for (const [appAccent, clientAccent] of [
      [appDarkAccent, clientDarkAccent],
      [appLightAccent, clientLightAccent]
    ]) {
      assert.equal(appAccent['--accent']?.toLowerCase(), clientAccent['--accent']?.toLowerCase())
      assert.equal(
        appAccent['--accent-soft']?.toLowerCase(),
        clientAccent['--accent-strong']?.toLowerCase()
      )
      assert.equal(
        appAccent['--accent-ink']?.toLowerCase(),
        clientAccent['--accent-ink']?.toLowerCase()
      )
      assert.deepEqual(gradientStops(appAccent['--accent-gradient']), [
        clientAccent['--sidebar-primary-from']?.toLowerCase(),
        clientAccent['--sidebar-primary-to']?.toLowerCase()
      ])
    }
  })
}

const THEME_BACKGROUND_PAIRS = [
  ['--bg', '--bg'],
  ['--page', '--page'],
  ['--surface-float', '--surface'],
  ['--surface', '--panel'],
  ['--surface-2', '--panel-2'],
  ['--surface-3', '--panel-3'],
  ['--border', '--border']
]

test('每套主题的底色与客户端一致且层级正确', { skip: skipCross }, () => {
  for (const name of [
    'pine',
    'indigo',
    'clay',
    'ocean',
    'moss',
    'plum',
    'rose',
    'sand',
    'orange',
    'celadon'
  ]) {
    for (const [mode, appSelector, clientSelector, base] of [
      ['深色', `\n.accent-${name} {`, `:root[data-accent='${name}']`, appDark],
      [
        '浅色',
        `\n.theme-light.accent-${name} {`,
        `:root[data-theme='light'][data-accent='${name}']`,
        appLight
      ]
    ]) {
      const appPalette = variables(blockOf(appVue, appSelector))
      const clientPalette = variables(blockOf(clientCss, clientSelector))
      for (const [appKey, clientKey] of THEME_BACKGROUND_PAIRS) {
        assert.equal(
          appPalette[appKey]?.toLowerCase(),
          clientPalette[clientKey]?.toLowerCase(),
          `${mode} ${name} ${appKey} 与客户端 ${clientKey} 不一致`
        )
      }

      const page = luminance(appPalette['--page'])
      const card = luminance(appPalette['--surface'])
      const deepest = luminance(appPalette['--surface-3'])
      const floating = luminance(appPalette['--surface-float'])
      const up = mode === '深色' ? 1 : -1
      assert.ok(
        Math.abs(page - card) > 0.002,
        `${mode} ${name} 页面与卡片底色亮度几乎相同`
      )
      // 近黑端的亮度差会被压扁，深色端再要求一层通道差，避免“数值不同、
      // 肉眼同色”。浅色端沿用较宽的白卡层级。
      assert.ok(
        colorDistance(appPalette['--page'], appPalette['--surface']) >=
          (mode === '深色' ? 12 : 8),
        `${mode} ${name} 页面与卡片底色太接近`
      )
      // 卡片和按钮不再画边线，改用底色差分层；输入框焦点环由 accent 单独绘制。
      for (const token of ['--border', '--border-soft']) {
        assert.equal(
          appPalette[token],
          'transparent',
          `${mode} ${name} 的卡片/按钮边线应保持透明`
        )
      }
      assert.ok((floating - card) * up >= -1e-6, `${mode} ${name} 悬浮层低于卡片`)
      assert.ok((floating - deepest) * up <= 1e-6, `${mode} ${name} 悬浮层高过最深卡片`)
      assert.ok(
        Math.abs(floating - page) > 0.002,
        `${mode} ${name} 悬浮层与页面底色亮度几乎相同`
      )

      for (const token of ['--text', '--muted', '--dim']) {
        const ratio = contrastRatio(base[token], appPalette['--surface-3'])
        assert.ok(
          ratio >= 4.5,
          `${mode} ${name} ${token} 在最深卡片上的对比度只有 ${ratio.toFixed(2)}`
        )
      }
    }
  }
})

test('每套主题的强调色与按钮文字保持可读对比度', () => {
  for (const name of [
    'pine',
    'indigo',
    'clay',
    'ocean',
    'moss',
    'plum',
    'rose',
    'sand',
    'orange',
    'claude'
  ]) {
    for (const [mode, selector] of [
      ['深色', `\n.accent-${name} {`],
      ['浅色', `\n.theme-light.accent-${name} {`]
    ]) {
      const palette = variables(blockOf(appVue, selector))
      const ratio = contrastRatio(palette['--accent'], palette['--accent-ink'])
      assert.ok(
        ratio >= 4.5,
        `${mode} ${name} 的强调色与文字对比度只有 ${ratio.toFixed(2)}，低于 4.5`
      )
    }
  }
})

/** 手机端与客户端对比度 / 饱和度档位的对应选择器（带 ` {` 以避开长选择器的前缀匹配）。 */
function appearanceSelectors(property, level, accent, mode) {
  const app = mode === 'dark' ? `.${property}-${level}` : `.theme-light.${property}-${level}`
  const client =
    mode === 'dark'
      ? `:root[data-${property}='${level}']`
      : `:root[data-theme='light'][data-${property}='${level}']`
  const suffix = accent === 'graphite' ? '' : `.accent-${accent}`
  const clientSuffix = accent === 'graphite' ? '' : `[data-accent='${accent}']`
  return [`${app}${suffix} {`, `${client}${clientSuffix} {`]
}

/** 未叠加档位的基础调色板，用于检查低/高档确实改变了颜色。 */
function baseSelectors(accent, mode) {
  if (mode === 'dark') {
    return {
      app: accent === 'graphite' ? 'page,\n:root {' : `\n.accent-${accent} {`,
      client: accent === 'graphite' ? ':root {' : `:root[data-accent='${accent}']`
    }
  }
  return {
    app: accent === 'graphite' ? '\n.theme-light {' : `\n.theme-light.accent-${accent} {`,
    client:
      accent === 'graphite'
        ? ":root[data-theme='light'] {"
        : `:root[data-theme='light'][data-accent='${accent}']`
  }
}

const ALL_ACCENTS = [
  'graphite',
  'pine',
  'indigo',
  'clay',
  'ocean',
  'moss',
  'plum',
  'rose',
  'sand',
  'orange',
  'celadon',
  'claude'
]

const CONTRAST_TEXT_PAIRS = [
  ['--text', '--text'],
  ['--muted', '--muted'],
  ['--dim', '--faint']
]

test('对比度档位的底色与文字和客户端一致', { skip: skipCross }, () => {
  for (const level of ['standard', 'low', 'high']) {
    for (const accent of ALL_ACCENTS) {
      for (const mode of ['dark', 'light']) {
        const [appSelector, clientSelector] = appearanceSelectors(
          'contrast',
          level,
          accent,
          mode
        )
        const appPalette = variables(blockOf(appVue, appSelector))
        const clientPalette = variables(blockOf(clientCss, clientSelector))
        for (const [appKey, clientKey] of THEME_BACKGROUND_PAIRS) {
          assert.equal(
            appPalette[appKey]?.toLowerCase(),
            clientPalette[clientKey]?.toLowerCase(),
            `${mode} ${accent} ${level} ${appKey} 与客户端 ${clientKey} 不一致`
          )
        }
        for (const [appKey, clientKey] of CONTRAST_TEXT_PAIRS) {
          assert.equal(
            appPalette[appKey]?.toLowerCase(),
            clientPalette[clientKey]?.toLowerCase(),
            `${mode} ${accent} ${level} ${appKey} 与客户端 ${clientKey} 不一致`
          )
        }
      }
    }
  }
})

// 标准档以旧低对比度为基准，低档再软一档，最弱的次级文字会略低于 4.5；
// 这里按档位给底线，低档仍保持在 4.2:1 以上，其余两档维持 4.5:1。
const CONTRAST_FLOORS = { low: 4.2, standard: 4.5, high: 4.5 }

test('对比度档位在最深卡片上的文字仍然可读', { skip: skipCross }, () => {
  for (const level of ['standard', 'low', 'high']) {
    const floor = CONTRAST_FLOORS[level]
    for (const accent of ALL_ACCENTS) {
      for (const [mode, label] of [
        ['dark', '深色'],
        ['light', '浅色']
      ]) {
        const [appSelector, clientSelector] = appearanceSelectors(
          'contrast',
          level,
          accent,
          mode
        )
        const appPalette = variables(blockOf(appVue, appSelector))
        for (const token of ['--text', '--muted', '--dim']) {
          const ratio = contrastRatio(appPalette[token], appPalette['--surface-3'])
          assert.ok(
            ratio >= floor,
            `${label} ${accent} ${level} ${token} 在最深卡片上的对比度只有 ${ratio.toFixed(2)}，低于 ${floor}`
          )
        }
        const clientPalette = variables(blockOf(clientCss, clientSelector))
        for (const token of ['--text', '--text-soft', '--muted', '--faint']) {
          const ratio = contrastRatio(clientPalette[token], clientPalette['--panel-3'])
          assert.ok(
            ratio >= floor,
            `客户端 ${label} ${accent} ${level} ${token} 在最深卡片上的对比度只有 ${ratio.toFixed(2)}，低于 ${floor}`
          )
        }
      }
    }
  }
})

test('各对比度档位确实改变了卡片阶梯', { skip: skipCross }, () => {
  for (const accent of ALL_ACCENTS) {
    for (const mode of ['dark', 'light']) {
      const base = baseSelectors(accent, mode)
      const baseApp = variables(blockOf(appVue, base.app))
      const baseClient = variables(blockOf(clientCss, base.client))
      for (const level of ['standard', 'low', 'high']) {
        const [appSelector, clientSelector] = appearanceSelectors(
          'contrast',
          level,
          accent,
          mode
        )
        const appPalette = variables(blockOf(appVue, appSelector))
        const clientPalette = variables(blockOf(clientCss, clientSelector))
        assert.notEqual(
          appPalette['--surface-3'],
          baseApp['--surface-3'],
          `${mode} ${accent} 的 ${level} 对比度没有改变手机端卡片阶梯`
        )
        assert.notEqual(
          clientPalette['--panel-3'],
          baseClient['--panel-3'],
          `${mode} ${accent} 的 ${level} 对比度没有改变客户端卡片阶梯`
        )
      }
    }
  }
})

test('饱和度档位的主题色与功能色和客户端一致', { skip: skipCross }, () => {
  const pairs = [
    ['--accent', '--accent'],
    ['--knowledge', '--knowledge'],
    ['--file', '--blue'],
    ['--pause', '--amber'],
    ['--stop', '--red'],
    ['--resume', '--green'],
    ['--review', '--violet'],
    ['--accent-ink', '--accent-ink']
  ]
  for (const level of ['standard', 'low', 'high']) {
    for (const accent of ALL_ACCENTS) {
      for (const mode of ['dark', 'light']) {
        const [appSelector, clientSelector] = appearanceSelectors(
          'saturation',
          level,
          accent,
          mode
        )
        const appPalette = variables(blockOf(appVue, appSelector))
        const clientPalette = variables(blockOf(clientCss, clientSelector))
        for (const [appKey, clientKey] of pairs) {
          assert.equal(
            appPalette[appKey]?.toLowerCase(),
            clientPalette[clientKey]?.toLowerCase(),
            `${mode} ${accent} ${level} 的 ${appKey} 与客户端 ${clientKey} 不一致`
          )
        }
      }
    }
  }
})

test('饱和度只改鲜艳程度，不破坏强调色上的文字对比', () => {
  for (const level of ['standard', 'low', 'high']) {
    for (const accent of ALL_ACCENTS) {
      for (const [mode, label] of [
        ['dark', '深色'],
        ['light', '浅色']
      ]) {
        const base = baseSelectors(accent, mode)
        const baseApp = variables(blockOf(appVue, base.app))
        const [appSelector] = appearanceSelectors('saturation', level, accent, mode)
        const appPalette = variables(blockOf(appVue, appSelector))
        // 高饱和可能把强调色推过底线，此时生成器会换上对比度更高的
        // accent-ink；这里按该档自己的文字色校验。
        const ink = appPalette['--accent-ink'] ?? baseApp['--accent-ink']
        const ratio = contrastRatio(appPalette['--accent'], ink)
        assert.ok(
          ratio >= 4.5,
          `${label} ${accent} ${level} 饱和度下强调色与 accent-ink 只有 ${ratio.toFixed(2)}`
        )
        if (accent === 'graphite') {
          assert.equal(
            appPalette['--accent'],
            baseApp['--accent'],
            `${label} 黑白主题不应出现饱和度差异`
          )
        } else {
          assert.notEqual(
            appPalette['--accent'],
            baseApp['--accent'],
            `${label} ${accent} 的 ${level} 饱和度没有改变主题色`
          )
        }
      }
    }
  }
})

test('标准档写入基准覆盖，低/高档在标准档上继续调整', { skip: skipCross }, () => {
  for (const name of ['contrast', 'saturation']) {
    assert.match(appVue, new RegExp(`\\.${name}-standard`))
    assert.match(clientCss, new RegExp(`data-${name}='standard'`))
  }
})

test('手机端外观样式写在 style 块内', () => {
  const styleStart = appVue.indexOf('<style>')
  const styleEnd = appVue.indexOf('</style>')
  assert.ok(styleStart >= 0 && styleEnd > styleStart, 'App.vue 缺少 style 块')
  for (const marker of ['/* appearance:begin */', '/* appearance:end */']) {
    const at = appVue.indexOf(marker)
    assert.ok(at > styleStart && at < styleEnd, `${marker} 落在了 style 块之外`)
  }
})

test('每个主题页面根节点都绑定对比度与饱和度 class', () => {
  const pagesRoot = join(here, '..', 'pages')
  let checked = 0
  for (const name of readdirSync(pagesRoot)) {
    const file = join(pagesRoot, name, 'index.vue')
    if (!existsSync(file)) continue
    const source = readFileSync(file, 'utf8')
    if (!source.includes("'theme-light'")) continue
    checked += 1
    assert.match(
      source,
      /'contrast-' \+ store\.contrast/,
      `${name} 的页面根节点没有绑定对比度档位`
    )
    assert.match(
      source,
      /'saturation-' \+ store\.saturation/,
      `${name} 的页面根节点没有绑定饱和度档位`
    )
  }
  assert.ok(checked >= 16, `只找到 ${checked} 个主题页面`)
})

test('设置页提供对比度与饱和度三档', () => {
  const settings = readFileSync(join(here, '..', 'pages', 'settings', 'index.vue'), 'utf8')
  assert.match(settings, /contrastOptions:\s*\[/)
  assert.match(settings, /saturationOptions:\s*\[/)
  for (const level of ['low', 'standard', 'high']) {
    assert.ok(settings.includes(`value: '${level}'`), `设置页缺少 ${level} 选项`)
  }
  assert.match(settings, /@click="chooseContrast\(option\.value\)"/)
  assert.match(settings, /@click="chooseSaturation\(option\.value\)"/)
})

test('主题强调色之间保持足够区分度', () => {
  const names = [
    'pine',
    'indigo',
    'clay',
    'ocean',
    'moss',
    'plum',
    'rose',
    'sand',
    'orange',
    'celadon',
    'claude'
  ]
  for (const [mode, selectorOf] of [
    ['深色', (name) => `\n.accent-${name} {`],
    ['浅色', (name) => `\n.theme-light.accent-${name} {`]
  ]) {
    const accents = names.map((name) =>
      variables(blockOf(appVue, selectorOf(name)))['--accent'].toLowerCase()
    )
    for (let left = 0; left < accents.length; left += 1) {
      for (let right = left + 1; right < accents.length; right += 1) {
        const distance = colorDistance(accents[left], accents[right])
        assert.ok(
          distance >= 18,
          `${mode} ${names[left]} 与 ${names[right]} 区分度只有 ${distance.toFixed(1)}`
        )
      }
    }
  }
})

test('暖白的深浅底色与客户端一致', { skip: skipCross }, () => {
  for (const [mode, appSelector, clientSelector] of [
    ['深色', '\n.accent-claude {', ":root[data-accent='claude']"],
    ['浅色', '\n.theme-light.accent-claude {', ":root[data-theme='light'][data-accent='claude']"]
  ]) {
    const appPalette = variables(blockOf(appVue, appSelector))
    const clientPalette = variables(blockOf(clientCss, clientSelector))
    for (const [appKey, clientKey] of DARK_PAIRS) {
      assert.equal(
        appPalette[appKey]?.toLowerCase(),
        clientPalette[clientKey]?.toLowerCase(),
        `${mode} ${appKey} 与客户端 ${clientKey} 不一致`
      )
    }
  }
})

/** 从 rgba(...) 取透明度，用于校验悬停叠色的强弱。 */
function alphaOf(value) {
  const match = /rgba?\([^)]*?([01]?\.?\d+)\s*\)/i.exec(String(value).trim())
  assert.ok(match, `不是带透明度的颜色：${value}`)
  const parsed = Number(match[1])
  assert.ok(parsed > 0 && parsed <= 1, `透明度解析失败：${value}`)
  return parsed
}

/**
 * 页面底色 / 悬浮底色 / 悬停态三层必须同时存在于两端。
 * 页面底色要和卡片底色区分开，悬浮层要比卡片高、又不能高过最深卡片，
 * 悬停叠色要有可见效果但不过讂——这三条是手机端最容易在小屏上手滑改坏的地方。
 */
for (const [mode, selector] of [
  ['深色', 'page,\n:root'],
  ['浅色', '\n.theme-light {']
]) {
  test(`${mode}页面、悬浮、悬停三层底色齐备且有层次`, () => {
    const palette = variables(blockOf(appVue, selector))
    for (const token of [
      '--page',
      '--surface-float',
      '--float-shadow',
      '--hover',
      '--hover-strong'
    ]) {
      assert.ok(palette[token], `${mode}缺少 ${token}`)
    }

    assert.notEqual(
      palette['--page'].toLowerCase(),
      palette['--surface'].toLowerCase(),
      `${mode}页面底色与卡片底色相同，卡片将无法从背景里浮出来`
    )
    const page = luminance(palette['--page'])
    const card = luminance(palette['--surface'])
    const deepest = luminance(palette['--surface-3'])
    const floating = luminance(palette['--surface-float'])
    // 深色靠变亮抬层级，浅色靠变暗抬层级。
    const up = mode === '深色' ? 1 : -1
    assert.ok(
      (floating - card) * up >= -1e-6,
      `${mode}悬浮层没有高于卡片（${palette['--surface-float']}）`
    )
    assert.ok(
      (floating - deepest) * up <= 1e-6,
      `${mode}悬浮层比最深卡片还高，内部卡片会看起来凹陷（${palette['--surface-float']}）`
    )
    assert.ok(
      Math.abs(floating - page) > 0.002,
      `${mode}悬浮层与页面底色亮度几乎相同，弹窗没有边界`
    )

    const hover = alphaOf(palette['--hover'])
    const strong = alphaOf(palette['--hover-strong'])
    assert.ok(hover >= 0.03, `${mode} --hover 太淡（${hover}）`)
    assert.ok(hover <= 0.1, `${mode} --hover 太重（${hover}）`)
    assert.ok(strong > hover, `${mode} --hover-strong 需要比 --hover 明显`)
    assert.ok(strong <= 0.14, `${mode} --hover-strong 太重（${strong}）`)
  })
}

test('主题配色与按钮方案在设置页以卡片预览展示', () => {
  const settings = readFileSync(join(here, '..', 'pages', 'settings', 'index.vue'), 'utf8')
  assert.match(settings, /class="choice-grid"/, '主题配色缺少卡片网格')
  assert.match(settings, /accent-dot/, '配色卡片缺少强调色预览')
  assert.match(settings, /choice-grid scheme-grid/, '按钮方案缺少卡片网格')
  assert.match(settings, /scheme-pill-primary/, '按钮方案卡片缺少主按钮预览')
  assert.match(settings, /scheme-pill-soft/, '按钮方案卡片缺少柔和按钮预览')
  assert.ok(
    settings.includes("'btn-scheme-' + option.value"),
    '按钮方案卡片没有挂载对应方案的 token'
  )
  assert.match(settings, /\.choice-card\.active/, '卡片缺少选中态')
  assert.doesNotMatch(settings, /accent-swatch/, '旧的色点行样式应已移除')
})

test('返回箭头横线与头部使用整数偏移并保持同一粗细', () => {
  const app = readFileSync(join(here, '..', 'App.vue'), 'utf8')
  const arrow = app.slice(app.indexOf('.back-arrow {'), app.indexOf('/* 主题配色'))
  assert.match(arrow, /height:\s*4rpx/, '横线太细')
  // content-box 的头部实际高度是 14 + 4 = 18rpx，margin-top 必须是 -9rpx，
  // 只按 width 一半算 (-7rpx) 会让头部比横线低 2rpx。
  assert.match(arrow, /width:\s*14rpx/, '箭头头部尺寸变了')
  assert.match(arrow, /height:\s*14rpx/, '箭头头部尺寸变了')
  assert.match(arrow, /margin-top:\s*-9rpx/, '箭头头部没有按边框盒居中')
  assert.match(arrow, /border-left:\s*4rpx solid currentColor/, '头部边长与横线不一致')
  assert.match(arrow, /border-bottom:\s*4rpx solid currentColor/, '头部边长与横线不一致')
  assert.match(arrow, /margin-top:\s*-2rpx/, '横线没有垂直居中')
  assert.doesNotMatch(arrow, /margin-top:\s*-[0-9.]+5rpx/, '半像素偏移会在 App 端取整后错开')
})

test('悬浮弹层不再写死背景色', () => {
  for (const file of ['components/app-dialog/app-dialog.vue', 'components/app-sheet/app-sheet.vue']) {
    const source = readFileSync(join(here, '..', file), 'utf8')
    assert.doesNotMatch(
      source,
      /rgba\(255,\s*255,\s*255,\s*0\.045\)/,
      `${file} 还留着写死的白色浮层渐变`
    )
    assert.match(
      source,
      /var\(--surface-float\)/,
      `${file} 没有接 --surface-float`
    )
  }
})

test('字号只有标准、大、特大三档，默认标准就是原字号', () => {
  const app = readFileSync(APP_VUE, 'utf8')
  assert.match(app, /--font-scale:\s*1;/, '缺少标准字号乘数')
  assert.match(app, /\.font-large\s*\{\s*--font-scale:\s*1\.12;/, '大字档乘数不对')
  assert.match(app, /\.font-xlarge\s*\{\s*--font-scale:\s*1\.25;/, '特大字档乘数不对')
  // 按钮字号 token 也走同一个乘数，否则主按钮文字不会跟着放大。
  for (const token of ['xs', 'sm', 'md', 'lg']) {
    assert.match(
      app,
      new RegExp(`--btn-font-${token}:\\s*calc\\([0-9.]+rpx \\* var\\(--font-scale\\)\\)`),
      `--btn-font-${token} 没有跟随字号`
    )
  }

  // 每个页面根节点都挂 font-*，否则从别的页面返回时字号不会更新。
  const pages = join(here, '..', 'pages')
  for (const name of readdirSync(pages)) {
    const file = join(pages, name, 'index.vue')
    let page = ''
    try {
      page = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    assert.ok(
      page.includes("'font-' + store.fontSize"),
      `${name} 页面没有挂载字号 class`
    )
  }

  // 字体声明统一走 calc；漏掉一条就会在放大后保持原大小。
  const sources = [app]
  for (const name of readdirSync(pages)) {
    try {
      sources.push(readFileSync(join(pages, name, 'index.vue'), 'utf8'))
    } catch {
      // 目录不是页面
    }
  }
  const components = join(here, '..', 'components')
  for (const name of readdirSync(components)) {
    try {
      sources.push(readFileSync(join(components, name, `${name}.vue`), 'utf8'))
    } catch {
      // 不是组件目录
    }
  }
  for (const source of sources) {
    assert.doesNotMatch(
      source,
      /font-size:\s*[0-9.]+(?:px|rpx)/,
      '还有字体大小没有乘 --font-scale'
    )
  }
})

test('手机端每套配色都能真正切换，不会被校验回落成黑白', () => {
  const names = [
    'pine',
    'indigo',
    'clay',
    'ocean',
    'moss',
    'plum',
    'rose',
    'sand',
    'orange',
    'celadon',
    'claude'
  ]
  for (const file of ['store/index.js', 'lib/storage.js']) {
    const source = readFileSync(join(here, '..', file), 'utf8')
    for (const name of names) {
      assert.ok(
        source.includes("'" + name + "'"),
        `${file} 的配色校验漏了 ${name}，点击后会回落成黑白`
      )
    }
  }
})
