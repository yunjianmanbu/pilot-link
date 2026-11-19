/**
 * 手机端上传文件到电脑工作区。
 *
 * 中继帧只有 1 MB，上传按 128 KB 分块走加密请求：本机读一块、发一块，
 * 大文件不会把内存占满。电脑端把分块写进隐藏的临时文件，全部到齐后再
 * 原子改名到最终位置；同名文件自动加序号，绝不覆盖工作区已有文件。
 *
 * 这里不 import Vue（App 的逻辑层没有 vue，Node 单元测试也不安装它）。
 */

import { bytesToBase64, extensionOf, safeFileName } from './files.js'
import { t } from './i18n.js'

export const UPLOAD_CHUNK_SIZE = 128 * 1024
export const UPLOAD_LIMIT = 100 * 1024 * 1024
export const UPLOAD_DIRECTORY = 'uploads'

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

function toError(value, fallback) {
  if (value instanceof Error) return value
  const message = value?.message || value?.errMsg || value?.code
  return new Error(message ? String(message) : fallback)
}

function nameFromPath(path) {
  return String(path || '')
    .split(/[\\/]/)
    .filter(Boolean)
    .pop() || ''
}

const ANDROID_RESULT_OK = -1
const ANDROID_REQUEST_START = 0x4a00
const ANDROID_REQUEST_END = 0x7fff
const ANDROID_PICK_TIMEOUT = 5 * 60_000
const ANDROID_COPY_STEP = 8 * 1024 * 1024
const ANDROID_UPLOAD_CACHE = '_doc/upload-cache'

let androidRequestCode = ANDROID_REQUEST_START
let androidResultHandler = null
let androidPreviousResultHandler = null
const androidPendingPicks = new Map()

function isAndroidApp(plusApi) {
  return Boolean(plusApi?.android && plusApi.os?.name === 'Android')
}

/**
 * Native.js 的 Java 方法通常直接挂在对象上；个别机型或方法被重载时，
 * 退回 plus.android.invoke 走反射，避免“不是函数”的报错。
 */
function androidCall(android, target, method, ...args) {
  if (!target) throw new Error(t("无法读取所选文件，请重试"))
  if (typeof target[method] === 'function') return target[method](...args)
  if (android && typeof android.invoke === 'function') {
    return android.invoke(target, method, ...args)
  }
  throw new Error(t("无法读取所选文件，请重试"))
}

