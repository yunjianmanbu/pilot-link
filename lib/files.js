/**
 * 电脑端生成文件的传输与类型识别。
 *
 * 手机和电脑之间只有中继长连接，没有可直接访问的 HTTP 文件地址，所以文件
 * 按 128 KB 分块通过加密请求读取：文本/图片直接读进内存预览，文档类写入
 * App 私有目录后再交给系统应用打开。
 *
 * 这里不 import Vue（App 的逻辑层没有 vue，Node 单元测试也不安装它）。
 */

import { concatBytes, utf8Decode, utf8Encode } from './bytes.js'
import { t } from './i18n.js'
import { mediaKindOf } from './media.js'

export const FILE_CHUNK_SIZE = 128 * 1024
export const TEXT_PREVIEW_LIMIT = 512 * 1024
export const IMAGE_PREVIEW_LIMIT = 12 * 1024 * 1024
export const DOWNLOAD_LIMIT = 100 * 1024 * 1024
const WRITE_TIMEOUT_MS = 15_000
const DOC_DIR = 'pilot-files'

const IMAGE_TYPES = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  avif: 'image/avif'
})

// 这些文本格式在 App 内直接预览；HTML 既可看源码，也可在受限 WebView 里
// 渲染效果（脚本、表单和跨域请求都会被 CSP 禁掉）。
const TEXT_EXTENSIONS = new Set([
  'txt',
  'log',
  'json',
  'jsonl',
  'csv',
  'tsv',
  'md',
  'markdown',
  'html',
  'htm',
  'xml',
  'yml',
  'yaml',
  'toml',
  'ini',
  'conf',
  'css',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'vue',
  'py',
  'java',
  'c',
  'h',
  'cpp',
  'hpp',
  'go',
  'rs',
  'sh',
  'ps1',
  'sql',
  'bat'
])

// 需要调用系统文档查看器的办公/电子书格式。
export const DOCUMENT_TYPES = new Set([
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'pdf',
  'rtf',
  'odt',
  'ods',
  'odp',
  'pages',
  'numbers',
  'key'
])

const STD_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const STD_B64_LOOKUP = (() => {
  const table = new Int16Array(256).fill(-1)
  for (let index = 0; index < STD_B64.length; index += 1) {
    table[STD_B64.charCodeAt(index)] = index
  }
  return table
})()

function platformPlus() {
  try {
    return typeof plus === 'undefined' ? null : plus
  } catch {
    return null
  }
}

function platformUni() {
  try {
    return typeof uni === 'undefined' ? null : uni
  } catch {
    return null
  }
}

export function extensionOf(name) {
  const matched = /\.([^./\\]+)$/.exec(String(name || '').trim())
  return matched ? matched[1].toLowerCase() : ''
}

/** text / markdown / image / video / audio / document / binary */
export function fileKind(name) {
  const ext = extensionOf(name)
  if (IMAGE_TYPES[ext]) return 'image'
  const media = mediaKindOf(name)
  if (media) return media
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  if (DOCUMENT_TYPES.has(ext)) return 'document'
  return 'binary'
}

export function isImageName(name) {
  return Boolean(IMAGE_TYPES[extensionOf(name)])
}

export function isHtmlName(name) {
  const ext = extensionOf(name)
  return ext === 'html' || ext === 'htm'
}

export function mimeTypeOf(name) {
  return IMAGE_TYPES[extensionOf(name)] || 'application/octet-stream'
}

export function fileActionLabel(action) {
  if (action === 'edit') return t("修改")
  if (action === 'generate') return t("生成")
  if (action === 'notebook') return t("修改")
  return t("新增")
}

export function fileBadge(name) {
  const ext = extensionOf(name)
  if (!ext) return 'FILE'
  return ext.slice(0, 4).toUpperCase()
}

