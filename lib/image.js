
import { t } from './i18n.js'

/**
 * 选择图片并压缩成 data URL，作为多模态消息发送给电脑端。
 *
 * 电脑端把图片保存在会话 JSON 里，而会话还要通过加密中继回传手机：
 * 单条密文上限 512 KB，所以单张图片控制在 120 KB 字符以内，
 * 三张正好留在预算内。
 *
 * 选中后立即用本地临时路径出缩略图（<image> 和 previewImage 对本地路径最稳），
 * data URL 只用于发送。App 端读取文件走 plus.io.FileReader：文件系统管理器
 * 只在部分运行时才有，之前直接依赖它会让真机上「选完图片什么都不显示」。
 */

const MAX_EDGE = 1600
const MIN_EDGE = 420
const MAX_DATA_URL = 120_000
const MAX_SOURCE_BYTES = 20 * 1024 * 1024
const H5_QUALITY_STEPS = [0.82, 0.7, 0.58, 0.46]
// App 端 uni.compressImage 的质量步进：先在同一尺寸下降质量，仍超预算再缩边。
const NATIVE_QUALITY_STEPS = [62, 40]
const NATIVE_QUALITY_STEPS_SMALL = [52, 34]

const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  bmp: 'image/bmp',
  gif: 'image/gif'
}

function chooseImage(count = 1) {
  return new Promise((resolve, reject) => {
    uni.chooseImage({
      count: Math.max(1, Math.min(9, Number(count) || 1)),
      sizeType: ['compressed', 'original'],
      sourceType: ['album', 'camera'],
      success: resolve,
      fail: (error) => {
        const message = String(error?.errMsg || '')
        // 用户主动取消不算错误，不弹提示。
        if (/cancel/i.test(message)) resolve(null)
        else reject(new Error(t("无法读取所选图片，请重试")))
      }
    })
  })
}

function mimeOf(filePath) {
  const ext = String(filePath || '')
    .split(/[?#]/)[0]
    .split('.')
    .pop()
    .toLowerCase()
  return MIME_BY_EXT[ext] || 'image/jpeg'
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(t("图片解析失败，请换一张图片")))
    image.src = src
  })
}

function drawToDataUrl(source, width, height, quality, maxEdge) {
  const scale = Math.min(1, (maxEdge || MAX_EDGE) / Math.max(width, height))
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const context = canvas.getContext('2d')
  // 白底可以避免透明背景在 JPEG 里变成黑块，也更容易识别。
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, targetWidth, targetHeight)
  context.drawImage(source, 0, 0, targetWidth, targetHeight)
  return canvas.toDataURL('image/jpeg', quality)
}

/** 逐步缩小最长边、降低质量，直到 data URL 落进单图预算。 */
function canvasToDataUrlWithinBudget(source, width, height) {
  let edge = Math.min(MAX_EDGE, Math.max(width, height))
  let dataUrl = ''
  while (edge >= MIN_EDGE) {
    for (const quality of H5_QUALITY_STEPS) {
      dataUrl = drawToDataUrl(source, width, height, quality, edge)
      if (dataUrl.length <= MAX_DATA_URL) break
    }
    if (dataUrl && dataUrl.length <= MAX_DATA_URL) break
    edge = Math.round(edge * 0.75)
  }
  return dataUrl
}

async function blobToDataUrl(blob) {
  if (blob.size > MAX_SOURCE_BYTES) {
    throw new Error(t("图片太大，请选择 20 MB 以内的图片"))
  }
  let source
  if (typeof createImageBitmap === 'function') {
    source = await createImageBitmap(blob)
  } else {
    source = await loadImageElement(URL.createObjectURL(blob))
  }
  const width = source.width || source.naturalWidth
  const height = source.height || source.naturalHeight
  const dataUrl = canvasToDataUrlWithinBudget(source, width, height)
  source.close?.()
  if (!dataUrl || dataUrl.length > MAX_DATA_URL) {
    throw new Error(t("图片太大，请先裁剪后再试"))
  }
  return dataUrl
}

function getImageInfo(src) {
  if (typeof uni.getImageInfo !== 'function') return Promise.resolve(null)
  return new Promise((resolve) => {
    uni.getImageInfo({
      src,
      success: (info) => resolve(info),
      fail: () => resolve(null)
    })
  })
}

function compressNative(src, { width, quality } = {}) {
  if (typeof uni.compressImage !== 'function') return Promise.resolve('')
  return new Promise((resolve) => {
    const options = { src, quality: quality ?? 70, success: (res) => resolve(res.tempFilePath || ''), fail: () => resolve('') }
    if (width) options.width = width
    uni.compressImage(options)
  })
}

/** App 端：plus.io 的 FileReader 支持 readAsDataURL，真机上比文件管理器可靠。 */
function plusDataUrl(filePath) {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error(t("无法读取图片文件，请重新选择")))
    if (typeof plus === 'undefined' || !plus.io || typeof plus.io.FileReader !== 'function') {
      fail()
      return
    }
    try {
      plus.io.resolveLocalFileSystemURL(
        filePath,
        (entry) => {
          entry.file(
            (file) => {
              const reader = new plus.io.FileReader()
              reader.onload = (event) => {
                const result = String(event?.target?.result || '')
                if (/^data:image\//i.test(result)) resolve(result)
                else fail()
              }
              reader.onerror = fail
              reader.readAsDataURL(file)
            },
            fail
          )
        },
        fail
      )
    } catch {
      fail()
    }
  })
}

