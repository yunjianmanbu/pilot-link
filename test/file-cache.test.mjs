import assert from 'node:assert/strict'
import test from 'node:test'

import { utf8Encode } from '../lib/bytes.js'
import { base64ToBytes, bytesToBase64 } from '../lib/files.js'

// file-cache.js 通过全局 uni 读写索引、通过 plus.io 读写 App 私有目录，
// 这里用内存版模拟两端，测试不依赖真机。
const memory = new Map()
globalThis.uni = {
  getStorageSync(key) {
    return memory.has(key) ? memory.get(key) : ''
  },
  setStorageSync(key, value) {
    memory.set(key, value)
  },
  removeStorageSync(key) {
    memory.delete(key)
  },
  getLocale: () => 'zh-CN'
}

const {
  FILE_CACHE_DAYS_KEY,
  FILE_CACHE_DEFAULT_DAYS,
  FILE_CACHE_STORAGE_KEY,
  FILE_CACHE_TTL_MS,
  cacheFileNameFor,
  fileCacheDaysLeft,
  fileCacheKey,
  fileCacheTtlMs,
  findFileCacheEntry,
  loadFileCacheDays,
  normalizeFileCacheDays,
  openCachedDownload,
  readFileCache,
  saveFileCacheDays,
  sweepFileCache,
  writeFileCache
} = await import('../lib/file-cache.js')

const DAY = 24 * 60 * 60 * 1000
const START = 1_760_000_000_000

function makeFakePlus() {
  const files = new Map()
  const removed = []
  const writerFor = (name) => ({
    _pos: 0,
    seek(position) {
      this._pos = Math.max(0, Number(position) || 0)
    },
    writeAsBinary(base64) {
      const bytes = base64ToBytes(base64)
      const current = (files.get(name) || []).slice()
      for (let index = 0; index < bytes.length; index += 1) {
        current[this._pos + index] = bytes[index]
      }
      this._pos += bytes.length
      files.set(name, current)
      setTimeout(() => this.onwriteend && this.onwriteend(), 0)
    },
    close() {}
  })
  const fileEntry = (name) => ({
    remove(success) {
      files.delete(name)
      removed.push(name)
      success && success()
    },
    createWriter(ok) {
      ok(writerFor(name))
    },
    getMetadata(success) {
      success({ size: (files.get(name) || []).length })
    }
  })
  const dirEntry = {
    getDirectory(name, options, ok) {
      ok(dirEntry)
    },
    getFile(name, options, ok, fail) {
      if (!files.has(name) && !options?.create) {
        fail && fail({ message: 'not found' })
        return
      }
      if (options?.create && !files.has(name)) files.set(name, [])
      ok(fileEntry(name))
    }
  }
  return {
    files,
    removed,
    plusApi: {
      io: {
        PRIVATE_DOC: 2,
        requestFileSystem(type, success) {
          success({ root: dirEntry })
        },
        convertLocalFileSystemURL(value) {
          return `/absolute/${value}`
        }
      }
    }
  }
}

/** 每次 request 只回一个块，calls 用来判断有没有真的走网络。 */
function makeRequest(bytes, expectedPath) {
  const state = { calls: 0 }
  const request = async (method, params) => {
    assert.equal(method, 'files.read')
    assert.equal(params.file, expectedPath)
    state.calls += 1
    const offset = Number(params.offset) || 0
    const slice = bytes.subarray(offset, bytes.length)
    return {
      name: expectedPath.split('/').pop(),
      size: bytes.length,
      mtime: START,
      offset,
      length: slice.length,
      eof: true,
      data: bytesToBase64(slice)
    }
  }
  request.state = state
  return request
}

function reset() {
  memory.clear()
}