export function formatFileSize(bytes) {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`
  if (value < 1024 * 1024 * 1024) {
    const mb = value / (1024 * 1024)
    return `${mb >= 100 ? mb.toFixed(0) : mb.toFixed(1)} MB`
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** 只保留文件名本身，去掉路径字符和控制字符，供本地保存使用。 */
export function safeFileName(name) {
  const base = String(name || '')
    .split(/[\\/]/)
    .pop()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
  const cleaned = base || 'file'
  if (cleaned.length <= 120) return cleaned
  const ext = extensionOf(cleaned) ? `.${extensionOf(cleaned)}` : ''
  return cleaned.slice(0, Math.max(1, 120 - ext.length)) + ext
}

export function localDirPath() {
  return `_doc/${DOC_DIR}`
}

export function localFilePathFor(name) {
  return `${localDirPath()}/${safeFileName(name)}`
}

/* ------------------------------------------------------------------ */
/* base64                                                              */
/* ------------------------------------------------------------------ */

export function base64ToBytes(value) {
  if (typeof value !== 'string') throw new Error(t("文件数据格式不正确"))
  const text = value.replace(/\s+/g, '').replace(/=+$/, '')
  const bytes = new Uint8Array(Math.floor((text.length * 6) / 8))
  let buffer = 0
  let bits = 0
  let offset = 0
  for (let index = 0; index < text.length; index += 1) {
    const code = STD_B64_LOOKUP[text.charCodeAt(index)]
    if (code < 0) throw new Error(t("文件数据格式不正确"))
    buffer = ((buffer << 6) | code) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[offset] = (buffer >>> bits) & 0xff
      offset += 1
    }
  }
  return bytes.subarray(0, offset)
}

export function bytesToBase64(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let output = ''
  let index = 0
  for (; index + 2 < source.length; index += 3) {
    const value = (source[index] << 16) | (source[index + 1] << 8) | source[index + 2]
    output +=
      STD_B64[(value >>> 18) & 63] +
      STD_B64[(value >>> 12) & 63] +
      STD_B64[(value >>> 6) & 63] +
      STD_B64[value & 63]
  }
  const remain = source.length - index
  if (remain === 1) {
    const value = source[index] << 16
    output += `${STD_B64[(value >>> 18) & 63]}${STD_B64[(value >>> 12) & 63]}==`
  } else if (remain === 2) {
    const value = (source[index] << 16) | (source[index + 1] << 8)
    output += `${STD_B64[(value >>> 18) & 63]}${STD_B64[(value >>> 12) & 63]}${
      STD_B64[(value >>> 6) & 63]
    }=`
  }
  return output
}

export function imageDataUrl(name, bytes) {
  return `data:${mimeTypeOf(name)};base64,${bytesToBase64(bytes)}`
}

/* ------------------------------------------------------------------ */
/* 读取                                                                */
/* ------------------------------------------------------------------ */

/**
 * 分块读取电脑上的文件。request 是 store 导出的 request(method, params, timeout)。
 * 返回 bytes 最多 maxBytes，truncated 表示文件更大、只取了前面一段。
 */
export async function readRemoteBytes(request, options = {}) {
  const path = String(options.path || '')
  if (!path) throw new Error(t("缺少文件路径"))
  const workspacePath = String(options.workspacePath || '')
  if (!workspacePath) throw new Error(t("缺少工作区信息，请返回会话后重新打开文件"))
  const maxBytes = Math.max(1, Number(options.maxBytes) || TEXT_PREVIEW_LIMIT)
  const chunkSize = Number(options.chunkSize) || FILE_CHUNK_SIZE
  const timeout = Number(options.timeout) || 60_000
  const parts = []
  let received = 0
  let offset = 0
  let size = 0
  let truncated = false
  let meta = null

  while (true) {
    const data = await request(
      'files.read',
      { workspacePath, file: path, offset, length: chunkSize },
      timeout
    )
    if (!data || typeof data.data !== 'string') throw new Error(t("电脑返回的文件数据不正确"))
    meta = data
    size = Number(data.size) || size
    const chunk = base64ToBytes(data.data)
    const room = maxBytes - received
    if (chunk.length >= room) {
      parts.push(chunk.subarray(0, room))
      received += Math.min(chunk.length, room)
      truncated = size > received
      break
    }
    if (chunk.length > 0) {
      parts.push(chunk)
      received += chunk.length
    }
    offset = (Number(data.offset) || offset) + chunk.length
    if (options.onProgress) options.onProgress({ received, total: size })
    if (data.eof === true || chunk.length === 0 || (size > 0 && offset >= size)) break
    if (received > DOWNLOAD_LIMIT) throw new Error(t("文件过大，无法在手机端读取"))
  }

  return {
    bytes: concatBytes(...parts),
    size: size || received,
    name: meta?.name || '',
    mtime: Number(meta?.mtime) || 0,
    truncated
  }
}

export async function readRemoteText(request, options = {}) {
  const result = await readRemoteBytes(request, {
    ...options,
    maxBytes: Number(options.maxBytes) || TEXT_PREVIEW_LIMIT
  })
  return {
    text: utf8Decode(result.bytes),
    size: result.size,
    name: result.name,
    mtime: result.mtime,
    truncated: result.truncated
  }
}

/* ------------------------------------------------------------------ */
/* HTML 预览                                                           */
/* ------------------------------------------------------------------ */

/**
 * 工作区里的 HTML 可能是任意内容。预览用 CSP 禁掉脚本、表单、iframe 和
 * 跨域请求，只保留内联样式与 HTTPS 图片/字体：报告能看出排版和颜色，
 * 但不会在 WebView 里执行代码或把本地内容发出去。
 */
const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline' https:",
  "img-src data: https:",
  "font-src data: https:",
  "media-src data: https:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi
const SCRIPT_ORPHAN = /<script\b[^>]*\/?>/gi
const META_REFRESH = /<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi
const BASE_TAG = /<base\b[^>]*>/gi

/** 把 HTML 包装成可安全加载的预览文档。 */
export function htmlPreviewDocument(html, name = '') {
  const cleaned = String(html ?? '')
    .replace(SCRIPT_BLOCK, '')
    .replace(SCRIPT_ORPHAN, '')
    .replace(META_REFRESH, '')
    .replace(BASE_TAG, '')
  const head =
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">`

  if (/<head\b[^>]*>/i.test(cleaned)) {
    return cleaned.replace(/<head\b[^>]*>/i, (tag) => `${tag}${head}`)
  }
  if (/<html\b[^>]*>/i.test(cleaned)) {
    return cleaned.replace(/<html\b[^>]*>/i, (tag) => `${tag}<head>${head}</head>`)
  }
  const title = safeFileName(name || 'page.html').replace(/[<>&"]/g, '')
  return `<!doctype html><html><head>${head}<title>${title}</title></head><body>${cleaned}</body></html>`
}

/** 把本地绝对路径转成 WebView 能加载的 file:// 地址。 */
export function fileUrlOf(filePath) {
  const value = String(filePath || '')
  if (!value) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value
  const normalized = value.replace(/\\/g, '/')
  return encodeURI(`file://${normalized.startsWith('/') ? '' : '/'}${normalized}`)
}

/* ------------------------------------------------------------------ */
/* 写入（App 端）                                                       */
/* ------------------------------------------------------------------ */

function toError(value, fallback) {
  if (value instanceof Error) return value
  const message = value?.message || value?.errMsg || value?.code
  return new Error(message ? String(message) : fallback)
}

function requestFileSystem(plusApi) {
  return new Promise((resolve, reject) => {
    try {
      const type = plusApi.io.PRIVATE_DOC
      plusApi.io.requestFileSystem(
        type,
        (fs) => resolve(fs),
        (error) => reject(toError(error, t("无法访问手机存储")))
      )
    } catch (error) {
      reject(toError(error, t("无法访问手机存储")))
    }
  })
}

async function ensureDocumentDir(plusApi) {
  const fs = await requestFileSystem(plusApi)
  return new Promise((resolve, reject) => {
    fs.root.getDirectory(
      DOC_DIR,
      { create: true },
      (entry) => resolve(entry),
      (error) => reject(toError(error, t("无法创建下载目录")))
    )
  })
}

function removeExisting(dirEntry, name) {
  return new Promise((resolve) => {
    try {
      dirEntry.getFile(
        name,
        { create: false },
        (entry) => {
          try {
            entry.remove(
              () => resolve(),
              () => resolve()
            )
          } catch {
            resolve()
          }
        },
        () => resolve()
      )
    } catch {
      resolve()
    }
  })
}

/** 只查已有文件，不存在时给出 null 而不是 reject。 */
function findEntry(dirEntry, name) {
  return new Promise((resolve) => {
    try {
      dirEntry.getFile(
        name,
        { create: false },
        (entry) => resolve(entry),
        () => resolve(null)
      )
    } catch {
      resolve(null)
    }
  })
}

function createEntry(dirEntry, name) {
  return new Promise((resolve, reject) => {
    dirEntry.getFile(
      name,
      { create: true },
      (entry) => resolve(entry),
      (error) => reject(toError(error, t("无法创建本地文件")))
    )
  })
}

function createWriter(entry) {
  return new Promise((resolve, reject) => {
    entry.createWriter(
      (writer) => resolve(writer),
      (error) => reject(toError(error, t("无法写入本地文件")))
    )
  })
}

/** plus.io.FileWriter 没有回调参数，只能等 onwriteend 事件推进下一块。 */
function writeBinary(writer, base64, position) {
  if (typeof writer.writeAsBinary !== 'function') {
    return Promise.reject(new Error(t("当前 App 版本不支持写入文件，请升级 App")))
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => fail(new Error(t("写入文件超时，请重试"))), WRITE_TIMEOUT_MS)
    const cleanup = () => {
      clearTimeout(timer)
      writer.onwriteend = null
      writer.onerror = null
    }
    const done = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(toError(error, t("写入文件失败")))
    }
    writer.onwriteend = done
    writer.onerror = fail
    try {
      if (typeof writer.seek === 'function') writer.seek(position)
      writer.writeAsBinary(base64)
    } catch (error) {
      fail(error)
    }
  })
}

