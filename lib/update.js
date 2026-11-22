/**
 * App 在线更新。
 *
 * 下载站固定提供一份最新版本清单 latest.json，App 启动时静默检查一次
 * （30 分钟内不重复），也可以在设置页手动检查。确认更新后下载 APK、
 * 校验 SHA-256，再交给系统安装器覆盖安装（同一签名，设置与配对信息保留）。
 *
 * 只有 App（plus 运行时）支持；H5 / 小程序环境调用会直接返回不支持。
 */

import { sha256 } from '@noble/hashes/sha256'
import { closeAppDialog, openAppDialog } from './dialog.js'
import {
  loadAppliedWgtVersion,
  loadUpdateCheck,
  saveAppliedWgtVersion,
  saveUpdateCheck
} from './storage.js'
import { t } from './i18n.js'

export const UPDATE_MANIFEST_URL = 'https://download.medpilot.cc/pilot/android/latest.json'
export const DOWNLOAD_PAGE_URL = 'https://download.medpilot.cc/pilot/android/Pilot-latest.apk'
// 版本更新记录以官网为准：带 changelog=mobile 打开时官网会自动弹出记录，并切到手机端标签。
export const CHANGELOG_URL = 'https://pilot.medpilot.cc/?changelog=mobile'
// 分享给朋友时用官网地址：落地页上有 Windows 下载与扫码入口，比直接给 APK 链接好解释。
export const SHARE_APP_URL = 'https://pilot.medpilot.cc/'
const DOWNLOAD_HOST = 'download.medpilot.cc'
// 清单只有 1KB 出头，30 分钟一次可以忽略不计；曾经的 6 小时窗口是「修复
// 发出去、手机却看不见」的主因：手机 23:35 刚确认过「已是最新」，5 分钟后
// 发布的修复包就要等到第二天早上才会被检查到，用户只能干等或手动点版本号。
const CHECK_INTERVAL_MS = 30 * 60 * 1000
// 已经查到新版本、但用户还没装：只等 15 分钟就能再问一次——发出去的修复版
// 不该被上一版留下的窗口挡在门外。
const PENDING_INTERVAL_MS = 15 * 60 * 1000
const MAX_NOTES_LENGTH = 600

function toPositiveInt(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

function toHex(bytes) {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/** 比较版本名（如 1.0.2）用于缺少 versionCode 时的兜底判断。 */
export function compareVersionNames(a, b) {
  const left = String(a || '')
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number)
  const right = String(b || '')
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0)
    if (difference) return difference > 0 ? 1 : -1
  }
  return 0
}

export function isNewerVersion(manifest, current) {
  if (!manifest || !current) return false
  if (manifest.versionCode > 0 && current.versionCode > 0) {
    return manifest.versionCode > current.versionCode
  }
  return compareVersionNames(manifest.version, current.version) > 0
}

/**
 * 选择这次要装的产物。
 *
 * 清单顶层指全量 APK，wgt 是可选字段。规则是「原生优先」：
 * - 壳（安装包）比清单顶层旧时，必须先装全量包。原生能力（前台服务、Wi-Fi 锁、
 *   新权限）只能随 APK 下发，先装 wgt 会把运行版本号顶到全量包的版本上，用户
 *   之后再也收不到原生修复，表现就是「装了热更还是后台断线」。
 * - 壳已经跟全量包同一代时，才用 wgt 做小步更新（420KB 对 17.8MB）。
 */
export function resolveUpdateTarget(manifest, current) {
  if (!manifest || !current) return null
  if (isNewerVersion(manifest, current)) {
    return {
      kind: 'apk',
      version: manifest.version,
      url: manifest.url,
      sha256: manifest.sha256,
      size: manifest.size
    }
  }
  const wgt = manifest.wgt
  if (wgt && compareVersionNames(wgt.version, current.version) > 0) {
    return {
      kind: 'wgt',
      version: wgt.version,
      url: wgt.url,
      sha256: wgt.sha256,
      size: wgt.size
    }
  }
  return null
}

/**
 * 把清单投影成「本次真正要下载的产物」：下载、校验、安装只认
 * version/url/sha256/size，页面不必区分 wgt 与 APK。
 */
export function withUpdateTarget(manifest, current) {
  const target = resolveUpdateTarget(manifest, current)
  if (!target) return null
  return {
    ...manifest,
    ...target,
    apkVersion: manifest.version,
    apkVersionCode: manifest.versionCode,
    apkUrl: manifest.url,
    apkSha256: manifest.sha256,
    apkSize: manifest.size
  }
}

/**
 * 校验 APK 下载地址：必须使用 https、主机名恰好是下载站、端口只能是默认 443。
 *
 * 这里刻意不用浏览器的 `new URL()`：App 的逻辑层运行在 V8 / JSCore 里，
 * 没有提供这个全局对象，之前 `new URL()` 抛错会让整份清单被误判为格式不正确
 * （H5 有 URL，所以只有 App 端会复现）。
 */