/** 兜底：部分运行时提供 uni.getFileSystemManager()，按扩展名拼 data URL。 */
function managerDataUrl(filePath) {
  return new Promise((resolve, reject) => {
    let manager = null
    try {
      manager = typeof uni.getFileSystemManager === 'function' ? uni.getFileSystemManager() : null
    } catch {
      manager = null
    }
    if (!manager || typeof manager.readFile !== 'function') {
      reject(new Error(t("无法读取图片文件，请重新选择")))
      return
    }
    manager.readFile({
      filePath,
      encoding: 'base64',
      success: (res) => resolve(`data:${mimeOf(filePath)};base64,${String(res.data || '')}`),
      fail: () => reject(new Error(t("无法读取图片文件，请重新选择")))
    })
  })
}

async function readNativeDataUrl(filePath) {
  try {
    return await plusDataUrl(filePath)
  } catch {
    return managerDataUrl(filePath)
  }
}

/** App 端：先走原生压缩，失败或压不进预算时退回 webview canvas。 */
async function nativeImageToDataUrl(filePath) {
  const info = await getImageInfo(filePath)
  const hasInfo = Boolean(info && info.width > 0 && info.height > 0)
  const sourceEdge = hasInfo ? Math.max(info.width, info.height) : MAX_EDGE
  const aspect = hasInfo ? info.width / sourceEdge : 1
  let readFailure = null
  let sawReadableFile = false

  if (typeof uni.compressImage === 'function') {
    let edge = Math.min(MAX_EDGE, sourceEdge || MAX_EDGE)
    while (edge >= MIN_EDGE) {
      const width = Math.max(1, Math.round(edge * aspect))
      const qualities = edge > 1000 ? NATIVE_QUALITY_STEPS : NATIVE_QUALITY_STEPS_SMALL
      for (const quality of qualities) {
        const compressed = await compressNative(filePath, { width, quality })
        if (!compressed) break
        try {
          const dataUrl = await readNativeDataUrl(compressed)
          sawReadableFile = true
          if (dataUrl.length <= MAX_DATA_URL) return dataUrl
        } catch (error) {
          // 读不了压缩结果就先放弃原生压缩，改走下面的 canvas 兜底。
          readFailure = error
          break
        }
      }
      edge = Math.round(edge * 0.75)
    }
  }

  // uni.compressImage 不可用或尺寸参数被忽略时，读出原图交给 canvas 重编码。
  // 大图会慢一些，但比「选完图片什么都不显示」可靠。
  try {
    const original = await readNativeDataUrl(filePath)
    sawReadableFile = true
    const image = await loadImageElement(original)
    const width = image.width || image.naturalWidth || sourceEdge
    const height = image.height || image.naturalHeight || sourceEdge
    const dataUrl = canvasToDataUrlWithinBudget(image, width, height)
    if (dataUrl && dataUrl.length <= MAX_DATA_URL) return dataUrl
  } catch (error) {
    readFailure = error
  }

  // 一个文件都读不出来是环境问题（文件管理器/FileReader 不可用），
  // 不要报成「图片太大」误导用户。
  if (!sawReadableFile && readFailure) throw readFailure
  throw new Error(t("图片太大，请先裁剪后再试"))
}

/**
 * 读一张选中的图片，返回 { preview, url }：
 * - preview 给 <image> / previewImage 用（App 上是本地临时路径，H5 上是 data URL）
 * - url 是发送给电脑端的 data URL
 */
async function readPickedImage(result, index) {
  const file = result.tempFiles?.[index]
  if (typeof Blob !== 'undefined' && file?.file instanceof Blob) {
    const url = await blobToDataUrl(file.file)
    return { preview: url, url }
  }

  const filePath = result.tempFilePaths?.[index] || file?.path || ''
  if (!filePath) throw new Error(t("没有读取到图片，请重新选择"))
  if (file?.size && file.size > MAX_SOURCE_BYTES) {
    throw new Error(t("图片太大，请选择 20 MB 以内的图片"))
  }

  const isApp =
    typeof plus !== 'undefined' || typeof uni.getFileSystemManager === 'function'
  if (isApp && !/^(blob:|https?:|data:)/i.test(filePath)) {
    const url = await nativeImageToDataUrl(filePath)
    return { preview: filePath, url }
  }

  // H5 拿到的是 blob: / http(s) URL。
  const response = await fetch(filePath)
  if (!response.ok) throw new Error(t("无法读取所选图片，请重试"))
  const url = await blobToDataUrl(await response.blob())
  return { preview: url, url }
}

/**
 * 让用户选图，返回 { preview, url } 数组；取消选择时返回空数组。
 * 单张失败不影响其他图片，全部失败才把原因抛给页面。
 */
export async function pickImageAttachments(count = 3) {
  const result = await chooseImage(count)
  if (!result) return []
  const total = Math.min(
    Math.max(1, Number(count) || 1),
    result.tempFiles?.length || result.tempFilePaths?.length || 1
  )
  const items = []
  let failure = null
  for (let index = 0; index < total; index += 1) {
    try {
      const item = await readPickedImage(result, index)
      if (item?.url) items.push(item)
    } catch (error) {
      failure = error
    }
  }
  if (!items.length && failure) throw failure
  return items
}

/** 只要 data URL 的旧接口。 */
export async function pickImageDataUrls(count = 3) {
  const items = await pickImageAttachments(count)
  return items.map((item) => item.url).filter(Boolean)
}

/** 让用户选一张图片，返回压缩后的 data URL；取消选择时返回空字符串。 */
export async function pickImageDataUrl() {
  const [url] = await pickImageDataUrls(1)
  return url || ''
}