function entrySize(entry) {
  return new Promise((resolve) => {
    try {
      if (typeof entry.getMetadata === 'function') {
        entry.getMetadata(
          (meta) => resolve(Number(meta?.size) || 0),
          () => resolve(0)
        )
        return
      }
      if (typeof entry.file === 'function') {
        entry.file(
          (file) => resolve(Number(file?.size) || 0),
          () => resolve(0)
        )
        return
      }
    } catch {
      // ignore
    }
    resolve(0)
  })
}

function absolutePath(plusApi, localPath) {
  try {
    if (plusApi?.io?.convertLocalFileSystemURL) {
      return plusApi.io.convertLocalFileSystemURL(localPath) || localPath
    }
  } catch {
    // ignore
  }
  return localPath
}

/**
 * 分块下载到 App 私有目录，返回可直接交给 uni.openDocument / image 的路径。
 * 目前 Android/iOS 的 App 都走 plus.io；H5 没有 plus，会直接给出提示。
 */
export async function downloadRemoteFile(request, file, options = {}) {
  const plusApi = options.plus || platformPlus()
  if (!plusApi?.io) throw new Error(t("当前环境不支持保存文件，请用手机 App 打开"))
  const path = String(file?.path || '')
  if (!path) throw new Error(t("缺少文件路径"))
  const workspacePath = String(options.workspacePath || file?.workspacePath || '')
  if (!workspacePath) throw new Error(t("缺少工作区信息，请返回会话后重新打开文件"))
  const name = safeFileName(file?.name || path.split(/[\\/]/).pop() || 'file')
  // 缓存会按「工作区 + 路径」给同一个文件名加上哈希后缀，避免不同目录里的
  // 同名文件互相覆盖；localName 只影响落盘名字，name 仍是给用户看的原名。
  const localName = options.localName ? safeFileName(options.localName) : name
  const chunkSize = Number(options.chunkSize) || FILE_CHUNK_SIZE
  const timeout = Number(options.timeout) || 60_000
  const dirEntry = await ensureDocumentDir(plusApi)
  await removeExisting(dirEntry, localName)
  const entry = await createEntry(dirEntry, localName)
  const writer = await createWriter(entry)

  let offset = 0
  let received = 0
  let total = Number(file?.size) || 0
  try {
    while (true) {
      const data = await request(
        'files.read',
        { workspacePath, file: path, offset, length: chunkSize },
        timeout
      )
      if (!data || typeof data.data !== 'string') throw new Error(t("电脑返回的文件数据不正确"))
      total = Number(data.size) || total
      const chunk = base64ToBytes(data.data)
      if (chunk.length > 0) {
        await writeBinary(writer, data.data, offset)
        offset += chunk.length
        received += chunk.length
      }
      if (options.onProgress) options.onProgress({ received, total: total || received })
      if (data.eof === true || chunk.length === 0 || (total > 0 && offset >= total)) break
      if (received > DOWNLOAD_LIMIT) throw new Error(t("文件超过 100 MB，请在电脑上打开"))
    }
  } finally {
    try {
      if (typeof writer.close === 'function') writer.close()
    } catch {
      // ignore
    }
  }

  const written = await entrySize(entry)
  if (written > 0 && written !== received) {
    throw new Error(t("文件写入不完整（{v1}/{v2} 字节），请重试", { v1: written, v2: received }))
  }
  return {
    filePath: absolutePath(plusApi, localFilePathFor(localName)),
    localPath: localFilePathFor(localName),
    name,
    localName,
    size: received,
    total
  }
}

