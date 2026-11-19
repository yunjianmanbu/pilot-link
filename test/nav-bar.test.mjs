import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { applyNavBarColor, THEME_BACKGROUNDS, themeBackground } from '../lib/nav-bar.js'

function fakePlus({ platform = 'Android', withWindow = true, appearance = null } = {}) {
  const calls = {
    navigationBar: null,
    statusBar: null,
    background: null,
    flags: null,
    appearance: null
  }
  let currentAppearance = appearance
  const controller = {
    getSystemBarsAppearance: () => currentAppearance,
    setSystemBarsAppearance: (value, mask) => {
      currentAppearance = value
      calls.appearance = { value, mask }
    }
  }
  const decor = {
    getSystemUiVisibility: () => 0x10 | 0x1000,
    setSystemUiVisibility: (value) => {
      calls.flags = value
    }
  }
  if (appearance !== null) {
    decor.getWindowInsetsController = () => controller
  }
  const window = {
    setNavigationBarColor: (color) => {
      calls.navigationBar = color
    },
    setStatusBarColor: (color) => {
      calls.statusBar = color
    },
    setBackgroundDrawable: (drawable) => {
      calls.background = drawable
    },
    getDecorView: () => decor
  }
  const activity = withWindow ? { getWindow: () => window } : null
  const plus = {
    os: { name: platform },
    android: {
      runtimeMainActivity: () => activity,
      importClass: (name) => {
        if (name === 'android.graphics.drawable.ColorDrawable') {
          return class ColorDrawable {
            constructor(color) {
              this.color = color
            }
          }
        }
        return { parseColor: (value) => `color:${value}` }
      }
    }
  }
  return { plus, calls }
}

test('深色主题把状态栏、导航栏和窗口底色改成页面底色，并清掉浅色图标标记', () => {
  const { plus, calls } = fakePlus()
  applyNavBarColor('dark', plus)
  assert.equal(calls.statusBar, 'color:#050505')
  assert.equal(calls.navigationBar, 'color:#050505')
  assert.equal(calls.background.color, 'color:#050505')
  // 浅色状态栏图标与浅色导航栏图标都要清掉，同时保留其他系统 UI 标记。
  assert.equal(calls.flags & 0x2000, 0)
  assert.equal(calls.flags & 0x10, 0)
  assert.equal(calls.flags & 0x1000, 0x1000)
})

test('浅色主题使用浅色状态栏/导航栏并打开深色图标', () => {
  const { plus, calls } = fakePlus()
  applyNavBarColor('light', plus)
  assert.equal(calls.statusBar, 'color:#fbfbfb')
  assert.equal(calls.navigationBar, 'color:#fbfbfb')
  assert.equal(calls.background.color, 'color:#fbfbfb')
  // 0x2000 = SYSTEM_UI_FLAG_LIGHT_STATUS_BAR，0x10 = LIGHT_NAVIGATION_BAR。
  assert.equal(calls.flags & 0x2000, 0x2000)
  assert.equal(calls.flags & 0x10, 0x10)
  assert.equal(calls.flags & 0x1000, 0x1000)
})

test('暖白使用米白/暖黑底色', () => {
  const light = fakePlus()
  applyNavBarColor('light', light.plus, 'claude')
  assert.equal(light.calls.statusBar, 'color:#f8f6f0')
  assert.equal(light.calls.navigationBar, 'color:#f8f6f0')
  assert.equal(light.calls.background.color, 'color:#f8f6f0')
  assert.equal(light.calls.flags & 0x2000, 0x2000)
  assert.equal(light.calls.flags & 0x10, 0x10)

  const dark = fakePlus()
  applyNavBarColor('dark', dark.plus, 'claude')
  assert.equal(dark.calls.statusBar, 'color:#242321')
  assert.equal(dark.calls.navigationBar, 'color:#242321')
  assert.equal(dark.calls.background.color, 'color:#242321')
  assert.equal(dark.calls.flags & 0x2000, 0)
  assert.equal(dark.calls.flags & 0x10, 0)
})