test('同名文件按工作区和路径哈希分开落盘', () => {
  const keyA = fileCacheKey('C:/ws-a', 'docs/README.md')
  const keyB = fileCacheKey('C:/ws-b', 'docs/README.md')
  assert.notEqual(keyA, keyB)
  const nameA = cacheFileNameFor(keyA, 'README.md')
  const nameB = cacheFileNameFor(keyB, 'README.md')
  assert.match(nameA, /^README-[0-9a-f]{8}\.md$/)
  assert.notEqual(nameA, nameB)
  assert.equal(cacheFileNameFor(keyA, 'README.md'), nameA, '同一路径稳定')
  // 反斜杠、结尾分隔符这些写法差异不该产生两份缓存。
  assert.equal(fileCacheKey('C:/ws-a/', 'docs\\README.md'), keyA)
  assert.equal(fileCacheKey('', 'docs/README.md'), '')
})

test('第一次查看会下载并记下查看时间', async () => {
  reset()
  const content = utf8Encode('报告内容'.repeat(20))
  const { plusApi, files } = makeFakePlus()
  const request = makeRequest(content, 'C:/ws/报告.docx')
  const file = { path: 'C:/ws/报告.docx', name: '报告.docx', size: content.length }

  const result = await openCachedDownload(request, file, {
    workspacePath: 'C:/ws',
    plus: plusApi,
    now: START
  })

  assert.equal(result.cached, false)
  assert.equal(result.size, content.length)
  assert.equal(request.state.calls, 1)
  assert.equal(files.size, 1)
  assert.deepEqual(Uint8Array.from([...files.values()][0]), content)

  const entries = readFileCache()
  assert.equal(entries.length, 1)
  assert.equal(entries[0].key, fileCacheKey('C:/ws', file.path))
  assert.equal(entries[0].lastViewedAt, START)
  assert.equal(entries[0].size, content.length)
  assert.equal(fileCacheDaysLeft(entries[0], START), 7)
})

test('7 天内再看一次直接用本地文件并把过期时间往后推', async () => {
  reset()
  const content = utf8Encode('缓存的文档内容')
  const { plusApi } = makeFakePlus()
  const request = makeRequest(content, 'C:/ws/报告.docx')
  const file = { path: 'C:/ws/报告.docx', name: '报告.docx', size: content.length }
  const open = (now, extra = {}) =>
    openCachedDownload(request, file, { workspacePath: 'C:/ws', plus: plusApi, now, ...extra })

  await open(START)
  const thirdDay = START + 3 * DAY
  const second = await open(thirdDay)

  assert.equal(second.cached, true)
  assert.equal(request.state.calls, 1, '命中缓存不再向电脑要文件')
  assert.equal(second.filePath, `/absolute/_doc/pilot-files/${second.localName}`)

  const entry = findFileCacheEntry('C:/ws', file.path, thirdDay)
  assert.ok(entry)
  assert.equal(entry.lastViewedAt, thirdDay, '续期以这次查看时间为准')
  assert.equal(fileCacheDaysLeft(entry, thirdDay), 7)

  // 第 9 天（距第一次 9 天、距最近一次 6 天）仍然命中。
  const ninthDay = START + 9 * DAY
  const third = await open(ninthDay)
  assert.equal(third.cached, true)
  assert.equal(request.state.calls, 1)
})

test('超过 7 天没看：本地文件和索引都被清掉', async () => {
  reset()
  const content = utf8Encode('过期缓存')
  const { plusApi, files, removed } = makeFakePlus()
  const request = makeRequest(content, 'C:/ws/a.pdf')

  await openCachedDownload(
    request,
    { path: 'C:/ws/a.pdf', name: 'a.pdf', size: content.length },
    { workspacePath: 'C:/ws', plus: plusApi, now: START }
  )
  assert.equal(files.size, 1)

  const staleAt = START + FILE_CACHE_TTL_MS + 1
  const swept = await sweepFileCache({ now: staleAt, plus: plusApi })

  assert.equal(swept.removed, 1)
  assert.equal(files.size, 0)
  assert.equal(removed.length, 1)
  assert.deepEqual(readFileCache(), [])
})