/** 本地下载文件是否存在以及它的大小；缓存命中判定用。 */
export async function localFileInfo(name, options = {}) {
  const plusApi = options.plus || platformPlus()
  if (!plusApi?.io) return { exists: false, size: 0, filePath: '' }
  const fileName = safeFileName(name)
  try {
    const dirEntry = await ensureDocumentDir(plusApi)
    const entry = await findEntry(dirEntry, fileName)
    if (!entry) return { exists: false, size: 0, filePath: '' }
    const size = await entrySize(entry)
    return {
      exists: true,
      size,
      filePath: absolutePath(plusApi, localFilePathFor(fileName))
    }
  } catch {
    return { exists: false, size: 0, filePath: '' }
  }
}

/** 删除 App 私有目录里的下载文件；不存在也算成功。 */
export async function removeLocalFile(name, options = {}) {
  const plusApi = options.plus || platformPlus()
  if (!plusApi?.io) return false
  const fileName = safeFileName(name)
  try {
    const dirEntry = await ensureDocumentDir(plusApi)
    const entry = await findEntry(dirEntry, fileName)
    if (!entry) return false
    await new Promise((resolve) => {
      try {
        entry.remove(
          () => resolve(),
          () => resolve()
        )
      } catch {
        resolve()
      }
    })
    return true
  } catch {
    return false
  }
}

