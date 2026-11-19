/**
 * 手机端的下载缓存：看过的文件在本机留几天，默认 7 天，可在设置里改。
 *
 * 规则只有一条：以「最后一次查看时间」为准算保存天数。
 * - 第一次查看时下载并记下时间；
 * - 天数内再看一次，过期时间就从这一次查看重新算（续期）；
 * - 超过天数没看，App 启动时和每次查看前把本地文件删掉。
 *
 * 天数存在 `pilot-app.file-cache-days.v1`，改小以后已有条目按新的天数判定，
 * 立刻超期的会在下次清扫（改设置时也会顺手清一遍）删掉。
 *
 * 落盘位置还是 App 私有目录 `_doc/pilot-files/`，索引存在 uni storage。
 * 索引 key 用「工作区 + 工作区内的相对路径」，落盘文件名再加一段路径哈希，
 * 这样不同目录里的同名 README.md 不会互相覆盖。
 *
 * 这里不 import Vue（App 的逻辑层没有 vue，Node 单元测试也不安装它）。
 */

import {
  downloadRemoteFile,
  extensionOf,
  localFilePathFor,
  localFileInfo,
  removeLocalFile,
  safeFileName
} from './files.js'

const DAY_MS = 24 * 60 * 60 * 1000

export const FILE_CACHE_STORAGE_KEY = 'pilot-app.file-cache.v1'
export const FILE_CACHE_VERSION = 1
/** 索引最多留这么多条，超出时先丢最久没看的（文件也一起删）。 */
export const FILE_CACHE_LIMIT = 200

/** 保存天数的存储位置与取值范围；默认 7 天，设置页可改。 */
export const FILE_CACHE_DAYS_KEY = 'pilot-app.file-cache-days.v1'
export const FILE_CACHE_DEFAULT_DAYS = 7
export const FILE_CACHE_MIN_DAYS = 1
export const FILE_CACHE_MAX_DAYS = 365
/** 设置页给出的几档：够用又不至于让人纠结。 */
export const FILE_CACHE_DAY_OPTIONS = [1, 3, 7, 14, 30, 90]
/** 默认天数对应的时长；实际使用请走 fileCacheTtlMs()，它读的是用户设置。 */
export const FILE_CACHE_TTL_MS = FILE_CACHE_DEFAULT_DAYS * DAY_MS

function storageApi() {
  try {
    return typeof uni === 'undefined' ? null : uni
  } catch {
    return null
  }
}

function readRaw() {
  const api = storageApi()
  if (!api?.getStorageSync) return null
  try {
    const raw = api.getStorageSync(FILE_CACHE_STORAGE_KEY)
    if (!raw) return null
    if (typeof raw === 'object') return raw
    return JSON.parse(String(raw))
  } catch {
    return null
  }
}

function writeRaw(value) {
  const api = storageApi()
  if (!api?.setStorageSync) return false
  try {
    api.setStorageSync(FILE_CACHE_STORAGE_KEY, value)
    return true
  } catch {
    return false
  }
}

/** 天数只接受正整数，超出范围的夹到边界，看不懂的值回落到默认 7 天。 */
export function normalizeFileCacheDays(value) {
  const days = Math.round(Number(value))
  if (!Number.isFinite(days) || days <= 0) return FILE_CACHE_DEFAULT_DAYS
  return Math.min(FILE_CACHE_MAX_DAYS, Math.max(FILE_CACHE_MIN_DAYS, days))
}

/** 读设置里的保存天数；没设置过或存储不可用时用默认值。 */
export function loadFileCacheDays() {
  const api = storageApi()
  if (!api?.getStorageSync) return FILE_CACHE_DEFAULT_DAYS
  try {
    const raw = api.getStorageSync(FILE_CACHE_DAYS_KEY)
    if (raw === '' || raw === null || raw === undefined) return FILE_CACHE_DEFAULT_DAYS
    return normalizeFileCacheDays(raw)
  } catch {
    return FILE_CACHE_DEFAULT_DAYS
  }
}

/** 写保存天数，返回真正生效的值（越界会被夹住）。 */
export function saveFileCacheDays(value) {
  const days = normalizeFileCacheDays(value)
  const api = storageApi()
  if (api?.setStorageSync) {
    try {
      api.setStorageSync(FILE_CACHE_DAYS_KEY, days)
    } catch {
      // 存不下也不影响这次界面，下次启动回落到默认值。
    }
  }
  return days
}

