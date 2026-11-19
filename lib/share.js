/**
 * 系统分享：把文字交给手机自带的分享面板（微信、飞书、邮件、备忘录…）。
 *
 * uni-app 的逻辑层没有浏览器的 navigator.share，Android / iOS 走 uni.shareWithSystem，
 * 老一点的基座只有 plus.share.sendWithSystem；两者都没有（H5、测试环境）或者系统
 * 拒绝分享时退回剪贴板复制，保证内容一定带得走。
 * 这里只做「拼文本 + 调分享」，不碰页面状态，方便单测。
 */

import { copyText } from './clipboard.js'

/** 纯文本经系统分享要过 Intent/Binder，过长部分 ROM 会截断甚至失败，留足余量。 */
export const SHARE_TEXT_LIMIT = 6000
/** 截断标记，和正文空一行，免得被当成最后一句内容。 */
export const SHARE_TRUNCATED_MARK = '\n\n…'

/**
 * 基座缺 Share 模块时（dcloud_properties.xml 没注册），5+ 每次访问 plus.share
 * 都会抛一次「打包时未加入 share 模块」。第一次撞到就记住，后面直接走剪贴板，
 * 免得用户每点一次分享都白等一次失败。
 */
let shareModuleMissing = false

/** 只识别「模块没打进包」这一种错误，别的失败（比如系统面板报错）仍然按故障处理。 */
export function looksLikeMissingModule(error) {
  const message = String((error && (error.errMsg || error.message)) || error || '')
  return /未加入\s*share\s*模块|share\s*模块/i.test(message)
}

/** 单测需要复位这个一次性状态。 */
export function resetShareModuleState() {
  shareModuleMissing = false
}

/** 不传 api 时的运行时探测：App 基座上 plus 与 uni 同时存在，plus 更底层。 */
function defaultScope() {
  // App 的 service 层里 plus 一定在，uni 只是它的包装；老版本没有 globalThis，
  // 所以按 plus → uni → globalThis 的顺序找，绝不先落到会抛错的 uni 包装上。
  if (typeof plus !== 'undefined' && plus) return { plus }
  if (typeof uni !== 'undefined' && uni) return { uni }
  if (typeof globalThis !== 'undefined') return globalThis
  return null
}

/** plus.share：没打进 Share 模块的基座上，读这个属性本身就会抛「打包时未加入 share 模块」。 */
function resolvePlusShare(plusApi) {
  let share = null
  try {
    share = plusApi ? plusApi.share : null
  } catch {
    return null
  }
  if (!share || typeof share.sendWithSystem !== 'function') return null
  return (payload) =>
    share.sendWithSystem({
      type: 'text',
      content: payload.summary,
      success: payload.success,
      fail: payload.fail
    })
}

/**
 * 浏览器 Web Share API：H5 / PWA 里这就是系统分享面板（Chrome Android、iOS Safari）。
 * 桌面浏览器和 Firefox 没有这个方法，返回 null 让调用方继续退到剪贴板。
 */
function resolveWebShare(scope) {
  let nav = scope && scope.navigator
  if (!nav) {
    try {
      nav = typeof navigator === 'undefined' ? null : navigator
    } catch {
      nav = null
    }
  }
  if (!nav || typeof nav.share !== 'function') return null
  return (payload) => {
    let pending
    try {
      pending = nav.share({
        text: payload.summary,
        ...(payload.href ? { url: payload.href } : {})
      })
    } catch (error) {
      payload.fail(error)
      return
    }
    if (!pending || typeof pending.then !== 'function') {
      payload.success()
      return
    }
    pending.then(
      () => payload.success(),
      (error) => {
        // 用户取消时 navigator.share 抛 AbortError。shareText 靠文案识别「取消」，
        // 这里补上可读原因，否则会被当成失败而又去写剪贴板。
        const name = String((error && error.name) || '')
        payload.fail(name === 'AbortError' ? { errMsg: 'share cancelled' } : error)
      }
    )
  }
}

/** 找到当前运行时可用的系统分享入口。
 * 测试可以传入 `{ shareWithSystem(){…} }` 这样的假实现。
 */
function resolveSharer(api) {
  const scope = api || defaultScope()
  if (!scope) return null
  // 拿得到 plus 就以 plus.share 为准：uni.shareWithSystem 是它的包装，Share 模块
  // 缺失时调用会抛「打包时未加入 share 模块」，用户只会看到一条莫名其妙的报错。
  // 这时返回 null，让 shareText 走剪贴板兜底，内容照样带得走。
  if (scope.plus) return resolvePlusShare(scope.plus)
  if (scope.share && typeof scope.share.sendWithSystem === 'function') {
    return resolvePlusShare({ share: scope.share })
  }
  const uniApi = scope.uni || (typeof scope.shareWithSystem === 'function' ? scope : null)
  if (uniApi && typeof uniApi.shareWithSystem === 'function') {
    return (payload) => uniApi.shareWithSystem(payload)
  }
  return resolveWebShare(scope)
}