/** 把文本写到 App 私有目录，返回可直接加载的绝对路径。 */
export async function writeLocalText(name, text, options = {}) {
  const plusApi = options.plus || platformPlus()
  if (!plusApi?.io) throw new Error(t("当前环境不支持保存文件，请用手机 App 打开"))
  const fileName = safeFileName(name || 'preview.txt')
  const bytes = utf8Encode(String(text ?? ''))
  const dirEntry = await ensureDocumentDir(plusApi)
  await removeExisting(dirEntry, fileName)
  const entry = await createEntry(dirEntry, fileName)
  const writer = await createWriter(entry)
  try {
    await writeBinary(writer, bytesToBase64(bytes), 0)
  } finally {
    try {
      if (typeof writer.close === 'function') writer.close()
    } catch {
      // ignore
    }
  }
  const written = await entrySize(entry)
  if (written > 0 && written !== bytes.length) {
    throw new Error(
      t("文件写入不完整（{v1}/{v2} 字节），请重试", { v1: written, v2: bytes.length })
    )
  }
  return {
    filePath: absolutePath(plusApi, localFilePathFor(fileName)),
    localPath: localFilePathFor(fileName),
    name: fileName,
    size: bytes.length
  }
}

export const HTML_PREVIEW_WEBVIEW_ID = 'pilot-html-preview'

/**
 * 用独立 WebView 打开渲染后的 HTML。预览文档已经注入 CSP，脚本不会执行。
 * 关闭由标题栏的返回按钮或系统返回键完成。
 */
export function openHtmlPreview(filePath, name, options = {}) {
  const plusApi = options.plus || platformPlus()
  if (!plusApi?.webview?.create) {
    return Promise.reject(new Error(t("当前环境不支持预览 HTML")))
  }
  return new Promise((resolve, reject) => {
    try {
      const previous = plusApi.webview.getWebviewById?.(HTML_PREVIEW_WEBVIEW_ID)
      if (previous) {
        try {
          previous.close('none')
        } catch {
          // ignore
        }
      }
      const view = plusApi.webview.create(fileUrlOf(filePath), HTML_PREVIEW_WEBVIEW_ID, {
        top: '0px',
        bottom: '0px',
        left: '0px',
        right: '0px',
        background: '#ffffff',
        // 预览页是工作区里的任意 HTML，不能给它 plus 原生接口。
        plusrequire: 'none',
        titleNView: {
          backgroundColor: '#000000',
          titleText: String(name || 'HTML'),
          titleColor: '#ffffff',
          titleSize: '17px',
          autoBackButton: true,
          splitLine: { color: '#292929' }
        }
      })
      if (!view) throw new Error(t("无法打开预览窗口"))
      view.show()
      resolve(view)
    } catch (error) {
      reject(toError(error, t("无法打开预览窗口")))
    }
  })
}

