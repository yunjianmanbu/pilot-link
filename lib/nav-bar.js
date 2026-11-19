/**
 * 系统导航栏（底部手势条 / 三键栏）配色。
 *
 * 鸿蒙和部分安卓 ROM 会沿用系统浅色导航栏，深色页面底部会出现一条白边。
 * 这里通过 plus.android 直接改当前 Activity 的导航栏颜色与图标明暗，并让窗口
 * 底色跟随主题，避免导航栏与页面之间露出浅色缝隙。
 *
 * 只影响手机端；H5 或没有 plus 的环境直接跳过。个别 ROM 不开放这些接口时
 * 静默保留系统默认，不影响 App 使用。
 */

// 与 App.vue 各主题的 --bg 保持一致；README/DESIGN 里的配色规则同样适用。
export const THEME_BACKGROUNDS = {
  graphite: { dark: '#000000', light: '#ffffff' },
  pine: { dark: '#020302', light: '#f8faf9' },
  indigo: { dark: '#020203', light: '#f8f9fb' },
  clay: { dark: '#030202', light: '#fbf9f8' },
  ocean: { dark: '#020303', light: '#f7fafb' },
  moss: { dark: '#020302', light: '#f9faf8' },
  plum: { dark: '#030203', light: '#faf9fc' },
  rose: { dark: '#030202', light: '#fcf8f9' },
  sand: { dark: '#030302', light: '#fbf9f7' },
  orange: { dark: '#050301', light: '#fdf8f2' },
  celadon: { dark: '#020303', light: '#f7fbfa' },
  claude: { dark: '#1f1e1d', light: '#faf9f5' }
}
// android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR（API 23+）
const LIGHT_STATUS_BAR = 0x2000
// android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR（API 26+）
const LIGHT_NAVIGATION_BAR = 0x10
// android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS（API 30+）
const APPEARANCE_LIGHT_STATUS_BARS = 0x8
// android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS（API 30+）
const APPEARANCE_LIGHT_NAVIGATION_BARS = 0x10

/**
 * 状态栏/底部导航栏上文字与图标的明暗。
 *
 * targetSdkVersion 35 起 Android 15 强制 edge-to-edge：setStatusBarColor 变成
 * 空操作，setSystemUiVisibility 也不再改变图标颜色，浅色页面就退化成
 * 「白底 + 白图标」，状态栏时间电量全部看不见。API 30 以上必须改用
 * WindowInsetsController.setSystemBarsAppearance，旧机型再回退到旧接口。
 */
function applyBarsAppearance(decor, light) {
  try {
    const controller = decor?.getWindowInsetsController?.()
    if (controller?.setSystemBarsAppearance) {
      const mask = APPEARANCE_LIGHT_STATUS_BARS | APPEARANCE_LIGHT_NAVIGATION_BARS
      const current = Number(controller.getSystemBarsAppearance?.()) || 0
      controller.setSystemBarsAppearance(light ? current | mask : current & ~mask, mask)
      return true
    }
  } catch {
    // API 30 以下没有这个方法，回退旧接口。
  }
  try {
    if (decor?.getSystemUiVisibility && decor?.setSystemUiVisibility) {
      const flags = Number(decor.getSystemUiVisibility()) || 0
      const chrome = LIGHT_STATUS_BAR | LIGHT_NAVIGATION_BAR
      decor.setSystemUiVisibility(light ? flags | chrome : flags & ~chrome)
      return true
    }
  } catch {
    // 接口不可用时保留系统默认配色。
  }
  return false
}

function resolvePlus(plusApi) {
  if (plusApi) return plusApi
  try {
    return typeof plus !== 'undefined' ? plus : null
  } catch {
    return null
  }
}

