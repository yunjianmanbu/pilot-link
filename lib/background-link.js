/**
 * 后台保持长连接。
 *
 * WebSocket 由原生层维持，但心跳、断线发现和自动重连都跑在 JS 里。Android
 * 退到后台后会限制后台执行：JS 定时器被冻结或降频，网络也可能被挂起，表现
 * 就是「切出去一会儿再回来，连接已经断了」。
 *
 * 这里在 App 进入后台时申请一个 PARTIAL_WAKE_LOCK（只保持 CPU 运行，不点亮
 * 屏幕），让心跳和重连继续跑；回到前台立即释放，避免不必要地耗电。进程本身
 * 仍可能被系统或厂商省电策略回收，那种情况只能等下次回到前台重连。
 *
 * 只影响 Android App；其它环境或 ROM 不开放接口时静默跳过。
 */

// android.os.PowerManager.PARTIAL_WAKE_LOCK
const PARTIAL_WAKE_LOCK = 1
const WAKE_LOCK_TAG = 'Pilot:connection'

let wakeLock = null
let wakeLockPlus = null

function resolvePlus(plusApi) {
  if (plusApi) return plusApi
  try {
    return typeof plus !== 'undefined' ? plus : null
  } catch {
    return null
  }
}

/** Native.js 的方法通常直接挂在对象上，个别机型需要退回 plus.android.invoke。 */
function androidCall(android, target, method, ...args) {
  if (!target) return null
  if (typeof target[method] === 'function') return target[method](...args)
  if (android && typeof android.invoke === 'function') {
    return android.invoke(target, method, ...args)
  }
  return null
}

/** App 退到后台：持有 CPU 唤醒锁，让连接心跳和重连继续。返回是否成功。 */
export function keepLinkAlive(plusApi) {
  const api = resolvePlus(plusApi)
  if (!api?.android || api.os?.name !== 'Android') return false
  if (wakeLock) return true
  try {
    const main = api.android.runtimeMainActivity()
    if (!main) return false
    const manager = androidCall(api.android, main, 'getSystemService', 'power')
    if (!manager) return false
    const lock = androidCall(
      api.android,
      manager,
      'newWakeLock',
      PARTIAL_WAKE_LOCK,
      WAKE_LOCK_TAG
    )
    if (!lock) return false
    // 自己管理引用计数：重复调用只申请一次，回到前台释放一次即可。
    try {
      androidCall(api.android, lock, 'setReferenceCounted', false)
    } catch {
      // 老系统没有这个方法也不影响 acquire/release。
    }
    androidCall(api.android, lock, 'acquire')
    wakeLock = lock
    wakeLockPlus = api
    return true
  } catch {
    return false
  }
}

/** App 回到前台：释放后台持有的唤醒锁。 */
export function releaseLinkKeepAlive() {
  const lock = wakeLock
  const api = wakeLockPlus
  wakeLock = null
  wakeLockPlus = null
  if (!lock) return false
  try {
    androidCall(api?.android, lock, 'release')
    return true
  } catch {
    return false
  }
}