/** 用系统文档查看器打开；App 不认识的文件交给系统选择应用。 */
export function openLocalFile(filePath, name) {
  const ext = extensionOf(name)
  const uniApi = platformUni()
  if (uniApi && DOCUMENT_TYPES.has(ext) && typeof uniApi.openDocument === 'function') {
    return new Promise((resolve, reject) => {
      uniApi.openDocument({
        filePath,
        fileType: ext,
        showMenu: true,
        success: () => resolve(true),
        fail: (error) => reject(toError(error, t("没有可以打开该文档的应用")))
      })
    })
  }
  const plusApi = platformPlus()
  if (plusApi?.runtime?.openFile) {
    try {
      plusApi.runtime.openFile(filePath)
      return Promise.resolve(true)
    } catch (error) {
      return Promise.reject(toError(error, t("没有可以打开该文件的应用")))
    }
  }
  return Promise.reject(new Error(t("当前环境不支持打开该文件")))
}

/** 只把 http/https 交给系统浏览器，file:、javascript: 之类一律拒绝。 */
export function isWebLink(url) {
  const text = String(url || '').trim()
  if (!text || text.length > 2048) return false
  try {
    const parsed = new URL(text)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** 用系统浏览器打开链接；H5 退回到 window.open。 */
export function openExternalUrl(url, options = {}) {
  const target = String(url || '').trim()
  if (!isWebLink(target) && !/^(mailto|tel):/i.test(target)) {
    return Promise.reject(new Error(t("只支持打开网页链接")))
  }
  const plusApi = options.plus || platformPlus()
  if (plusApi?.runtime?.openURL) {
    try {
      plusApi.runtime.openURL(target)
      return Promise.resolve(true)
    } catch (error) {
      return Promise.reject(toError(error, t("无法打开链接")))
    }
  }
  try {
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(target, '_blank')
      return Promise.resolve(true)
    }
  } catch {
    // 继续给出明确错误
  }
  return Promise.reject(new Error(t("当前环境不支持打开链接")))
}

export const WEB_PREVIEW_WEBVIEW_ID = 'pilot-web-preview'

/**
 * 在独立 WebView 里预览远程网页。
 *
 * `plusrequire: 'none'` 让页面拿不到 App 的原生接口，同时保留网页自己的
 * 脚本和网络请求（这是预览网页的意义），关闭由标题栏返回键完成。
 */
export function openWebPreview(url, name, options = {}) {
  const target = String(url || '').trim()
  if (!isWebLink(target)) {
    return Promise.reject(new Error(t("只支持打开网页链接")))
  }
  const plusApi = options.plus || platformPlus()
  if (!plusApi?.webview?.create) {
    return Promise.reject(new Error(t("当前环境不支持预览网页")))
  }
  return new Promise((resolve, reject) => {
    try {
      const previous = plusApi.webview.getWebviewById?.(WEB_PREVIEW_WEBVIEW_ID)
      if (previous) {
        try {
          previous.close('none')
        } catch {
          // ignore
        }
      }
      let title = String(name || '').trim()
      if (!title) {
        try {
          title = new URL(target).host
        } catch {
          title = target
        }
      }
      const view = plusApi.webview.create(target, WEB_PREVIEW_WEBVIEW_ID, {
        top: '0px',
        bottom: '0px',
        left: '0px',
        right: '0px',
        background: '#ffffff',
        plusrequire: 'none',
        scalable: true,
        titleNView: {
          backgroundColor: '#000000',
          titleText: title.slice(0, 40),
          titleColor: '#ffffff',
          titleSize: '17px',
          autoBackButton: true,
          splitLine: { color: '#292929' }
        }
      })
      if (!view) throw new Error(t("无法打开预览窗口"))
      view.show()
      resolve(view)
    } catch (error) {
      reject(toError(error, t("无法打开预览窗口")))
    }
  })
}