/** 与 App.vue / gen-appearance-css.mjs 相同的亮度平移，保证系统栏和页面底色一致。 */
function contrastColor(hex, theme, contrast) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex).trim())
  if (!match) return hex
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(match[1].slice(index, index + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  let hue = 0
  let saturation = 0
  if (max !== min) {
    const delta = max - min
    saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
    if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0)
    else if (max === g) hue = (b - r) / delta + 2
    else hue = (r - g) / delta + 4
    hue /= 6
  }
  // 标准档就是旧版的低对比平移，低/高档都以它为起点。
  const low = (value) =>
    theme === 'dark' ? value + (1 - value) * 0.02 : value * 0.985
  const high = (value) => (theme === 'dark' ? value * 0.85 : value + (1 - value) * 0.5)
  const standard = low(lightness)
  const next =
    contrast === 'high' ? high(standard) : contrast === 'low' ? low(standard) : standard
  const channel = (input) => {
    if (saturation === 0) return next * 255
    const q =
      next < 0.5 ? next * (1 + saturation) : next + saturation - next * saturation
    const p = 2 * next - q
    let value = input
    if (value < 0) value += 1
    if (value > 1) value -= 1
    let channelValue
    if (value < 1 / 6) channelValue = p + (q - p) * 6 * value
    else if (value < 1 / 2) channelValue = q
    else if (value < 2 / 3) channelValue = p + (q - p) * (2 / 3 - value) * 6
    else channelValue = p
    return channelValue * 255
  }
  return `#${[hue + 1 / 3, hue, hue - 1 / 3]
    .map((value) =>
      Math.max(0, Math.min(255, Math.round(channel(value))))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

/** 当前主题/配色的窗口底色，系统栏与 pages.json 兜底共用。 */
export function themeBackground(theme, accent = 'graphite', contrast = 'standard') {
  const palette = THEME_BACKGROUNDS[accent] || THEME_BACKGROUNDS.graphite
  return contrastColor(theme === 'light' ? palette.light : palette.dark, theme, contrast)
}

/** 把窗口底色和系统导航栏切成当前主题与配色的颜色。 */
export function applyNavBarColor(theme, plusApi, accent = 'graphite', contrast = 'standard') {
  const api = resolvePlus(plusApi)
  // 只用 plus.android 桥是否存在判断，不再看 plus.os.name：鸿蒙（HarmonyOS）
  // 内核是 AOSP，桥可用且系统栏规则与 Android 一致，按名字过滤会让鸿蒙
  // 设备整段跳过，浅色页面就退化成「白底 + 白状态栏文字」。iOS 没有这个桥。
  if (!api || !api.android) return
  try {
    const main = api.android.runtimeMainActivity()
    if (!main) return
    const window = main.getWindow()
    if (!window) return

    const light = theme === 'light'
    const background = themeBackground(theme, accent, contrast)
    const Color = api.android.importClass('android.graphics.Color')
    const color = Color.parseColor(background)
    const decor = window.getDecorView()

    // 先切状态栏/导航栏图标明暗。Android 15 上颜色接口可能被系统忽略，
    // 个别 ROM 甚至会直接抛错；不能让颜色调用挡住真正决定文字颜色的
    // appearance 设置，否则浅色页面会变成「白底 + 白字」。
    applyBarsAppearance(decor, light)

    // 每个颜色接口单独兜底：任一接口不可用都不影响后面的系统栏设置。
    try {
      if (typeof window.setNavigationBarColor === 'function') {
        window.setNavigationBarColor(color)
      }
    } catch {
      // 导航栏颜色不可用时保留系统默认。
    }
    // 自定义导航栏下原生状态栏底色不会自动跟随页面，必须显式设置；
    // 否则浅色模式会出现“黑底 + 深色图标”，看起来像状态栏消失了。
    try {
      if (typeof window.setStatusBarColor === 'function') {
        window.setStatusBarColor(color)
      }
    } catch {
      // Android 15 强制 edge-to-edge 时该接口可能是空操作。
    }
    // 窗口底色与页面一致，导航栏和 WebView 之间不会露出浅色边。
    try {
      const ColorDrawable = api.android.importClass('android.graphics.drawable.ColorDrawable')
      window.setBackgroundDrawable(new ColorDrawable(color))
    } catch {
      // 部分 ROM 不允许在运行中替换窗口底色，导航栏颜色已经足够。
    }

    // 颜色调用可能触发系统栏重建，最后再落实一次图标明暗。
    applyBarsAppearance(decor, light)
  } catch {
    // 接口不可用时保留系统默认配色。
  }
}