function nativePath(value) {
  return String(value || '').replace(/^file:\/\//, '')
}

function nextAndroidRequestCode() {
  for (let attempt = 0; attempt < 256; attempt += 1) {
    const code = androidRequestCode
    androidRequestCode =
      androidRequestCode >= ANDROID_REQUEST_END
        ? ANDROID_REQUEST_START
        : androidRequestCode + 1
    if (!androidPendingPicks.has(code)) return code
  }
  throw new Error(t("无法选择文件，请重试"))
}

function bindAndroidResultHandler(main) {
  if (!main) throw new Error(t("无法选择文件，请重试"))
  if (main.onActivityResult !== androidResultHandler) {
    if (typeof main.onActivityResult === 'function') {
      androidPreviousResultHandler = main.onActivityResult
    }
    androidResultHandler = function (requestCode, resultCode, data) {
      const code = Number(requestCode)
      const pending = androidPendingPicks.get(code)
      if (!pending) {
        // 不是文件选择器的结果，交还给原先注册的回调。
        if (typeof androidPreviousResultHandler === 'function') {
          try {
            androidPreviousResultHandler.call(this, requestCode, resultCode, data)
          } catch {
            // ignore
          }
        }
        return
      }
      androidPendingPicks.delete(code)
      if (pending.timer) clearTimeout(pending.timer)
      if (Number(resultCode) !== ANDROID_RESULT_OK) {
        pending.resolve(null)
        return
      }
      try {
        pending.resolve(collectAndroidUris(pending.android, data, pending.limit))
      } catch (error) {
        pending.reject(toError(error, t("无法读取所选文件，请重试")))
      }
    }
    main.onActivityResult = androidResultHandler
  }
}

/** 从 onActivityResult 的 Intent 里取出单选或多选的 content:// URI。 */
export function collectAndroidUris(android, data, limit = 9) {
  const uris = []
  if (!data) return uris
  const max = Math.max(1, Math.min(9, Number(limit) || 1))
  const seen = new Set()
  const push = (uri) => {
    if (!uri || uris.length >= max) return
    let key = ''
    try {
      key = String(androidCall(android, uri, 'toString') || '')
    } catch {
      key = ''
    }
    if (!key || seen.has(key)) return
    seen.add(key)
    uris.push(uri)
  }
  try {
    const clip = androidCall(android, data, 'getClipData')
    if (clip) {
      const total = Number(androidCall(android, clip, 'getItemCount')) || 0
      for (let index = 0; index < total; index += 1) {
        const item = androidCall(android, clip, 'getItemAt', index)
        push(androidCall(android, item, 'getUri'))
      }
    }
  } catch {
    // 单选结果没有 ClipData。
  }
  if (!uris.length) {
    try {
      push(androidCall(android, data, 'getData'))
    } catch {
      // ignore
    }
  }
  return uris
}

function launchAndroidFilePicker(plusApi, limit) {
  return new Promise((resolve, reject) => {
    let code = 0
    try {
      const android = plusApi.android
      const main = android.runtimeMainActivity()
      bindAndroidResultHandler(main)
      const Intent = android.importClass('android.content.Intent')
      if (!Intent) throw new Error(t("无法选择文件，请重试"))
      const intent = new Intent(Intent.ACTION_GET_CONTENT)
      androidCall(android, intent, 'setType', '*/*')
      // 部分 ROM 缺少 CATEGORY_OPENABLE 时不显示文件项。
      androidCall(android, intent, 'addCategory', Intent.CATEGORY_OPENABLE)
      androidCall(android, intent, 'addFlags', Intent.FLAG_GRANT_READ_URI_PERMISSION)
      if (limit > 1) {
        androidCall(android, intent, 'putExtra', Intent.EXTRA_ALLOW_MULTIPLE, true)
      }
      code = nextAndroidRequestCode()
      const timer = setTimeout(() => {
        const pending = androidPendingPicks.get(code)
        if (!pending) return
        androidPendingPicks.delete(code)
        pending.reject(new Error(t("选择文件超时，请重试")))
      }, ANDROID_PICK_TIMEOUT)
      timer.unref?.()
      androidPendingPicks.set(code, { android, limit, resolve, reject, timer })
      androidCall(android, main, 'startActivityForResult', intent, code)
    } catch (error) {
      if (code) {
        const pending = androidPendingPicks.get(code)
        if (pending?.timer) clearTimeout(pending.timer)
        androidPendingPicks.delete(code)
      }
      reject(toError(error, t("无法选择文件，请重试")))
    }
  })
}

/** 读取 OpenableColumns 里的原始文件名和大小，失败时返回空值。 */
export function androidOpenableInfo(android, resolver, uri) {
  let name = ''
  let size = 0
  let cursor = null
  try {
    cursor = androidCall(android, resolver, 'query', uri, null, null, null, null)
    if (cursor && androidCall(android, cursor, 'moveToFirst')) {
      const nameIndex = Number(androidCall(android, cursor, 'getColumnIndex', '_display_name'))
      if (nameIndex >= 0) {
        name = String(androidCall(android, cursor, 'getString', nameIndex) || '')
      }
      const sizeIndex = Number(androidCall(android, cursor, 'getColumnIndex', '_size'))
      if (sizeIndex >= 0) {
        const value = Number(androidCall(android, cursor, 'getLong', sizeIndex))
        if (Number.isFinite(value) && value >= 0) size = value
      }
    }
  } catch {
    // 某些文件管理器不提供 OpenableColumns，退回 URI 末段当文件名。
  } finally {
    try {
      if (cursor) androidCall(android, cursor, 'close')
    } catch {
      // ignore
    }
  }
  return { name, size }
}

function androidUriName(android, uri) {
  try {
    const segment = String(androidCall(android, uri, 'getLastPathSegment') || '')
    if (!segment) return ''
    try {
      return decodeURIComponent(segment)
    } catch {
      return segment
    }
  } catch {
    return ''
  }
}

/** 文件管理器没给显示名时，至少按 MIME 补一个扩展名，工作区里更好认。 */
function androidNameWithExtension(android, resolver, uri, name) {
  if (!name || name.includes('.')) return name
  try {
    const mime = String(androidCall(android, resolver, 'getType', uri) || '')
    if (!mime) return name
    const MimeTypeMap = android.importClass('android.webkit.MimeTypeMap')
    const map = MimeTypeMap?.getSingleton?.()
    const ext = map ? map.getExtensionFromMimeType(mime) : ''
    return ext ? `${name}.${String(ext)}` : name
  } catch {
    return name
  }
}

/**
 * content:// 只对当前 Intent 有效，不能直接当路径传给 plus.io。
 * 这里用 FileChannel 把字节流复制进 App 私有目录，不申请存储权限；
 * 复制完成后返回 plus.io 能读取的 _doc 路径。
 */
export function copyAndroidUri(plusApi, uri, index = 0) {
  if (!isAndroidApp(plusApi)) {
    throw new Error(t("当前设备暂不支持选择文件，请在电脑端上传"))
  }
  const android = plusApi.android
  const main = android.runtimeMainActivity()
  const resolver = androidCall(android, main, 'getContentResolver')
  const info = androidOpenableInfo(android, resolver, uri)
  let name = safeFileName(
    info.name || androidUriName(android, uri) || `file-${index + 1}`
  )
  name = safeFileName(androidNameWithExtension(android, resolver, uri, name))
  if (info.size > UPLOAD_LIMIT) {
    throw new Error(t("单个文件不能超过 100 MB，请在电脑上打开"))
  }
  const File = android.importClass('java.io.File')
  if (!File) throw new Error(t("无法读取所选文件，请重试"))
  let dirPath = ''
  try {
    dirPath = plusApi.io?.convertLocalFileSystemURL?.(ANDROID_UPLOAD_CACHE) || ''
    if (!dirPath) {
      const docPath = plusApi.io?.convertLocalFileSystemURL?.('_doc') || ''
      if (docPath) dirPath = `${String(docPath).replace(/[\\/]+$/, '')}/upload-cache`
    }
  } catch {
    dirPath = ''
  }
  if (!dirPath) throw new Error(t("无法读取所选文件，请重试"))
  const dir = new File(nativePath(dirPath))
  if (!androidCall(android, dir, 'exists')) androidCall(android, dir, 'mkdirs')
  // 缓存文件名只用来读取，不参与工作区命名；用短名避免中文长文件名超出文件系统上限。
  const ext = extensionOf(name)
  const stored = `pilot-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}-${index}${ext && ext.length <= 12 ? `.${ext}` : ''}`
  const dest = new File(dir, stored)
  let pfd = null
  let input = null
  let output = null
  let source = null
  let target = null
  try {
    pfd = androidCall(android, resolver, 'openFileDescriptor', uri, 'r')
    if (!pfd) throw new Error(t("无法读取所选文件，请重试"))
    const FileInputStream = android.importClass('java.io.FileInputStream')
    const FileOutputStream = android.importClass('java.io.FileOutputStream')
    if (!FileInputStream || !FileOutputStream) {
      throw new Error(t("无法读取所选文件，请重试"))
    }
    input = new FileInputStream(androidCall(android, pfd, 'getFileDescriptor'))
    output = new FileOutputStream(dest)
    source = androidCall(android, input, 'getChannel')
    target = androidCall(android, output, 'getChannel')
    const expected = Math.max(0, Number(androidCall(android, pfd, 'getStatSize')) || 0)
    if (expected > UPLOAD_LIMIT) {
      throw new Error(t("单个文件不能超过 100 MB，请在电脑上打开"))
    }
    const hardLimit = UPLOAD_LIMIT + 1
    let position = 0
    while (position < hardLimit) {
      const remaining = expected > 0 ? expected - position : 0
      const want =
        remaining > 0 ? Math.min(ANDROID_COPY_STEP, remaining) : ANDROID_COPY_STEP
      const moved = Number(
        androidCall(android, target, 'transferFrom', source, position, want)
      )
      if (!(moved > 0)) break
      position += moved
      if (expected > 0 && position >= expected) break
      if (expected <= 0 && moved < want) break
    }
    const size = Number(androidCall(android, dest, 'length')) || 0
    if (size > UPLOAD_LIMIT) {
      throw new Error(t("单个文件不能超过 100 MB，请在电脑上打开"))
    }
    if (expected > 0 && size < expected) {
      throw new Error(t("无法读取所选文件，请重试"))
    }
    return {
      name,
      size,
      path: `${ANDROID_UPLOAD_CACHE}/${stored}`,
      temporary: true
    }
  } catch (error) {
    try {
      androidCall(android, dest, 'delete')
    } catch {
      // ignore
    }
    throw toError(error, t("无法读取所选文件，请重试"))
  } finally {
    for (const resource of [target, output, source, input, pfd]) {
      try {
        if (resource && typeof resource.close === 'function') resource.close()
      } catch {
        // ignore
      }
    }
  }
}

/** Android 走系统文件选择器；H5 继续用 uni.chooseFile。 */
export async function pickAndroidUploadFiles(plusApi, count = 3, options = {}) {
  const limit = Math.max(1, Math.min(9, Number(count) || 1))
  const uris = await launchAndroidFilePicker(plusApi, limit)
  if (!uris?.length) return []
  const copy =
    typeof options.copyAndroidUri === 'function' ? options.copyAndroidUri : copyAndroidUri
  const picked = []
  let firstError = null
  for (let index = 0; index < uris.length && picked.length < limit; index += 1) {
    try {
      const file = await copy(plusApi, uris[index], index)
      if (file) picked.push(file)
    } catch (error) {
      if (!firstError) firstError = error
    }
  }
  if (!picked.length && firstError) throw firstError
  return picked
}

function removeTemporaryFile(plusApi, path) {
  if (!path || !plusApi?.io?.resolveLocalFileSystemURL) return
  try {
    plusApi.io.resolveLocalFileSystemURL(
      path,
      (entry) => {
        try {
          entry?.remove?.(() => {}, () => {})
        } catch {
          // ignore
        }
      },
      () => {}
    )
  } catch {
    // ignore
  }
}

function chooseFiles(count, uniApi = platformUni()) {
  return new Promise((resolve, reject) => {
    if (!uniApi || typeof uniApi.chooseFile !== 'function') {
      reject(new Error(t("当前设备暂不支持选择文件，请在电脑端上传")))
      return
    }
    try {
      uniApi.chooseFile({
        count: Math.max(1, Math.min(9, Number(count) || 1)),
        type: 'all',
        success: resolve,
        fail: (error) => {
          const message = String(error?.errMsg || error?.message || '')
          // 用户主动取消不算错误，不弹提示。
          if (/cancel/i.test(message)) resolve(null)
          else reject(new Error(t("无法选择文件，请重试")))
        }
      })
    } catch (error) {
      reject(toError(error, t("无法选择文件，请重试")))
    }
  })
}

/** 把 uni.chooseFile 的结果整理成上传需要的字段。 */
export function pickedUploadFiles(result) {
  if (!result) return []
  const paths = Array.isArray(result.tempFilePaths) ? result.tempFilePaths : []
  const files = Array.isArray(result.tempFiles) ? result.tempFiles : []
  const total = Math.max(files.length, paths.length)
  const picked = []
  for (let index = 0; index < total; index += 1) {
    const file = files[index] || {}
    const path = String(file.path || paths[index] || '')
    // H5 sometimes returns the File object directly instead of wrapping it.
    const blob =
      file.file && typeof file.file.slice === 'function'
        ? file.file
        : typeof file.slice === 'function' && typeof file.name === 'string'
          ? file
          : null
    if (!path && !blob) continue
    picked.push({
      name: safeFileName(file.name || nameFromPath(path) || `file-${index + 1}`),
      size: Math.max(0, Number(file.size) || 0),
      path,
      blob
    })
  }
  return picked
}

/** 拉起系统文件选择器，返回选中的文件；取消时返回空数组。 */
export async function pickUploadFiles(count = 3, options = {}) {
  const plusApi = options.plus || platformPlus()
  if (isAndroidApp(plusApi)) {
    return pickAndroidUploadFiles(plusApi, count, options)
  }
  return pickedUploadFiles(await chooseFiles(count, options.uni || platformUni()))
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    if (typeof blob?.arrayBuffer === 'function') {
      blob.arrayBuffer().then((buffer) => {
        resolve(bytesToBase64(new Uint8Array(buffer)))
      }, (error) => reject(toError(error, t("读取本地文件失败"))))
      return
    }
    if (typeof FileReader !== 'function') {
      reject(new Error(t("当前环境无法读取所选文件")))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      if (comma < 0) reject(new Error(t("读取本地文件失败")))
      else resolve(result.slice(comma + 1))
    }
    reader.onerror = () => reject(new Error(t("读取本地文件失败")))
    reader.readAsDataURL(blob)
  })
}

