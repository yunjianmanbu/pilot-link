/**
 * 安卓后台运行相关的系统设置入口。
 *
 * 国产 ROM（Honor/小米/OPPO/vivo）除了前台服务，还会按自己的「应用启动管理」
 * 清理后台。这里只负责把用户送到系统页面，不替用户改设置，也不申请任何
 * 绕过系统限制的能力。
 */

const PACKAGE_NAME = 'cc.medpilot.pilot'

function resolvePlus(plusApi) {
  if (plusApi?.android) return plusApi
  if (typeof plus !== 'undefined' && plus?.android) return plus
  return null
}

function invoke(android, target, method, ...args) {
  if (target && typeof target[method] === 'function') return target[method](...args)
  if (typeof android?.invoke === 'function') return android.invoke(target, method, ...args)
  return undefined
}

function mainActivity(api) {
  try {
    return api.android.runtimeMainActivity()
  } catch {
    return null
  }
}

function packageName(main) {
  try {
    const name = main?.getPackageName?.()
    if (name) return String(name)
  } catch {
    // 旧壳上 getPackageName 可能不可调用，退回清单里的包名。
  }
  return PACKAGE_NAME
}

function makeIntent(api, action) {
  const Intent = api.android.importClass('android.content.Intent')
  if (!Intent) return null
  const intent = new Intent()
  if (typeof intent.setAction === 'function') {
    intent.setAction(action)
  } else {
    invoke(api.android, intent, 'setAction', action)
  }
  return intent
}

function setIntentData(api, intent, uri) {
  const Uri = api.android.importClass('android.net.Uri')
  if (!Uri) return false
  const parsed =
    typeof Uri.parse === 'function' ? Uri.parse(uri) : invoke(api.android, Uri, 'parse', uri)
  if (!parsed) return false
  if (typeof intent.setData === 'function') {
    intent.setData(parsed)
  } else {
    invoke(api.android, intent, 'setData', parsed)
  }
  return true
}

function startActivity(api, main, intent) {
  invoke(api.android, main, 'startActivity', intent)
}

/**
 * 依次尝试：
 * 1. 系统「忽略电池优化」确认框（清单已声明 REQUEST_IGNORE_BATTERY_OPTIMIZATIONS）
 * 2. 电池优化列表
 * 3. 应用详情页（国产 ROM 的电池/自启动入口通常在这里）
 * 返回是否成功打开任意一个页面。
 */
export function openBatterySettings(plusApi) {
  const api = resolvePlus(plusApi)
  if (!api || api.os?.name !== 'Android') return false
  const main = mainActivity(api)
  if (!main) return false
  const pkg = packageName(main)
  const attempts = [
    ['android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', `package:${pkg}`],
    ['android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS', ''],
    ['android.settings.APPLICATION_DETAILS_SETTINGS', `package:${pkg}`]
  ]
  for (const [action, uri] of attempts) {
    try {
      const intent = makeIntent(api, action)
      if (!intent) return false
      if (uri && !setIntentData(api, intent, uri)) continue
      startActivity(api, main, intent)
      return true
    } catch {
      // 这个入口不被 ROM 接受，继续试下一个。
    }
  }
  return false
}

/**
 * 读取系统是否已忽略本应用的电池优化。
 * 返回 true / false；旧壳或调用失败时返回 null（界面显示「无法读取」）。
 */
export function isBatteryUnrestricted(plusApi) {
  const api = resolvePlus(plusApi)
  if (!api || api.os?.name !== 'Android') return null
  const main = mainActivity(api)
  if (!main) return null
  try {
    const power = invoke(api.android, main, 'getSystemService', 'power')
    if (!power) return null
    const result = invoke(
      api.android,
      power,
      'isIgnoringBatteryOptimizations',
      packageName(main)
    )
    return typeof result === 'boolean' ? result : null
  } catch {
    return null
  }
}