/** 当前设置对应的过期时长（毫秒）。 */
export function fileCacheTtlMs(days = loadFileCacheDays()) {
  return normalizeFileCacheDays(days) * DAY_MS
}

/** 统一路径写法：反斜杠转正斜杠，去掉结尾分隔符，方便跨端比对。 */
export function normalizeCachePath(value) {
  return String(value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
}

/** 缓存索引键：同一个工作区里的同一个文件才算同一份缓存。 */
export function fileCacheKey(workspacePath, path) {
  const workspace = normalizeCachePath(workspacePath)
  const file = normalizeCachePath(path)
  // 缺少工作区时不做缓存：否则不同工作区的同名文件会互相命中。
  if (!workspace || !file) return ''
  return `${workspace}::${file}`
}

/** FNV-1a 32 位，够用来区分同名文件，不需要加密强度。 */
export function cachePathHash(key) {
  const text = String(key || '')
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** 落盘文件名：原名 + 路径哈希，保留扩展名（系统查看器要靠它）。 */
export function cacheFileNameFor(key, name) {
  const base = safeFileName(name || 'file')
  const ext = extensionOf(base)
  const stem = (ext ? base.slice(0, base.length - ext.length - 1) : base).slice(0, 100) || 'file'
  const suffix = cachePathHash(String(key ?? ''))
  return ext ? `${stem}-${suffix}.${ext}` : `${stem}-${suffix}`
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null
  const key = typeof raw.key === 'string' ? raw.key : ''
  const localName = typeof raw.localName === 'string' ? raw.localName : ''
  if (!key || !localName) return null
  const lastViewedAt = Number(raw.lastViewedAt) || 0
  if (lastViewedAt <= 0) return null
  return {
    key,
    workspacePath: typeof raw.workspacePath === 'string' ? raw.workspacePath : '',
    path: typeof raw.path === 'string' ? raw.path : '',
    name: typeof raw.name === 'string' ? raw.name : localName,
    localName,
    size: Math.max(0, Number(raw.size) || 0),
    savedAt: Math.max(0, Number(raw.savedAt) || lastViewedAt),
    lastViewedAt
  }
}

/** 读出全部有效缓存条目；结构不对的条目直接丢掉。 */
export function readFileCache() {
  const raw = readRaw()
  const list = Array.isArray(raw) ? raw : raw?.entries
  if (!Array.isArray(list)) return []
  const entries = []
  for (const item of list) {
    const entry = normalizeEntry(item)
    if (entry) entries.push(entry)
  }
  return entries
}

/** 写回索引；超过上限时按最近查看时间保留，被挤掉的返回出来供删文件。 */
export function writeFileCache(entries, options = {}) {
  const list = (Array.isArray(entries) ? entries : [])
    .map(normalizeEntry)
    .filter(Boolean)
    .sort((a, b) => b.lastViewedAt - a.lastViewedAt)
  const limit = Math.max(1, Number(options.limit) || FILE_CACHE_LIMIT)
  const kept = list.slice(0, limit)
  const dropped = list.slice(limit)
  writeRaw({ version: FILE_CACHE_VERSION, entries: kept })
  return { kept, dropped }
}

export function isFileCacheExpired(entry, now = Date.now(), ttl = fileCacheTtlMs()) {
  const last = Number(entry?.lastViewedAt) || 0
  if (last <= 0) return true
  return now - last >= ttl
}

/** 还有几天到期；已经过期或没有记录时给 0。 */
export function fileCacheDaysLeft(entry, now = Date.now(), ttl = fileCacheTtlMs()) {
  const last = Number(entry?.lastViewedAt) || 0
  if (last <= 0) return 0
  const left = last + ttl - now
  if (left <= 0) return 0
  return Math.max(1, Math.ceil(left / (24 * 60 * 60 * 1000)))
}

/** 把过期条目挑出来，方便一次删干净。 */
export function planFileCacheSweep(entries, now = Date.now(), ttl = fileCacheTtlMs()) {
  const list = Array.isArray(entries) ? entries : []
  const keep = []
  const expired = []
  for (const entry of list) {
    if (isFileCacheExpired(entry, now, ttl)) expired.push(entry)
    else keep.push(entry)
  }
  return { keep, expired }
}

/** 查一条没过期的缓存；过期条目交给清扫处理。 */
export function findFileCacheEntry(workspacePath, path, now = Date.now()) {
  const key = fileCacheKey(workspacePath, path)
  if (!key) return null
  const entry = readFileCache().find((item) => item.key === key)
  if (!entry || isFileCacheExpired(entry, now)) return null
  return entry
}

/** 续期：最近一次查看时间改成现在，过期时间自然往后推一个保存周期。 */
export function touchFileCacheEntry(workspacePath, path, now = Date.now()) {
  const key = fileCacheKey(workspacePath, path)
  if (!key) return null
  const entries = readFileCache()
  const index = entries.findIndex((item) => item.key === key)
  if (index < 0) return null
  const touched = { ...entries[index], lastViewedAt: now }
  entries[index] = touched
  writeFileCache(entries)
  return touched
}

function recordFileCacheEntry(entry, now = Date.now(), options = {}) {
  const normalized = normalizeEntry({ savedAt: now, ...entry, lastViewedAt: now })
  if (!normalized) return null
  const entries = readFileCache().filter((item) => item.key !== normalized.key)
  entries.push(normalized)
  const { dropped } = writeFileCache(entries)
  for (const item of dropped) {
    void removeLocalFile(item.localName, options).catch(() => {})
  }
  return normalized
}

/**
 * 清掉超过保存天数没看的缓存。启动时调一次，每次查看前也会先走一遍，
 * 这样长期放着不用的手机不会一直占着磁盘。
 */
export async function sweepFileCache(options = {}) {
  const now = Number(options.now) || Date.now()
  const entries = readFileCache()
  if (!entries.length) return { removed: 0, kept: 0, entries: [] }
  const { keep, expired } = planFileCacheSweep(entries, now, options.ttl)
  if (!expired.length) return { removed: 0, kept: keep.length, entries: keep }
  for (const entry of expired) {
    await removeLocalFile(entry.localName, options)
  }
  const removedKeys = new Set(expired.map((entry) => entry.key))
  // 删文件期间可能又有新条目写进来，重新读一遍再过滤，避免把新记录冲掉。
  const latest = readFileCache().filter((entry) => !removedKeys.has(entry.key))
  writeFileCache(latest)
  return { removed: expired.length, kept: latest.length, entries: latest }
}

/**
 * 打开文件：有可用缓存就直接返回本地路径并续期，否则分块下载后记一条缓存。
 * 返回值比 downloadRemoteFile 多 cached / lastViewedAt 两个字段。
 */
export async function openCachedDownload(request, file, options = {}) {
  const path = String(file?.path || '')
  const workspacePath = String(options.workspacePath || file?.workspacePath || '')
  const now = Number(options.now) || Date.now()
  const key = fileCacheKey(workspacePath, path)

  await sweepFileCache({ ...options, now })

  if (key && options.force !== true) {
    const entry = readFileCache().find((item) => item.key === key)
    if (entry && !isFileCacheExpired(entry, now, options.ttl)) {
      const info = await localFileInfo(entry.localName, options)
      const expected = Number(entry.size) || 0
      const remote = Number(file?.size) || 0
      const localOk = info.exists && (expected <= 0 || info.size === expected)
      const remoteOk = !remote || !expected || remote === expected
      if (localOk && remoteOk) {
        const touched = touchFileCacheEntry(workspacePath, path, now)
        return {
          filePath: info.filePath,
          localPath: localFilePathFor(entry.localName),
          name: entry.name,
          localName: entry.localName,
          size: info.size || entry.size,
          total: info.size || entry.size,
          cached: true,
          lastViewedAt: touched?.lastViewedAt || now
        }
      }
    }
  }

  const localName = key ? cacheFileNameFor(key, file?.name || path) : undefined
  const result = await downloadRemoteFile(request, file, { ...options, localName })
  if (key) {
    recordFileCacheEntry(
      {
        key,
        workspacePath,
        path,
        name: result.name,
        localName: result.localName || localName,
        size: result.size
      },
      now,
      options
    )
  }
  return { ...result, cached: false, lastViewedAt: now }
}