/** 当前环境是否支持系统分享面板。 */
export function canShareWithSystem(api) {
  return Boolean(resolveSharer(api))
}

/** 去掉首尾空白、统一换行、折叠三行以上空行。 */
export function normalizeShareText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 按上限截断文本，同时告诉界面有没有被截断。 */
export function clipShareText(value, limit = SHARE_TEXT_LIMIT) {
  const text = normalizeShareText(value)
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : SHARE_TEXT_LIMIT
  if (text.length <= max) return { text, truncated: false }
  return { text: `${text.slice(0, max).trimEnd()}${SHARE_TRUNCATED_MARK}`, truncated: true }
}

/**
 * 把标题、若干条目和落款拼成一段纯文本。
 * entries 每项是 `{ label, time, text }`：label/time 由页面本地化后传进来，
 * 空正文的条目（纯图片、工具调用）直接跳过。
 */
export function formatShareText({ heading = '', entries = [], footer = '', limit = SHARE_TEXT_LIMIT } = {}) {
  const blocks = []
  const title = normalizeShareText(heading)
  if (title) blocks.push(title)
  let count = 0
  for (const entry of Array.isArray(entries) ? entries : []) {
    const body = normalizeShareText(entry && entry.text)
    if (!body) continue
    count += 1
    const meta = [normalizeShareText(entry.label), normalizeShareText(entry.time)].filter(Boolean).join(' · ')
    blocks.push(meta ? `${meta}\n${body}` : body)
  }
  const note = normalizeShareText(footer)
  if (note) blocks.push(note)
  const clipped = clipShareText(blocks.join('\n\n'), limit)
  return { text: clipped.text, count, truncated: clipped.truncated }
}

/** 把 ISO 字符串或毫秒时间戳格式化成「2026-11-15 09:12」，认不出就返回空串。 */
export function shareTimeLabel(value) {
  if (!value) return ''
  let date = null
  if (value instanceof Date) {
    date = value
  } else if (typeof value === 'number') {
    date = new Date(value)
  } else {
    const text = String(value)
    const numeric = Number(text)
    date = Number.isFinite(numeric) && !/[T:\-]/.test(text) ? new Date(numeric) : new Date(text)
  }
  if (!date || Number.isNaN(date.getTime())) return ''
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

function looksCancelled(error) {
  const message = String((error && (error.errMsg || error.message)) || error || '')
  return /cancel|取消/i.test(message)
}

/**
 * 分享一段文本。
 * 返回 `{ ok, copied, reason, text }`：ok=true 表示分享面板已接住；copied=true 表示
 * 退回了剪贴板；系统里点了取消时不复制，避免用户取消后剪贴板被悄悄改写。
 */
export async function shareText(value, options = {}) {
  const { text } = clipShareText(value, options.limit)
  if (!text) return { ok: false, copied: false, reason: 'empty', text: '' }
  const sharer = shareModuleMissing ? null : resolveSharer(options.api)
  if (sharer) {
    const result = await new Promise((resolve) => {
      let settled = false
      const done = (payload) => {
        if (settled) return
        settled = true
        resolve(payload)
      }
      try {
        sharer({
          summary: text,
          ...(options.url ? { href: String(options.url) } : {}),
          success: () => done({ ok: true }),
          // fail 和 complete 谁先来不确定，用 settled 兜住重复回调。
          fail: (error) => done({ ok: false, error }),
          complete: () => done({ ok: true })
        })
      } catch (error) {
        done({ ok: false, error })
      }
    })
    if (result.ok) return { ok: true, copied: false, reason: 'shared', text }
    if (looksCancelled(result.error)) return { ok: false, copied: false, reason: 'cancelled', text }
    // 基座没打 Share 模块：记下来，别再让「打包时未加入 share 模块」这种
    // 面向开发者的报错反复出现在用户面前，直接静默转剪贴板。
    if (looksLikeMissingModule(result.error)) shareModuleMissing = true
  }
  const copier = typeof options.copy === 'function' ? options.copy : copyText
  let copied = false
  try {
    copied = Boolean(await copier(text))
  } catch {
    copied = false
  }
  return { ok: false, copied, reason: copied ? 'copied' : 'copy-failed', text }
}