function normalizeDownloadUrl(value) {
  const match = /^https:\/\/([^/?#:]+)(?::(\d+))?([/?#]|$)/i.exec(value)
  if (!match) return ''
  if (match[1].toLowerCase() !== DOWNLOAD_HOST) return ''
  if (match[2] && match[2] !== '443') return ''
  return value
}

/** 校验并规整下载站返回的清单，任何不合规字段都让整份清单失效。 */
export function normalizeUpdateManifest(value) {
  let data = value
  if (typeof data === 'string') {
    try {
      // 个别服务器 / 网络中间层会在 JSON 前带 BOM，JSON.parse 会直接失败。
      data = JSON.parse((data.charCodeAt(0) === 0xfeff ? data.slice(1) : data).trim())
    } catch {
      return null
    }
  }
  if (!data || typeof data !== 'object') return null
  const version = typeof data.version === 'string' ? data.version.trim() : ''
  const versionCode = toPositiveInt(data.versionCode)
  const url = typeof data.url === 'string' ? data.url.trim() : ''
  if (!version || !versionCode || !url) return null
  const downloadUrl = normalizeDownloadUrl(url)
  if (!downloadUrl) return null
  const digest = typeof data.sha256 === 'string' ? data.sha256.trim().toLowerCase() : ''
  const notes = typeof data.notes === 'string' ? data.notes.trim().slice(0, MAX_NOTES_LENGTH) : ''
  return {
    version,
    versionCode,
    url: downloadUrl,
    sha256: /^[0-9a-f]{64}$/.test(digest) ? digest : '',
    notes,
    force: data.force === true,
    size: toPositiveInt(data.size),
    wgt: normalizeWgtPayload(data.wgt)
  }
}

/**
 * 清单里的 wgt 资源包（uni-app 前端资源热更）：只替换 www 下的前端资源，
 * 不动原生壳，体积约为全量 APK 的四十分之一。
 *
 * 字段不合法时只丢弃 wgt，不影响同一份清单里的全量 APK：这样发布端写坏一个
 * 字段不会让所有老版本都检查不到更新。
 */
function normalizeWgtPayload(value) {
  if (!value || typeof value !== 'object') return null
  const version = typeof value.version === 'string' ? value.version.trim() : ''
  const rawUrl = typeof value.url === 'string' ? value.url.trim() : ''
  const digest = typeof value.sha256 === 'string' ? value.sha256.trim().toLowerCase() : ''
  // wgt 必须带 sha256：它是直接解压进 App 私有目录的代码，不能靠大小兜底。
  if (!version || !rawUrl || !/^[0-9a-f]{64}$/.test(digest)) return null
  const url = normalizeDownloadUrl(rawUrl)
  if (!url) return null
  return { version, url, sha256: digest, size: toPositiveInt(value.size) }
}

export function canSelfUpdate() {
  return typeof plus !== 'undefined' && !!plus?.runtime && typeof plus.runtime.install === 'function'
}

/** 当前安装的 App 版本；H5 等不支持的环境返回 null。 */
export function currentAppInfo() {
  if (!canSelfUpdate()) return null
  const info = typeof uni.getAppBaseInfo === 'function' ? uni.getAppBaseInfo() : null
  const shellVersion = String(info?.appVersion || plus.runtime.version || '').trim()
  const versionCode = toPositiveInt(info?.appVersionCode ?? plus.runtime.versionCode)
  // wgt 热更后 plus.runtime.version 正常会变成资源包版本；个别机型不会刷新，
  // 用本地记录兜底，否则每次启动都会重复提示同一个更新。
  const applied = loadAppliedWgtVersion()
  const version = applied && compareVersionNames(applied, shellVersion) > 0 ? applied : shellVersion
  return { version: version || t("未知"), versionCode }
}

export function fetchLatestManifest(timeout = 15000) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${UPDATE_MANIFEST_URL}?t=${Date.now()}`,
      method: 'GET',
      timeout,
      success(response) {
        if (response.statusCode !== 200) {
          reject(new Error(t("更新服务返回 {v1}", { v1: response.statusCode })))
          return
        }
        const manifest = normalizeUpdateManifest(response.data)
        if (!manifest) {
          reject(new Error(t("更新清单格式不正确")))
          return
        }
        resolve(manifest)
      },
      fail() {
        reject(new Error(t("无法连接更新服务，请检查网络")))
      }
    })
  })
}

export async function checkForUpdate() {
  const current = currentAppInfo()
  if (!current) return { supported: false, current: null, latest: null }
  const manifest = await fetchLatestManifest()
  return { supported: true, current, latest: withUpdateTarget(manifest, current) }
}

/** 读取安装包文件对象（不读内容），供分块校验使用。 */
function resolveFileObject(path) {
  return new Promise((resolve, reject) => {
    if (typeof plus === 'undefined' || !plus.io) {
      reject(new Error(t("当前环境不支持读取文件")))
      return
    }
    const attempt = (target, fallback) => {
      plus.io.resolveLocalFileSystemURL(
        target,
        (entry) => {
          entry.file(
            (file) => resolve(file),
            (error) => reject(new Error(error?.message || t("读取安装包失败")))
          )
        },
        (error) => {
          if (fallback) {
            fallback()
            return
          }
          reject(new Error(error?.message || t("读取安装包失败")))
        }
      )
    }
    // downloadFile 返回的可能是 _doc/ 相对路径，个别机型需要先转成绝对路径。
    attempt(path, () => {
      let absolute = ''
      try {
        absolute = plus.io.convertLocalFileSystemURL?.(path) || ''
      } catch {
        absolute = ''
      }
      if (!absolute || absolute === path) {
        reject(new Error(t("读取安装包失败")))
        return
      }
      attempt(absolute, null)
    })
  })
}

function readFileSize(path) {
  return resolveFileObject(path).then((file) => Number(file?.size) || 0)
}

/**
 * 读取一段文件并返回字节。必须分块：HTML5+ 桥接层无法直接传输大的
 * ArrayBuffer，17MB 的安装包一次性 readAsArrayBuffer 会一直没有回调，
 * 界面就永远停在「正在校验安装包完整性」。
 */
function readFileSlice(file, start, end) {
  return new Promise((resolve, reject) => {
    if (typeof plus === 'undefined' || !plus.io) {
      reject(new Error(t("当前环境不支持读取文件")))
      return
    }
    let target = file
    try {
      if (typeof file.slice === 'function') target = file.slice(start, end)
    } catch {
      target = file
    }
    const reader = new plus.io.FileReader()
    reader.onload = (event) => {
      const result = event?.target?.result
      if (!result) {
        reject(new Error(t("读取安装包失败")))
        return
      }
      resolve(new Uint8Array(result))
    }
    reader.onerror = () => reject(new Error(t("读取安装包失败")))
    reader.readAsArrayBuffer(target)
  })
}

const HASH_CHUNK_SIZE = 1024 * 1024
const HASH_TIMEOUT_MS = 30000
// 资源包只有几百 KB，读文件接口正常时一两秒内就能算完；超过 4 秒基本就是
// 桥接卡住，早点退回大小校验，别让用户一直停在「正在校验」。
const HASH_TIMEOUT_WGT_MS = 4000

function hashUnsupportedKey() {
  // 读文件卡住是原生桥接的问题，wgt 热更修不好它：按壳的 versionCode 记录，
  // 同一个壳上只空等一次，后续热更不再重复等超时；换壳后重新尝试哈希。
  const versionCode = toPositiveInt(currentAppInfo()?.versionCode)
  return `pilot.update.hashUnsupported.shell.${versionCode || 'unknown'}`
}

/** 当前版本上已经确认读文件接口不可用，直接走大小校验，不再空等。 */
function hashUnsupported() {
  try {
    return uni.getStorageSync(hashUnsupportedKey()) === '1'
  } catch {
    return false
  }
}

function markHashUnsupported() {
  try {
    uni.setStorageSync(hashUnsupportedKey(), '1')
  } catch {
    // ignore
  }
}

function withTimeout(promise, timeout, message) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(message))
    }, timeout)
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/** 分块读取并增量计算 SHA-256，避免大文件把桥接层卡死。 */
async function sha256File(path) {
  const file = await resolveFileObject(path)
  const size = Number(file?.size) || 0
  const hasher = sha256.create()
  if (size > 0 && typeof file.slice === 'function') {
    let offset = 0
    while (offset < size) {
      const end = Math.min(offset + HASH_CHUNK_SIZE, size)
      hasher.update(await readFileSlice(file, offset, end))
      offset = end
      // 每读几块让出一次事件循环，避免长时间占住 JS 线程。
      if (offset % (HASH_CHUNK_SIZE * 4) === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
    return toHex(hasher.digest())
  }
  // 个别环境没有 slice：只能整文件读取（调用方有超时兜底）。
  return toHex(sha256(await readFileSlice(file, 0, size || 0)))
}

/* ------------------------------------------------------------------ *
 * 下载状态
 *
 * 不再用不断刷新的 showLoading（会闪烁且遮罩挡住界面），改为模块级的
 * 可订阅状态：设置页展示进度条，会话列表展示一条紧凑横幅。下载使用
 * HTML5+ 原生下载器，退到后台或离开页面时仍会继续，完成后回调里校验
 * sha256 再提示安装。
 * ------------------------------------------------------------------ */

const downloadState = {
  status: 'idle', // idle | downloading | verifying | ready | installing | error
  kind: 'apk', // apk | wgt
  version: '',
  progress: 0,
  received: 0,
  total: 0,
  error: '',
  installerOpened: false
}
const downloadListeners = new Set()
let activeManifest = null
let lastManifest = null
let activeTask = null
let progressTimer = null
let downloadedFile = ''
// 已下载产物类型：apk = 全量安装包，wgt = 前端资源包（不走系统安装器）。
let downloadedKind = 'apk'
let readyPrompted = false
let cancelledTask = false
let finishing = false
let lastProgressNotify = 0

export function getUpdateDownloadState() {
  return { ...downloadState }
}

/** 订阅下载状态，返回取消订阅函数。Vue 页面用它实时更新进度。 */
export function subscribeUpdateDownload(listener) {
  if (typeof listener !== 'function') return () => {}
  downloadListeners.add(listener)
  try {
    listener(getUpdateDownloadState())
  } catch {
    // ignore
  }
  return () => {
    downloadListeners.delete(listener)
  }
}

function setDownloadState(patch) {
  Object.assign(downloadState, patch)
  const snapshot = getUpdateDownloadState()
  for (const listener of downloadListeners) {
    try {
      listener(snapshot)
    } catch {
      // ignore
    }
  }
}

function isDownloadBusy() {
  return (
    downloadState.status === 'downloading' ||
    downloadState.status === 'verifying' ||
    downloadState.status === 'installing'
  )
}

/** 下载百分比（0–100）；总大小未知时返回 0。 */
export function computeDownloadProgress(received, total) {
  const totalBytes = Number(total) || 0
  const receivedBytes = Math.max(0, Number(received) || 0)
  if (totalBytes <= 0) return 0
  return Math.max(0, Math.min(100, Math.floor((receivedBytes / totalBytes) * 100)))
}

/** 展示用的文件大小，例如 8.4 MB。 */
export function formatUpdateBytes(value) {
  const bytes = Math.max(0, Number(value) || 0)
  if (!bytes) return ''
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function toast(title) {
  try {
    uni.showToast({ title: String(title).slice(0, 60), icon: 'none', duration: 2200 })
  } catch {
    // ignore
  }
}

function openExternalPage(url, fallbackMessage) {
  try {
    if (typeof plus !== 'undefined' && plus?.runtime?.openURL) {
      plus.runtime.openURL(url)
      return
    }
    // H5 / 浏览器环境直接打开；App 内没有 plus 时也不至于无响应。
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      const opened = window.open(url, '_blank')
      if (opened) return
      window.location.href = url
      return
    }
    toast(fallbackMessage)
  } catch {
    toast(fallbackMessage)
  }
}

export function openUpdateDownloadPage() {
  openExternalPage(DOWNLOAD_PAGE_URL, t("请用浏览器打开下载页"))
}

/** 打开官网的版本更新记录；官网会识别 changelog=mobile 并直接弹出手机端记录。 */
export function openChangelogPage() {
  openExternalPage(CHANGELOG_URL, t("请用浏览器打开更新记录"))
}

/** 更新页可读取最近一次检查到的清单（跨页面共享，不依赖 URL 参数）。 */
export function getLastUpdateManifest() {
  return lastManifest
}

/** 打开独立更新页；传入清单时会记录下来，页面加载后自动开始下载。 */
export function openUpdatePage(manifest) {
  if (manifest) lastManifest = manifest
  try {
    uni.navigateTo({ url: '/pages/update/index' })
  } catch {
    toast(t("无法打开更新页面，请在设置中更新"))
  }
}

function hasNativeDownloader() {
  return (
    typeof plus !== 'undefined' &&
    !!plus?.downloader &&
    typeof plus.downloader.createDownload === 'function'
  )
}

function nativeDownloadPath(manifest) {
  // plus.downloader 只允许写到 _downloads/、_doc/ 或 _documents/ 下；
  // _doc 是 App 私有目录，不依赖存储权限。文件名带版本号便于覆盖旧包。
  const version = String(manifest?.version || 'latest').replace(/[^0-9A-Za-z._-]/g, '')
  // wgt 必须用 .wgt 扩展名：plus.runtime.install 靠它区分资源包和 APK。
  const suffix = manifest?.kind === 'wgt' ? 'wgt' : 'apk'
  return `_doc/Pilot-${version || 'latest'}.${suffix}`
}

/** statechanged 在部分机型上不够平滑，用一个轻量定时器兜底刷新进度。 */
function stopProgressTimer() {
  if (progressTimer) {
    clearInterval(progressTimer)
    progressTimer = null
  }
}

function startProgressTimer(task) {
  stopProgressTimer()
  progressTimer = setInterval(() => {
    if (!activeTask || activeTask !== task || cancelledTask) {
      stopProgressTimer()
      return
    }
    updateDownloadProgress(task)
  }, 500)
}

function updateDownloadProgress(task) {
  if (!activeManifest) return
  const total = Number(task?.totalSize) > 0 ? Number(task.totalSize) : Number(activeManifest.size) || 0
  const received = Math.max(0, Number(task?.downloadedSize) || 0)
  const progress = computeDownloadProgress(received, total)
  const now = Date.now()
  // 百分比没变且距上次通知不到 700ms 时跳过，避免高频 setData。
  if (
    downloadState.status === 'downloading' &&
    progress === downloadState.progress &&
    now - lastProgressNotify < 700
  ) {
    return
  }
  lastProgressNotify = now
  setDownloadState({ status: 'downloading', progress, received, total })
}

async function finishDownload(path, totalSize) {
  if (finishing || cancelledTask || !activeManifest) return
  finishing = true
  stopProgressTimer()
  const manifest = activeManifest
  const total = Number(totalSize) || downloadState.total || Number(manifest.size) || 0
  const received = total || downloadState.received
  setDownloadState({ status: 'verifying', progress: total ? 100 : 0, received, total })
  try {
    if (!path) throw new Error(t("下载文件不存在，请重试"))
    if (manifest.sha256) {
      const expected = Number(manifest.size) || Number(total) || 0
      let digest = ''
      // 先比大小：大小已经对不上时哈希一定不过，直接失败，省掉整包读取。
      const actualSize = await readFileSize(path).catch(() => 0)
      if (expected > 0 && actualSize > 0 && actualSize !== expected) {
        throw new Error(t("安装包校验失败，请重新下载"))
      }
      if (hashUnsupported()) {
        // 本壳已经确认桥接读文件会卡住：只核对大小，避免每次更新都空等。
        if (!(actualSize > 0 && expected > 0 && actualSize === expected)) {
          throw new Error(t("安装包校验失败，请重新下载"))
        }
      } else {
        const timeout = manifest.kind === 'wgt' ? HASH_TIMEOUT_WGT_MS : HASH_TIMEOUT_MS
        try {
          digest = await withTimeout(sha256File(path), timeout, t("校验安装包超时"))
        } catch (error) {
          // 个别机型读取大文件会卡住：退化为文件大小校验，并记住这个壳
          // 无法计算哈希，后续更新直接用大小校验。
          // 下载本身走 HTTPS，大小完全一致时继续安装，避免更新彻底不可用。
          if (!(actualSize > 0 && expected > 0 && actualSize === expected)) throw error
          markHashUnsupported()
          digest = ''
        }
      }
      if (cancelledTask) return
      if (digest && digest !== manifest.sha256) throw new Error(t("安装包校验失败，请重新下载"))
    }
    if (cancelledTask) return
    downloadedFile = path
    downloadedKind = manifest.kind === 'wgt' ? 'wgt' : 'apk'
    setDownloadState({ status: 'ready', progress: 100, received: total, total, error: '' })
    promptReadyInstall()
  } catch (error) {
    if (!cancelledTask) failDownload(error?.message || t("安装包校验失败，请重试"))
  } finally {
    finishing = false
  }
}

function failDownload(message) {
  stopProgressTimer()
  activeTask = null
  const text = String(message || t("下载失败")).slice(0, 120)
  setDownloadState({ status: 'error', error: text })
  toast(t("{v1}，可在设置中重试", { v1: text }))
}

function removeLocalFile(path) {
  // 重新下载前清掉旧的同名文件，避免残留半个安装包导致校验失败。
  return new Promise((resolve) => {
    try {
      plus.io.resolveLocalFileSystemURL(
        path,
        (entry) => entry.remove(() => resolve(), () => resolve()),
        () => resolve()
      )
    } catch {
      resolve()
    }
  })
}

async function startNativeDownload(manifest) {
  const filename = nativeDownloadPath(manifest)
  await removeLocalFile(filename)
  if (cancelledTask || !activeManifest) return
  let task
  try {
    task = plus.downloader.createDownload(
      manifest.url,
      {
        filename,
        timeout: 120,
        retry: 3,
        retryInterval: 5
      },
      (download, status) => {
        // 下载结束回调；statechanged 里也处理一次完成，靠 activeTask 去重。
        if (cancelledTask || activeTask !== task) return
        activeTask = null
        stopProgressTimer()
        const code = Number(status)
        if (code === 200 && download?.filename) {
          void finishDownload(download.filename, Number(download.totalSize) || 0)
          return
        }
        failDownload(code ? t("下载失败（{v1}）", { v1: code }) : t("下载失败，请检查网络后重试"))
      }
    )
  } catch (error) {
    failDownload(error?.message || t("无法开始下载"))
    return
  }
  if (!task || typeof task.start !== 'function') {
    failDownload(t("无法开始下载"))
    return
  }
  activeTask = task
  task.addEventListener(
    'statechanged',
    (updated) => {
      if (cancelledTask || activeTask !== task) return
      const state = Number(updated?.state)
      if (state === 1 || state === 2 || state === 3) {
        // 1 = 开始，2 = 已连接，3 = 接收数据（真正持续触发进度的是 3）。
        // 部分服务器不返回总大小，此时进度条保持 0，但已下载大小仍会更新。
        updateDownloadProgress(updated)
      } else if (state === 4) {
        activeTask = null
        stopProgressTimer()
        void finishDownload(updated?.filename || '', Number(updated?.totalSize) || 0)
      } else if (state === 5) {
        activeTask = null
        stopProgressTimer()
        failDownload(t("下载失败，请检查网络后重试"))
      }
    },
    false
  )
  try {
    task.start()
  } catch (error) {
    activeTask = null
    failDownload(error?.message || t("无法开始下载"))
    return
  }
  startProgressTimer(task)
}

function startUniDownload(manifest) {
  // 没有 plus.downloader 时的兜底（例如个别自定义基座），进度同样走状态订阅。
  let task
  try {
    task = uni.downloadFile({
      url: manifest.url,
      success: (response) => {
        activeTask = null
        if (cancelledTask) return
        if (response.statusCode !== 200 || !response.tempFilePath) {
          failDownload(t("下载失败（{v1}）", { v1: response.statusCode || t('无响应') }))
          return
        }
        void finishDownload(response.tempFilePath, Number(manifest.size) || 0)
      },
      fail: () => {
        activeTask = null
        if (!cancelledTask) failDownload(t("下载失败，请检查网络后重试"))
      }
    })
  } catch (error) {
    failDownload(error?.message || t("无法开始下载"))
    return
  }
  activeTask = task
  if (task && typeof task.onProgressUpdate === 'function') {
    task.onProgressUpdate((event) => {
      if (cancelledTask || activeTask !== task) return
      const total = Number(event?.totalBytes) || Number(manifest.size) || 0
      const progress = Math.max(0, Math.min(100, Number(event?.progress) || 0))
      updateDownloadProgress({
        totalSize: total,
        downloadedSize: total > 0 ? (total * progress) / 100 : 0
      })
    })
  }
}

/** 开始后台下载。返回 false 表示当前环境不支持或已有下载在进行。 */
export function startUpdateDownload(manifest) {
  if (!manifest?.url || !canSelfUpdate() || isDownloadBusy()) return false
  // uni.downloadFile 落盘的是没有后缀的临时文件，plus.runtime.install 靠 .wgt 后缀
  // 区分资源包，没原生下载器时直接退回全量 APK，避免装不上又不知道原因。
  const target =
    manifest.kind === 'wgt' && !hasNativeDownloader() && manifest.apkUrl
      ? {
          ...manifest,
          kind: 'apk',
          version: manifest.apkVersion || manifest.version,
          url: manifest.apkUrl,
          sha256: manifest.apkSha256 || '',
          size: Number(manifest.apkSize) || 0
        }
      : manifest
  stopProgressTimer()
  activeManifest = target
  lastManifest = target
  downloadedFile = ''
  downloadedKind = 'apk'
  readyPrompted = false
  cancelledTask = false
  finishing = false
  lastProgressNotify = 0
  setDownloadState({
    status: 'downloading',
    kind: target.kind === 'wgt' ? 'wgt' : 'apk',
    version: String(target.version || ''),
    progress: 0,
    received: 0,
    total: Number(target.size) || 0,
    error: '',
    installerOpened: false
  })
  toast(t("已开始下载更新，可退出此页，下载会在后台继续"))
  if (hasNativeDownloader()) startNativeDownload(target)
  else startUniDownload(target)
  return true
}

/** 失败后重试最近一次下载。 */
export function retryUpdateDownload() {
  if (!lastManifest) return false
  return startUpdateDownload(lastManifest)
}

/** 取消正在进行的下载（已完成但未安装的包不会删除）。 */
export function cancelUpdateDownload() {
  // 正在校验或已交给系统安装器时不再取消，避免状态和系统界面不一致。
  if (downloadState.status !== 'downloading' && downloadState.status !== 'verifying') return false
  cancelledTask = true
  stopProgressTimer()
  const task = activeTask
  activeTask = null
  try {
    if (task && typeof task.abort === 'function') task.abort()
  } catch {
    // ignore
  }
  finishing = false
  activeManifest = null
  downloadedFile = ''
  setDownloadState({
    status: 'idle',
    version: '',
    progress: 0,
    received: 0,
    total: 0,
    error: '',
    installerOpened: false
  })
  toast(t("已取消更新下载"))
  return true
}

function describeInstallError(error) {
  if (!error) return ''
  const message = error.message || error.msg || ''
  const code = error.code
  if (message && code !== undefined && code !== null && code !== '') return `${message}（${code}）`
  if (message) return message
  return code !== undefined && code !== null && code !== '' ? t("错误码 {v1}", { v1: code }) : ''
}

/** 调起系统安装器安装已校验的安装包。 */
export function installDownloadedUpdate() {
  if (downloadState.status !== 'ready' || !downloadedFile) {
    toast(t("安装包尚未准备好"))
    return false
  }
  const path = downloadedFile
  setDownloadState({ status: 'installing', error: '', installerOpened: false })
  if (downloadedKind === 'wgt') return installWgtPackage(path)
  let settled = false
  const opened = () => {
    if (settled) return
    settled = true
    // 系统安装器已打开；用户可能取消，因此保留安装包和 ready 状态。
    setDownloadState({ status: 'ready', installerOpened: true })
    toast(t("已打开系统安装程序，请按提示完成安装"))
  }
  const failed = (error) => {
    if (settled) return
    settled = true
    setDownloadState({ status: 'ready', error: '' })
    const detail = describeInstallError(error)
    void openAppDialog({
      title: t("无法打开安装程序"),
      message: t("{v1}\n可以重试；如果仍然失败，请到更新页点「用浏览器下载」手动安装。", { v1: detail || t('应用内安装没有成功') }),
      cancelText: t("关闭"),
      confirmText: t("重试"),
      icon: '!',
      danger: true
    }).then((confirmed) => {
      if (confirmed) installDownloadedUpdate()
    })
  }
  // 某些离线打包配置缺少 install-apk 原生模块时 plus.runtime.install 会直接失败，
  // 此时用 plus.runtime.openFile 带上 APK MIME 仍可调起系统安装界面。
  const fallbackOpenFile = (error) => {
    if (settled) return
    try {
      plus.runtime.openFile(path, opened, (openError) => failed(openError || error))
    } catch (openException) {
      failed(openException || error)
    }
  }
  try {
    plus.runtime.install(path, { force: false }, opened, (error) => fallbackOpenFile(error))
  } catch (error) {
    fallbackOpenFile(error)
  }
  return true
}

/**
 * 安装 wgt 资源包：不走系统安装器，plus.runtime.install 会让运行时直接解压覆盖
 * www 下的前端资源，然后必须 restart 才会生效。
 *
 * 失败时不尝试 openFile（系统不认识 .wgt），而是引导用户下载全量安装包。
 */
function installWgtPackage(path) {
  const version = String(activeManifest?.version || downloadState.version || '')
  let settled = false
  const promptManualRestart = () => {
    setDownloadState({ status: 'ready', installerOpened: false })
    void openAppDialog({
      title: t("更新已安装"),
      message: t("请完全退出并重新打开应用，新版本才会生效。"),
      cancelText: '',
      confirmText: t("关闭"),
      icon: '✓'
    })
  }
  const done = () => {
    if (settled) return
    settled = true
    // 先落盘再重启：个别机型重启后 plus.runtime.version 不会变成资源包版本。
    saveAppliedWgtVersion(version)
    // 收起确认弹框并进入「正在应用更新」。这里刻意不弹 toast：系统 toast
    // 属于通知层，重启后还会在屏幕上停一会儿，看起来像卡住了。
    closeAppDialog(false)
    try {
      uni.hideToast()
    } catch {
      // ignore
    }
    setDownloadState({ status: 'installing', installerOpened: true })
    setTimeout(() => {
      try {
        plus.runtime.restart()
      } catch {
        promptManualRestart()
        return
      }
      // 重启成功时进程会被替换，下面的定时器不会执行；3 秒后页面还在，
      // 说明重启没有真正发生，改为明确提示用户手动重新打开。
      setTimeout(promptManualRestart, 3000)
    }, 400)
  }
  const failed = (error) => {
    if (settled) return
    settled = true
    setDownloadState({ status: 'ready', error: '' })
    const detail = describeInstallError(error) || t('应用内安装没有成功')
    void openAppDialog({
      title: t("资源包安装失败"),
      message: t("{v1}。可以重试，或下载完整安装包覆盖更新。", { v1: detail }),
      cancelText: t("关闭"),
      confirmText: t("下载完整安装包"),
      icon: '!',
      danger: true
    }).then((confirmed) => {
      if (confirmed) openUpdateDownloadPage()
    })
  }
  try {
    plus.runtime.install(path, { force: true }, done, failed)
  } catch (error) {
    failed(error)
  }
  return true
}

function promptReadyInstall() {
  if (readyPrompted || !activeManifest) return
  readyPrompted = true
  const isWgt = activeManifest.kind === 'wgt'
  void openAppDialog({
    title: t("更新 v{v1} 已下载", { v1: activeManifest.version }),
    message: isWgt
      ? t("更新包已在后台下载并校验完成。安装后 App 会自动重启；配对信息和设置都会保留。")
      : t("安装包已在后台下载并校验完成。可以立即安装，也可以稍后在设置页安装；覆盖安装会保留配对信息和设置。"),
    cancelText: t("稍后"),
    confirmText: isWgt ? t("立即重启并更新") : t("立即安装"),
    icon: '↓'
  }).then((confirmed) => {
    if (confirmed) installDownloadedUpdate()
  })
}

function promptInstall(latest, current = null) {
  const isWgt = latest.kind === 'wgt'
  // 壳比全量包旧时，回前台重连这类原生问题只能靠完整安装包。版本名一样时
  // 再弹「发现新版本 v1.0.56」会让人以为是重复提示，所以改成明说是完整包。
  const nativeOnly =
    !isWgt && Boolean(current) && compareVersionNames(latest.version, current.version) <= 0
  void openAppDialog({
    title: nativeOnly
      ? t("需要安装完整包 v{v1}", { v1: latest.version })
      : t("发现新版本 v{v1}", { v1: latest.version }),
    message:
      latest.notes ||
      (nativeOnly
        ? t("这一版改在原生层（后台保活、权限），只有完整安装包能生效；安装后配对和设置都会保留。")
        : isWgt
          ? t("有新的前端更新可以安装，只需下载 {v1}，安装后 App 会自动重启。", {
              v1: formatUpdateBytes(latest.size)
            })
          : t("有新的版本可以更新，安装后配对信息会保留。")),
    cancelText: latest.force ? '' : t("稍后"),
    confirmText: t("立即更新"),
    icon: '↑'
  }).then((confirmed) => {
    // 进入独立更新页：进度条、取消/重试、安装以及浏览器下载都集中在那里。
    if (confirmed) openUpdatePage(latest)
  })
}

/**
 * 检查更新并按需弹出提示。
 * manual=false 时做 30 分钟节流；manual=true 时总会请求并给出结果提示。
 */
export async function checkAndPromptUpdate({ manual = false } = {}) {
  if (!canSelfUpdate()) {
    if (manual) {
      void openAppDialog({
        title: t("应用更新"),
        message: t("当前环境不支持应用内安装更新，可以打开下载页，用浏览器下载最新安装包。"),
        cancelText: t("关闭"),
        confirmText: t("浏览器下载"),
        icon: '↓'
      }).then((confirmed) => {
        if (confirmed) openUpdateDownloadPage()
      })
    }
    return { supported: false }
  }
  if (isDownloadBusy()) {
    if (manual) toast(t("更新正在下载中"))
    return { busy: true, state: getUpdateDownloadState() }
  }
  if (downloadState.status === 'ready' && downloadedFile) {
    if (manual) {
      const isWgt = (lastManifest?.kind || downloadState.kind) === 'wgt'
      void openAppDialog({
        title: t("更新 v{v1} 已下载", { v1: lastManifest?.version || '' }),
        message: isWgt
          ? t("更新包已下载并校验完成，是否立即重启应用？配对信息和设置都会保留。")
          : t("安装包已经下载并校验完成，是否立即安装？覆盖安装会保留配对信息和设置。"),
        cancelText: t("稍后"),
        confirmText: isWgt ? t("立即重启并更新") : t("立即安装"),
        icon: '↓'
      }).then((confirmed) => {
        if (confirmed) installDownloadedUpdate()
      })
    }
    return { supported: true, ready: true, latest: lastManifest, current: currentAppInfo() }
  }
  if (!manual && isCheckThrottled(loadUpdateCheck())) return { throttled: true }
  let result
  try {
    result = await checkForUpdate()
  } catch (error) {
    // 请求失败不写节流记录：网络恢复后第一次回到前台就该重试。
    // 之前这里在请求「之前」就写时间，一次失败等于整个节流窗口不再检查更新。
    if (manual) toast(error?.message || t("检查更新失败"))
    return { error: error?.message || t("检查更新失败") }
  }
  if (!result.latest) {
    saveUpdateCheck({ at: Date.now(), hasUpdate: false })
    if (manual) toast(t("已是最新版本 v{v1}", { v1: result.current.version }))
    return { supported: true, latest: null, current: result.current }
  }
  // 记下「有更新但还没装」，节流窗口从 30 分钟缩到 15 分钟。
  saveUpdateCheck({ at: Date.now(), hasUpdate: true })
  promptInstall(result.latest, result.current)
  return { supported: true, latest: result.latest, current: result.current }
}

/**
 * 静默检查是否还在节流窗口内。
 *
 * 「确认已是最新」等 30 分钟；「有未安装的新版本」只等 15 分钟——发出去的
 * 修复版不该被上一版留下的窗口挡在门外。
 */
export function isCheckThrottled(last, now = Date.now()) {
  const at = toPositiveInt(last?.at)
  if (!at) return false
  const window = last?.hasUpdate === true ? PENDING_INTERVAL_MS : CHECK_INTERVAL_MS
  return now - at < window
}

/** 启动后静默检查（由 App.vue 延迟调用）。 */
export function autoCheckUpdate() {
  return checkAndPromptUpdate({ manual: false })
}