test('过期后再打开会重新下载并重新计时', async () => {
  reset()
  const content = utf8Encode('又要看一次')
  const { plusApi, files } = makeFakePlus()
  const request = makeRequest(content, 'C:/ws/b.pdf')
  const file = { path: 'C:/ws/b.pdf', name: 'b.pdf', size: content.length }
  const open = (now) =>
    openCachedDownload(request, file, { workspacePath: 'C:/ws', plus: plusApi, now })

  await open(START)
  const expiredAt = START + FILE_CACHE_TTL_MS
  const again = await open(expiredAt)

  assert.equal(again.cached, false)
  assert.equal(request.state.calls, 2)
  assert.equal(files.size, 1, '旧文件被删后重新写入')
  const entry = findFileCacheEntry('C:/ws', file.path, expiredAt)
  assert.equal(entry.lastViewedAt, expiredAt)
})

test('本地文件丢失或电脑上文件变大时不用旧缓存', async () => {
  reset()
  const content = utf8Encode('第一版内容')
  const { plusApi, files } = makeFakePlus()
  const request = makeRequest(content, 'C:/ws/c.pdf')
  const file = { path: 'C:/ws/c.pdf', name: 'c.pdf', size: content.length }

  await openCachedDownload(request, file, { workspacePath: 'C:/ws', plus: plusApi, now: START })

  // 手机空间被系统清理：文件还在索引里，但本地已经不在了。
  for (const name of [...files.keys()]) files.delete(name)
  const afterLost = await openCachedDownload(request, file, {
    workspacePath: 'C:/ws',
    plus: plusApi,
    now: START + DAY
  })
  assert.equal(afterLost.cached, false)
  assert.equal(request.state.calls, 2)

  // 电脑上同名文件被改大：大小对不上，重新下载。
  const bigger = { ...file, size: content.length + 10 }
  const afterGrow = await openCachedDownload(request, bigger, {
    workspacePath: 'C:/ws',
    plus: plusApi,
    now: START + 2 * DAY
  })
  assert.equal(afterGrow.cached, false)
  assert.equal(request.state.calls, 3)
  const entry = findFileCacheEntry('C:/ws', file.path, START + 2 * DAY)
  assert.equal(entry.size, content.length, '记录的是这次实际下载的大小')
})

test('force 强制重新下载，不等 7 天', async () => {
  reset()
  const content = utf8Encode('强制刷新')
  const { plusApi } = makeFakePlus()
  const request = makeRequest(content, 'C:/ws/d.pdf')
  const file = { path: 'C:/ws/d.pdf', name: 'd.pdf', size: content.length }

  await openCachedDownload(request, file, { workspacePath: 'C:/ws', plus: plusApi, now: START })
  const forced = await openCachedDownload(request, file, {
    workspacePath: 'C:/ws',
    plus: plusApi,
    now: START + DAY,
    force: true
  })
  assert.equal(forced.cached, false)
  assert.equal(request.state.calls, 2)
})

test('索引超过上限时保留最近看过的', () => {
  reset()
  const entries = [0, 1, 2].map((index) => ({
    key: `C:/ws::${index}.pdf`,
    workspacePath: 'C:/ws',
    path: `C:/ws/${index}.pdf`,
    name: `${index}.pdf`,
    localName: `${index}-aaaaaaaa.pdf`,
    size: 10,
    savedAt: START + index,
    lastViewedAt: START + index
  }))
  const { kept, dropped } = writeFileCache(entries, { limit: 2 })
  assert.equal(kept.length, 2)
  assert.equal(dropped.length, 1)
  assert.equal(dropped[0].path, 'C:/ws/0.pdf')
  assert.equal(readFileCache().length, 2)
})

test('索引里坏掉的条目不会拖垮读取', () => {
  reset()
  memory.set(
    FILE_CACHE_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      entries: [
        null,
        { key: '', localName: 'x.pdf', lastViewedAt: START },
        { key: 'C:/ws::ok.pdf', localName: 'ok-11111111.pdf', lastViewedAt: START },
        { key: 'C:/ws::bad.pdf', localName: 'bad.pdf', lastViewedAt: 'oops' }
      ]
    })
  )
  const entries = readFileCache()
  assert.equal(entries.length, 1)
  assert.equal(entries[0].key, 'C:/ws::ok.pdf')
})

