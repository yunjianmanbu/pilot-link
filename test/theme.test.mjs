import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * 手机端配色来自 App.vue 的 CSS 变量，桌面客户端的是 styles.css。
 *
 * 两端**不再共用一套调色板**：桌面端只保留 dark / light 两套主题、没有强调色
 * 预设（`[data-accent]` 已从 styles.css 移除，见 pilot/docs/theme-system.md），
 * 手机端仍是 12 套配色。因此这里只保留仍然成立的两类跨端校验：
 *   1. 对比度档位的分隔线粗细两端同源（都出自 gen-appearance-css.mjs）；
 *   2. 桌面端不得重新引入 accent 预设（否则与主题体系文档冲突）。
 * 手机端自身的配色/可读性/层级断言全部保留。
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

// 拆仓后本仓库不含桌面端源码与工作区文档：读不到就跳过，而不是判失败。
const skipCross = clientCss != null ? false : '独立仓库不含桌面端源码（pilot/pilot）与工作区文档（pilot/docs），跳过跨仓库一致性检查'

test('桌面端样式表不再有强调色预设', { skip: skipCross }, () => {
  // 主题体系文档约定桌面端只有 dark / light 两套：一旦有人把 [data-accent]
  // 覆盖层加回来，主进程画窗口底色、store 校验和生成器会全部对不上。
  assert.doesNotMatch(clientCss, /\[data-accent/, '桌面端又出现了 [data-accent] 覆盖层')
  // 沿用旧写法时每套配色都会写一份 `:root[data-theme='light']`，这里只允许一份。
  const lightBlocks = clientCss.match(/^:root\[data-theme='light'\] \{/gm) ?? []
  assert.equal(lightBlocks.length, 1, `桌面端应该有且只有一份浅色调色板，实际 ${lightBlocks.length} 份`)
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

test('强调色上的文字使用 accent-ink，不写死白色', () => {
  for (const [mode, palette] of [
    ['深色', appDark],
    ['浅色', appLight]
  ]) {
    assert.ok(palette['--accent-ink'], `${mode}缺少 --accent-ink`)
  }
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

// 桌面端已按设计移除对比度与饱和度设置（见 gen-appearance-css.mjs 文件头：最终色值
// 直接写在 styles.css 的调色板里，不再生成档位规则）。手机端仍保留这两项，所以跨仓库
// 比对只在桌面端 CSS 里真的存在该档位时才跑；桌面端以后若重新引入，比对会自动恢复。
const clientHasAppearanceLevels = clientCss != null && /\.contrast-standard\b/.test(clientCss)

if (clientHasAppearanceLevels) {
  test('两端的分隔线随对比度档同步递增', () => {
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
  })
}

test('手机端的行线强度随对比度档递增', () => {
  const declOf = (css, selector, token) => {
    const palette = variables(blockOf(css, selector))
    return palette[token]
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


test('每套主题的底色层级正确', () => {
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
    for (const [mode, appSelector] of [
      ['深色', `\n.accent-${name} {`],
      ['浅色', `\n.theme-light.accent-${name} {`]
    ]) {
      const appPalette = variables(blockOf(appVue, appSelector))

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

      // 除 claude 外，配色块只覆盖底色与强调色，文字色继承 :root / .theme-light，
      // 所以这里按「基础调色板 + 本套覆盖」合并后再算对比度。
      const palette = { ...(mode === '深色' ? appDark : appLight), ...appPalette }
      for (const token of ['--text', '--muted', '--dim']) {
        const ratio = contrastRatio(palette[token], palette['--surface-3'])
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

/** 手机端对比度 / 饱和度档位选择器（带 ` {` 以避开长选择器的前缀匹配）。 */
function appearanceSelector(property, level, accent, mode) {
  const app = mode === 'dark' ? `.${property}-${level}` : `.theme-light.${property}-${level}`
  const suffix = accent === 'graphite' ? '' : `.accent-${accent}`
  return `${app}${suffix} {`
}

/** 未叠加档位的基础调色板，用于检查低/高档确实改变了颜色。 */
function baseSelector(accent, mode) {
  if (mode === 'dark') {
    return accent === 'graphite' ? 'page,\n:root {' : `\n.accent-${accent} {`
  }
  return accent === 'graphite' ? '\n.theme-light {' : `\n.theme-light.accent-${accent} {`
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

// 标准档以旧低对比度为基准，低档再软一档，最弱的次级文字会略低于 4.5；
// 这里按档位给底线，低档仍保持在 4.2:1 以上，其余两档维持 4.5:1。
const CONTRAST_FLOORS = { low: 4.2, standard: 4.5, high: 4.5 }

test('对比度档位在最深卡片上的文字仍然可读', () => {
  for (const level of ['standard', 'low', 'high']) {
    const floor = CONTRAST_FLOORS[level]
    for (const accent of ALL_ACCENTS) {
      for (const [mode, label] of [
        ['dark', '深色'],
        ['light', '浅色']
      ]) {
        const appSelector = appearanceSelector('contrast', level, accent, mode)
        const appPalette = variables(blockOf(appVue, appSelector))
        for (const token of ['--text', '--muted', '--dim']) {
          const ratio = contrastRatio(appPalette[token], appPalette['--surface-3'])
          assert.ok(
            ratio >= floor,
            `${label} ${accent} ${level} ${token} 在最深卡片上的对比度只有 ${ratio.toFixed(2)}，低于 ${floor}`
          )
        }
      }
    }
  }
})

test('各对比度档位确实改变了卡片阶梯', () => {
  for (const accent of ALL_ACCENTS) {
    for (const mode of ['dark', 'light']) {
      const baseApp = variables(blockOf(appVue, baseSelector(accent, mode)))
      for (const level of ['standard', 'low', 'high']) {
        const appSelector = appearanceSelector('contrast', level, accent, mode)
        const appPalette = variables(blockOf(appVue, appSelector))
        assert.notEqual(
          appPalette['--surface-3'],
          baseApp['--surface-3'],
          `${mode} ${accent} 的 ${level} 对比度没有改变手机端卡片阶梯`
        )
      }
    }
  }
})

test('对比度档位就位且文字色随档位递增', () => {
  // 两端的分隔线由 gen-appearance-css.mjs 同源生成（见上一条），但对比度
  // 档位的文字色是两端各自从自己的调色板计算的，这里只校验手机端内部
  // 「低 < 标准 < 高」的递进关系。
  const levelOf = (level) => variables(blockOf(appVue, appearanceSelector('contrast', level, 'graphite', 'dark')))
  const ratios = ['low', 'standard', 'high'].map((level) => {
    const palette = levelOf(level)
    return contrastRatio(palette['--text'], palette['--surface-3'])
  })
  assert.ok(
    ratios[0] < ratios[1] && ratios[1] < ratios[2],
    `对比度档位的文字可读性未递增：${ratios.map((value) => value.toFixed(2)).join(' / ')}`
  )
})

test('饱和度只改鲜艳程度，不破坏强调色上的文字对比', () => {
  for (const level of ['standard', 'low', 'high']) {
    for (const accent of ALL_ACCENTS) {
      for (const [mode, label] of [
        ['dark', '深色'],
        ['light', '浅色']
      ]) {
        const baseApp = variables(blockOf(appVue, baseSelector(accent, mode)))
        const appPalette = variables(
          blockOf(appVue, appearanceSelector('saturation', level, accent, mode))
        )
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
    // 桌面端已移除这两项设置，只有它真的有档位规则时才要求带着 standard 基准。
    if (clientHasAppearanceLevels) {
      assert.match(clientCss, new RegExp(`data-${name}='standard'`))
    }
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

/** 从 rgba(...) 取透明度，用于校验悬停叠色的强弱。 */
function alphaOf(value) {
  const match = /rgba?\([^)]*?([01]?\.?\d+)\s*\)/i.exec(String(value).trim())
  assert.ok(match, `不是带透明度的颜色：${value}`)
  const parsed = Number(match[1])
  assert.ok(parsed > 0 && parsed <= 1, `透明度解析失败：${value}`)
  return parsed
}

/**
 * 页面底色 / 悬浮底色 / 悬停态三层必须同时存在。
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
