/**
 * 启动图（splash）兜底关闭。
 *
 * 背景：App 冷启动时进应用会出现整屏黑色的情况（深色启动图铺满全屏），
 * 切到后台再回到前台就恢复正常。原因是 5+ 运行时的启动图在等「首屏渲染完成」
 * 后再自动关闭，而 pages/launch 在 onLoad 里就用 reLaunch 切走了首页 WebView，
 * 渲染完成事件可能投递不到启动图控制器，启动图便一直挂着；Activity 重新
 * resume 时运行时会强制移除启动图，所以「切后台回来就恢复了」。
 *
 * 这里做纯客户端兜底：首页渲染完（onReady）后再跳转，同时在 App.vue 里按
 * 超时强制关闭启动图，避免任何情况下被启动图挡住。
 * 只影响手机端；H5 或没有 plus 的环境直接跳过。
 */

/** 启动图兜底关闭的默认延时（毫秒）。 */
export const SPLASH_GUARD_MS = 800

/**
 * 多次兜底关闭的时间点（毫秒）。
 *
 * 只关一次并不可靠：冷启动时 WebView 和 plus 启动图视图的创建可能晚于 800ms
 * （低端机 + 17MB 的全量包尤其明显），那时候调用关闭接口会被运行时忽略，
 * 启动图就永远留在界面上。这里错开几个时间点反复关，并在目标页面渲染完成
 * 后再关一次，任何一条路径生效就够。
 */
export const SPLASH_RETRY_DELAYS = [300, 1000, 2500, 5000]

function resolvePlus(plusApi) {
  if (plusApi) return plusApi
  try {
    return typeof plus !== 'undefined' ? plus : null
  } catch {
    return null
  }
}

/** 把传入的延时归一成非负毫秒数，非法值用默认值。 */
export function resolveSplashDelay(value, fallback = SPLASH_GUARD_MS) {
  const base = Number(fallback)
  const safeFallback = Number.isFinite(base) && base >= 0 ? base : SPLASH_GUARD_MS
  // 空值和空字符串按「没配置」处理，不能落成 0，否则等于立即强关启动图。
  if (value === undefined || value === null || value === '') return safeFallback
  const delay = Number(value)
  if (Number.isFinite(delay) && delay >= 0) return delay
  return safeFallback
}

/**
 * 立即关闭启动图。返回是否真的调用了原生接口。
 * 接口不存在或 ROM 拒绝时静默返回 false，不影响 App 使用。
 */
export function closeSplash(plusApi) {
  const api = resolvePlus(plusApi)
  const navigator = api && api.navigator
  if (!navigator || typeof navigator.closeSplashscreen !== 'function') return false
  try {
    navigator.closeSplashscreen()
    return true
  } catch {
    return false
  }
}

/**
 * 延时兜底关闭启动图，返回定时器句柄（便于页面销毁时清理）。
 * 定时器与 plus 都按调用时的全局环境解析，H5 下只是一个空转的 setTimeout。
 */
export function scheduleSplashClose(plusApi, options = {}) {
  const scheduler =
    typeof options.setTimeout === 'function'
      ? options.setTimeout
      : typeof setTimeout === 'function'
        ? setTimeout
        : null
  if (!scheduler) return null
  const delay = resolveSplashDelay(options.delay)
  const api = plusApi !== undefined && plusApi !== null ? plusApi : undefined
  return scheduler(() => {
    closeSplash(api)
  }, delay)
}

/**
 * 按 SPLASH_RETRY_DELAYS 反复尝试关闭启动图，返回取消函数。
 * 启动流程里要在任何可能抛错的初始化之前调用，保证兜底一定挂上。
 */
export function installSplashGuard(options = {}) {
  const scheduler =
    typeof options.setTimeout === 'function'
      ? options.setTimeout
      : typeof setTimeout === 'function'
        ? setTimeout
        : null
  if (!scheduler) return () => {}
  const clearer =
    typeof options.clearTimeout === 'function'
      ? options.clearTimeout
      : typeof clearTimeout === 'function'
        ? clearTimeout
        : null
  const api = options.plus !== undefined && options.plus !== null ? options.plus : undefined
  const delays =
    Array.isArray(options.delays) && options.delays.length
      ? options.delays
      : SPLASH_RETRY_DELAYS
  let cancelled = false
  const timers = delays.map((item) =>
    scheduler(() => {
      // 已经取消时即使定时器还是触发了也不能再动启动图。
      if (cancelled) return
      closeSplash(api)
    }, resolveSplashDelay(item, SPLASH_GUARD_MS))
  )
  return () => {
    cancelled = true
    if (!clearer) return
    for (const timer of timers) {
      try {
        clearer(timer)
      } catch {
        // 定时器句柄失效（已触发）时忽略。
      }
    }
  }
}