function resolvePlusFile(plusApi, path) {
  return new Promise((resolve, reject) => {
    try {
      plusApi.io.resolveLocalFileSystemURL(
        path,
        (entry) => {
          if (!entry || typeof entry.file !== 'function') {
            reject(new Error(t("读取本地文件失败")))
            return
          }
          entry.file(
            (file) => resolve(file),
            (error) => reject(toError(error, t("读取本地文件失败")))
          )
        },
        (error) => reject(toError(error, t("读取本地文件失败")))
      )
    } catch (error) {
      reject(toError(error, t("读取本地文件失败")))
    }
  })
}

function readPlusSlice(plusApi, slice) {
  return new Promise((resolve, reject) => {
    let reader
    try {
      reader = new plusApi.io.FileReader()
    } catch (error) {
      reject(toError(error, t("读取本地文件失败")))
      return
    }
    reader.onload = (event) => {
      const result = String(event?.target?.result || reader.result || '')
      const comma = result.indexOf(',')
      if (comma < 0) reject(new Error(t("读取本地文件失败")))
      else resolve(result.slice(comma + 1))
    }
    reader.onerror = () => reject(new Error(t("读取本地文件失败")))
    try {
      reader.readAsDataURL(slice)
    } catch (error) {
      reject(toError(error, t("读取本地文件失败")))
    }
  })
}

