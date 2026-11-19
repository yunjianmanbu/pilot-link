/**
 * 运行环境判定：同一个 uni-app 源码既要编成 Android App（有 plus 运行时），
 * 也要编成 H5 / PWA（跑在浏览器里）。凡是"只有原生层才能做"的入口 —— 后台保活、
 * 本地文件缓存、APK 更新 —— 在网页版必须换说法或直接不显示，否则用户点下去
 * 只会拿到一条「当前环境不支持」的报错。
 *
 * 判定只看运行时特征，不依赖编译期宏：这样 Node 单测里也能直接构造 scope 来验证。
 */

/** 有 plus 运行时即视为原生 App（Android / iOS 打包版）。 */
export function hasNativeRuntime(scope) {
  const runtime = scope && typeof scope === 'object' ? scope : globalThis
  try {
    return Boolean(runtime && runtime.plus && runtime.plus.runtime !== undefined)
  } catch {
    // 基座没打进某些模块时，读属性本身也可能抛错，按"没有原生能力"处理。
    return false
  }
}

/** 跑在浏览器里（H5 / 装到主屏幕的 PWA）：有 window 但没有 plus。 */
export function isWebRuntime(scope) {
  const runtime = scope && typeof scope === 'object' ? scope : globalThis
  if (hasNativeRuntime(runtime)) return false
  try {
    return typeof runtime === 'object' && runtime !== null && typeof runtime.document === 'object'
  } catch {
    return false
  }
}

/** 网页版里给用户看的运行方式；原生版返回空串，由调用方用 App 版本号。 */
export function runtimeLabel(scope) {
  return isWebRuntime(scope) ? '网页版' : ''
}
