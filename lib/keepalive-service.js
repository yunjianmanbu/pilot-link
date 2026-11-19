/**
 * Android 前台服务保活。
 *
 * App 退到后台后，JS 定时器和 WebView 可能被系统冻结；只靠 JS 里的
 * PARTIAL_WAKE_LOCK 只能保持 CPU 不休眠，挡不住系统把整个进程回收。真正
 * 稳定的做法是让壳里的 `PilotKeepAliveService` 以前台服务身份运行：进程重要
 * 级别升高，心跳和原生 WebSocket 都能继续存活，回到前台时不需要重建连接。
 *
 * 服务类只存在于离线壳（1.0.55+）。旧壳、H5、iOS 上 start 会失败并静默
 * 返回 false，调用方继续使用原来的后台唤醒锁兜底。
 */

const SERVICE_CLASS = 'cc.medpilot.pilot.PilotKeepAliveService'
// android.os.Build.VERSION_CODES.O
const ANDROID_O = 26

let servicePlus = null
// 最近一次启动尝试的结果。设置页把它显示出来：没有这条信息时，用户只能看到
// 「还是断」，分不清是服务没启动、进程被回收，还是网络断了。
let lastStatus = { started: false, error: '' }

/** 返回最近一次启动结果；error 是简短的失败原因，供诊断显示。 */
export function getKeepAliveStatus() {
  return { ...lastStatus }
}

function resolvePlus(plusApi) {
  if (plusApi) return plusApi
  try {
    return typeof plus !== 'undefined' ? plus : null
  } catch {
    return null
  }
}

function androidCall(android, target, method, ...args) {
  if (!target) return null
  if (typeof target[method] === 'function') return target[method](...args)
  if (android && typeof android.invoke === 'function') {
    return android.invoke(target, method, ...args)
  }
  return null
}

function serviceIntent(api) {
  const main = api.android.runtimeMainActivity()
  if (!main) return null
  const Intent = api.android.importClass('android.content.Intent')
  if (!Intent) return null
  // 只依赖 Android 框架类，不 import 自己的 Service 类：旧壳没有这个类时
  // startService 会失败，但 importClass 不会先抛错；新壳则按类名正常拉起。
  const intent = new Intent()
  const pkg =
    typeof main.getPackageName === 'function'
      ? main.getPackageName()
      : 'cc.medpilot.pilot'
  if (typeof intent.setClassName === 'function') {
    intent.setClassName(pkg, SERVICE_CLASS)
  } else {
    androidCall(api.android, intent, 'setClassName', pkg, SERVICE_CLASS)
  }
  return { main, intent }
}

/**
 * 启动前台服务。必须在 App 处于前台时调用（例如建立连接、回到前台），
 * Android 12+ 不允许普通后台进程随意启动前台服务。
 *
 * `force`：回到前台时用。ROM 会在后台把服务杀掉，但 JS 里的 servicePlus 仍
 * 缓存着「已经在跑」，不重新下发就会永远不再启动。重复下发是安全的：服务已在
 * 运行时就只是再走一次 onStartCommand。
 */
export function startKeepAliveService(plusApi, options = {}) {
  const api = resolvePlus(plusApi)
  if (!api?.android || api.os?.name !== 'Android') {
    lastStatus = { started: false, error: 'not-android' }
    return false
  }
  if (servicePlus && options.force !== true) return true
  try {
    const resolved = serviceIntent(api)
    if (!resolved) {
      lastStatus = { started: false, error: 'no-activity-or-intent' }
      return false
    }
    const sdk = Number(api.os?.version || 0)
    if (sdk >= ANDROID_O) {
      androidCall(api.android, resolved.main, 'startForegroundService', resolved.intent)
    } else {
      androidCall(api.android, resolved.main, 'startService', resolved.intent)
    }
    servicePlus = api
    lastStatus = { started: true, error: '' }
    return true
  } catch (err) {
    // 旧壳没有服务类时这里会抛 ActivityNotFoundException 一类错误；只记类名
    // 和消息，不把堆栈写进存储。
    const message = String(err?.message || err || 'start-failed')
    lastStatus = { started: false, error: message.slice(0, 160) }
    servicePlus = null
    return false
  }
}

/** 解除配对或主动断开时停掉服务，避免留下无用的常驻通知。 */
export function stopKeepAliveService(plusApi) {
  const api = servicePlus || resolvePlus(plusApi)
  const wasRunning = Boolean(servicePlus)
  servicePlus = null
  lastStatus = { started: false, error: '' }
  if (!api?.android || api.os?.name !== 'Android') return false
  try {
    const resolved = serviceIntent(api)
    if (!resolved) return false
    androidCall(api.android, resolved.main, 'stopService', resolved.intent)
    return wasRunning
  } catch {
    return wasRunning
  }
}