test('对比度档位以旧低对比度为标准继续平移窗口底色', () => {
  assert.equal(themeBackground('dark', 'graphite', 'standard'), '#050505')
  assert.equal(themeBackground('dark', 'graphite', 'low'), '#0a0a0a')
  assert.equal(themeBackground('dark', 'graphite', 'high'), '#040404')
  assert.equal(themeBackground('light', 'graphite', 'standard'), '#fbfbfb')
  assert.equal(themeBackground('light', 'graphite', 'low'), '#f7f7f7')
  assert.equal(themeBackground('light', 'graphite', 'high'), '#fdfdfd')
  assert.equal(themeBackground('dark', 'claude', 'low'), '#282726')
  assert.equal(themeBackground('dark', 'claude', 'high'), '#1e1d1c')
  assert.equal(themeBackground('light', 'claude', 'low'), '#f5f3eb')
})

test('对比度档位会传给系统栏', () => {
  const { plus, calls } = fakePlus()
  applyNavBarColor('light', plus, 'claude', 'low')
  assert.equal(calls.statusBar, 'color:#f5f3eb')
  assert.equal(calls.navigationBar, 'color:#f5f3eb')
  assert.equal(calls.background.color, 'color:#f5f3eb')
})

test('未知对比度档位按标准处理', () => {
  assert.equal(themeBackground('dark', 'graphite', 'ultra'), '#050505')
  assert.equal(themeBackground('light', 'claude', 'ultra'), '#f8f6f0')
})

const appVue = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'App.vue'),
  'utf8'
)

/** 取某个选择器块里的自定义属性。 */
function variables(block) {
  const found = {}
  for (const match of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    found[match[1]] = match[2].trim()
  }
  return found
}

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

test('每套配色的窗口底色与 App.vue 一致', () => {
  for (const [accent, palette] of Object.entries(THEME_BACKGROUNDS)) {
    const darkSelector = accent === 'graphite' ? 'page,\n:root' : `\n.accent-${accent} {`
    const lightSelector =
      accent === 'graphite' ? '\n.theme-light {' : `\n.theme-light.accent-${accent} {`
    assert.equal(
      variables(blockOf(appVue, darkSelector))['--bg']?.toLowerCase(),
      palette.dark.toLowerCase(),
      `${accent} 深色窗口底色不一致`
    )
    assert.equal(
      variables(blockOf(appVue, lightSelector))['--bg']?.toLowerCase(),
      palette.light.toLowerCase(),
      `${accent} 浅色窗口底色不一致`
    )
  }
})

test('每套配色的系统栏都使用对应窗口底色', () => {
  for (const accent of Object.keys(THEME_BACKGROUNDS)) {
    const dark = fakePlus()
    applyNavBarColor('dark', dark.plus, accent)
    const darkBackground = themeBackground('dark', accent)
    assert.equal(dark.calls.navigationBar, `color:${darkBackground}`)
    assert.equal(dark.calls.statusBar, `color:${darkBackground}`)

    const light = fakePlus()
    applyNavBarColor('light', light.plus, accent)
    const lightBackground = themeBackground('light', accent)
    assert.equal(light.calls.navigationBar, `color:${lightBackground}`)
    assert.equal(light.calls.statusBar, `color:${lightBackground}`)
  }
})

test('没有 plus.android 桥的环境（iOS/H5）不做任何改动', () => {
  const calls = { statusBar: null, navigationBar: null, flags: null }
  const plus = { os: { name: 'iOS' } }
  applyNavBarColor('dark', plus)
  assert.equal(calls.statusBar, null)
  assert.equal(calls.navigationBar, null)
  assert.equal(calls.flags, null)
})

test('鸿蒙（HarmonyOS）同样应用系统栏配色', () => {
  // plus.os.name 在鸿蒙上不一定是 'Android'，但 plus.android 桥可用，
  // 浅色主题必须把状态栏图标切成深色。
  const harmony = fakePlus({ platform: 'HarmonyOS' })
  applyNavBarColor('light', harmony.plus)
  assert.equal(harmony.calls.statusBar, 'color:#fbfbfb')
  assert.equal(harmony.calls.flags & 0x2000, 0x2000)
})