function readManagerChunk(uniApi, path, offset, length) {
  return new Promise((resolve, reject) => {
    let manager = null
    try {
      manager = uniApi.getFileSystemManager()
    } catch {
      manager = null
    }
    if (!manager || typeof manager.readFile !== 'function') {
      reject(new Error(t("当前环境无法读取所选文件")))
      return
    }
    manager.readFile({
      filePath: path,
      encoding: 'base64',
      position: offset,
      length,
      success: (result) => {
        const data = String(result?.data || '')
        if (!data) reject(new Error(t("读取本地文件失败")))
        else resolve(data)
      },
      fail: (error) => reject(toError(error, t("读取本地文件失败")))
    })
  })
}

/**
 * 创建一个按绝对偏移读取的读取器：reader(offset, length) -> base64。
 * 优先用选择结果里的 Blob（H5），其次 plus.io.FileReader（App），
 * 最后才用文件系统管理器的 position/length。
 */
export async function createUploadReader(file, options = {}) {
  if (file?.blob && typeof file.blob.slice === 'function') {
    return (offset, length) => blobToBase64(file.blob.slice(offset, offset + length))
  }
  const path = String(file?.path || '')
  if (!path) throw new Error(t("读取本地文件失败"))
  const plusApi = options.plus || platformPlus()
  if (plusApi?.io && typeof plusApi.io.resolveLocalFileSystemURL === 'function') {
    try {
      const plusFile = await resolvePlusFile(plusApi, path)
      if (typeof plusFile.slice === 'function') {
        return (offset, length) => readPlusSlice(plusApi, plusFile.slice(offset, offset + length))
      }
    } catch {
      // content:// 之类的路径 plus.io 解不开时，交给文件系统管理器再试一次。
    }
  }
  const uniApi = options.uni || platformUni()
  if (uniApi && typeof uniApi.getFileSystemManager === 'function') {
    return (offset, length) => readManagerChunk(uniApi, path, offset, length)
  }
  throw new Error(t("当前环境无法读取所选文件"))
}

