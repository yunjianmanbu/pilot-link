/**
 * 复制与「选择复制」的临时文本传递。
 * App 逻辑层没有浏览器的 navigator.clipboard，统一走 uni.setClipboardData。
 */

const SELECTION_KEY = 'pilot-app.select-text.v1'

/** 把要选择复制的文本暂存起来，下一页通过 takeSelectionText 取走。 */
export function stageSelectionText(text) {
  const value = String(text || '')
  try {
    if (value) uni.setStorageSync(SELECTION_KEY, value)
    else uni.removeStorageSync(SELECTION_KEY)
  } catch {
    // 存储不可用时由页面提示为空。
  }
  return Boolean(value)
}

/** 读取并清除暂存文本，避免下次进入「选择复制」页时残留旧内容。 */
export function takeSelectionText() {
  let value = ''
  try {
    value = String(uni.getStorageSync(SELECTION_KEY) || '')
    uni.removeStorageSync(SELECTION_KEY)
  } catch {
    value = ''
  }
  return value
}

/** 浏览器环境（H5）的兜底复制，App 逻辑层没有 navigator.clipboard。 */
function browserCopy(value) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value).then(
      () => true,
      () => legacyCopy(value)
    )
  }
  return Promise.resolve(legacyCopy(value))
}

function legacyCopy(value) {
  if (typeof document === 'undefined' || !document.body) return false
  let area = null
  try {
    area = document.createElement('textarea')
    area.value = value
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '0'
    area.style.left = '-9999px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    area.setSelectionRange(0, area.value.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    if (area?.parentNode) area.parentNode.removeChild(area)
  }
}

/** 复制文本到系统剪贴板；resolve 是否成功。 */
export function copyText(text) {
  const value = String(text || '')
  if (!value) return Promise.resolve(false)
  const uniApi = typeof uni === 'undefined' ? null : uni
  if (!uniApi?.setClipboardData) return browserCopy(value)
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      if (ok) {
        resolve(true)
        return
      }
      // App 端保持原行为；H5 端 uni 可能拿不到剪贴板权限，再用浏览器兜底。
      browserCopy(value).then(resolve, () => resolve(false))
    }
    try {
      uniApi.setClipboardData({
        data: value,
        success: () => finish(true),
        fail: () => finish(false)
      })
    } catch {
      finish(false)
    }
  })
}