test('没有 plus 时静默跳过', () => {
  assert.doesNotThrow(() => applyNavBarColor('dark', null))
})

test('拿不到 Activity 或 Window 时不抛错', () => {
  const { plus, calls } = fakePlus({ withWindow: false })
  assert.doesNotThrow(() => applyNavBarColor('dark', plus))
  assert.equal(calls.navigationBar, null)
})

test('ROM 不支持导航栏接口时静默忽略', () => {
  const plus = {
    os: { name: 'Android' },
    android: {
      runtimeMainActivity: () => {
        throw new Error('not supported')
      },
      importClass: () => ({ parseColor: () => 0 })
    }
  }
  assert.doesNotThrow(() => applyNavBarColor('dark', plus))
})

test('targetSdk 35 的 Android 15 用 WindowInsetsController 设置图标明暗', () => {
  // Android 15 强制 edge-to-edge，setStatusBarColor 和 setSystemUiVisibility
  // 都会被忽略，只有 appearance 能改变状态栏文字颜色。
  const light = fakePlus({ appearance: 0x1000 })
  applyNavBarColor('light', light.plus)
  assert.equal(light.calls.appearance.mask, 0x18)
  assert.equal(light.calls.appearance.value & 0x8, 0x8)
  assert.equal(light.calls.appearance.value & 0x10, 0x10)
  // 有其他 appearance 位时不能抹掉。
  assert.equal(light.calls.appearance.value & 0x1000, 0x1000)
  // 旧接口不再参与，避免把刚设好的 appearance 覆盖回去。
  assert.equal(light.calls.flags, null)
})

test('targetSdk 35 的 Android 15 深色主题清掉深色图标标记', () => {
  const dark = fakePlus({ appearance: 0x18 | 0x1000 })
  applyNavBarColor('dark', dark.plus)
  assert.equal(dark.calls.appearance.mask, 0x18)
  assert.equal(dark.calls.appearance.value & 0x18, 0)
  assert.equal(dark.calls.appearance.value & 0x1000, 0x1000)
  assert.equal(dark.calls.flags, null)
})

test('WindowInsetsController 不可用时回退到 setSystemUiVisibility', () => {
  const fallback = fakePlus({
    appearance: null
  })
  // 拿不到 getWindowInsetsController 的旧机型仍走旧 flags，不能报错也不能丢配置。
  fallback.plus.android.runtimeMainActivity().getWindow().getDecorView().getWindowInsetsController = () => {
    throw new Error('NoSuchMethod')
  }
  assert.doesNotThrow(() => applyNavBarColor('light', fallback.plus))
  assert.equal(fallback.calls.appearance, null)
  assert.equal(fallback.calls.flags & 0x2000, 0x2000)
  assert.equal(fallback.calls.flags & 0x10, 0x10)
})

test('颜色接口抛错时仍然设置状态栏和导航栏图标明暗', () => {
  // 部分 ROM 在 Android 15 上会让 setStatusBarColor / setBackgroundDrawable
  // 直接抛错；图标明暗不能因此被跳过，否则浅色页面就是白底白字。
  let appearance = 0
  const controller = {
    getSystemBarsAppearance: () => appearance,
    setSystemBarsAppearance: (value) => {
      appearance = value
    }
  }
  const decor = {
    getWindowInsetsController: () => controller,
    getSystemUiVisibility: () => 0,
    setSystemUiVisibility: () => {}
  }
  const window = {
    setNavigationBarColor: () => {
      throw new Error('unsupported')
    },
    setStatusBarColor: () => {
      throw new Error('unsupported')
    },
    setBackgroundDrawable: () => {
      throw new Error('unsupported')
    },
    getDecorView: () => decor
  }
  const plus = {
    android: {
      runtimeMainActivity: () => ({ getWindow: () => window }),
      importClass: (name) =>
        name.includes('ColorDrawable') ? class ColorDrawable {} : { parseColor: () => 0 }
    }
  }
  assert.doesNotThrow(() => applyNavBarColor('light', plus))
  assert.equal(appearance & 0x8, 0x8)
  assert.equal(appearance & 0x10, 0x10)
})