/**
 * 把一个本地文件分块上传到工作区。request 是 store 导出的 request。
 * 成功返回最终路径和文件名；用户取消覆盖（不会发生，同名自动改名）
 * 或取消选择时由调用方处理。
 */
export async function uploadFileToWorkspace(request, options = {}) {
  const file = options.file
  const workspacePath = String(options.workspacePath || '')
  if (!workspacePath) throw new Error(t("缺少工作区信息，请返回会话后重试"))
  if (!file || (!file.path && !file.blob)) throw new Error(t("读取本地文件失败"))
  const name = safeFileName(file.name || nameFromPath(file.path) || 'file')
  const size = Number(file.size)
  if (!Number.isFinite(size) || size < 0) throw new Error(t("文件大小不正确"))
  if (size > UPLOAD_LIMIT) {
    throw new Error(t("单个文件不能超过 100 MB，请在电脑上打开"))
  }
  const directory = String(options.directory || UPLOAD_DIRECTORY)
  const timeout = Number(options.timeout) || 60_000
  const chunkSize = Math.max(1, Number(options.chunkSize) || UPLOAD_CHUNK_SIZE)

  let uploadId = ''
  try {
    const begin = await request(
      'files.upload.begin',
      { workspacePath, directory, name, size },
      timeout
    )
    uploadId = String(begin?.uploadId || '')
    if (!uploadId) throw new Error(t("电脑端没有接受上传请求"))
    const reader = await createUploadReader(file, options)
    let offset = 0
    while (offset < size) {
      const length = Math.min(chunkSize, size - offset)
      const data = await reader(offset, length)
      if (typeof data !== 'string' || !data) throw new Error(t("读取本地文件失败"))
      const result = await request(
        'files.upload.chunk',
        { uploadId, offset, data },
        timeout
      )
      const received = Number(result?.received)
      offset = Number.isFinite(received) && received > offset ? received : offset + length
      if (options.onProgress) options.onProgress({ uploaded: offset, total: size, name })
    }
    const finished = await request('files.upload.finish', { uploadId }, timeout)
    const path = String(finished?.path || begin?.path || '')
    if (!path) throw new Error(t("电脑端没有返回文件路径"))
    return {
      path,
      name: String(finished?.name || begin?.name || name),
      size: Number(finished?.size) || size
    }
  } catch (error) {
    if (uploadId) {
      try {
        await request('files.upload.cancel', { uploadId }, 15_000)
      } catch {
        // 临时文件也会在电脑端过期清理。
      }
    }
    const message = String(error?.message || '')
    if (message.includes('手机端不支持')) {
      throw new Error(t("电脑端版本过低，请先在电脑上更新 Pilot"))
    }
    throw error
  } finally {
    // 选择器复制到 _doc 的临时文件只服务本次上传，成功或失败都删掉。
    if (file?.temporary) {
      removeTemporaryFile(options.plus || platformPlus(), file.path)
    }
  }
}