test('保存天数默认 7 天，可以自己改，越界值夹到边界', () => {
  reset()
  assert.equal(FILE_CACHE_DEFAULT_DAYS, 7)
  assert.equal(loadFileCacheDays(), 7, '没设置过就是默认值')
  assert.equal(fileCacheTtlMs(), 7 * DAY)
  assert.equal(FILE_CACHE_TTL_MS, 7 * DAY, '旧常量仍是默认天数对应的时长')

  assert.equal(saveFileCacheDays(30), 30)
  assert.equal(loadFileCacheDays(), 30)
  assert.equal(fileCacheTtlMs(), 30 * DAY)

  // 字符串、小数、0、负数、NaN、超大值都要落到合法范围。
  assert.equal(normalizeFileCacheDays('14'), 14)
  assert.equal(normalizeFileCacheDays(3.4), 3)
  assert.equal(normalizeFileCacheDays(0), 7, '0 天没有意义，回落到默认值')
  assert.equal(normalizeFileCacheDays(-5), 7)
  assert.equal(normalizeFileCacheDays('oops'), 7)
  assert.equal(normalizeFileCacheDays(99_999), 365)
  assert.equal(saveFileCacheDays(5), 5, '正常值原样生效')
  assert.equal(loadFileCacheDays(), 5)

  // 存储里被写成脏值也不影响读取。
  memory.set(FILE_CACHE_DAYS_KEY, 'abc')
  assert.equal(loadFileCacheDays(), 7)
})

test('改小保存天数后，已有缓存按新的天数过期', async () => {
  reset()
  const content = utf8Encode('配置影响的过期判断')
  const { plusApi } = makeFakePlus()
  const request = makeRequest(content, 'C:/ws/配置.docx')
  const file = { path: 'C:/ws/配置.docx', name: '配置.docx', size: content.length }
  const open = (now, extra = {}) =>
    openCachedDownload(request, file, { workspacePath: 'C:/ws', plus: plusApi, now, ...extra })

  saveFileCacheDays(30)
  const first = await open(START)
  assert.equal(first.cached, false)

  // 第 10 天：只查索引不续期，30 天期下仍然命中，剩余天数按设置算。
  const tenthDay = START + 10 * DAY
  assert.ok(findFileCacheEntry('C:/ws', file.path, tenthDay), '30 天期下第 10 天仍命中')
  assert.equal(
    fileCacheDaysLeft(findFileCacheEntry('C:/ws', file.path, tenthDay), tenthDay),
    20,
    '剩余天数按设置计算，不是写死 7 天'
  )

  // 改成 1 天：上一次查看在第一天，第 10 天已经超期。
  saveFileCacheDays(1)
  assert.equal(findFileCacheEntry('C:/ws', file.path, tenthDay), null, '缩短天数后超期条目不再命中')
  const third = await open(tenthDay)
  assert.equal(third.cached, false, '缩短天数后超期的会重下')
  assert.equal(request.state.calls, 2)
  assert.equal(readFileCache().length, 1)
})

test('改天数不会动电脑上的文件，也不会把索引清空', async () => {
  reset()
  const content = utf8Encode('保留索引')
  const { plusApi, files } = makeFakePlus()
  const request = makeRequest(content, 'C:/ws/留.docx')
  const file = { path: 'C:/ws/留.docx', name: '留.docx', size: content.length }
  await openCachedDownload(request, file, {
    workspacePath: 'C:/ws',
    plus: plusApi,
    now: START
  })

  saveFileCacheDays(90)
  const kept = readFileCache()
  assert.equal(kept.length, 1)
  assert.equal(files.size, 1)
  assert.equal(kept[0].lastViewedAt, START, '改设置不改查看时间，不能凭空续期')
})
