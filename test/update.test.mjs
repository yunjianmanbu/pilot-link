/**
 * 在线更新清单解析与版本比较的单元测试。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CHANGELOG_URL,
  DOWNLOAD_PAGE_URL,
  cancelUpdateDownload,
  compareVersionNames,
  computeDownloadProgress,
  formatUpdateBytes,
  getLastUpdateManifest,
  getUpdateDownloadState,
  installDownloadedUpdate,
  isNewerVersion,
  normalizeUpdateManifest,
  openChangelogPage,
  openUpdateDownloadPage,
  openUpdatePage,
  resolveUpdateTarget,
  startUpdateDownload,
  subscribeUpdateDownload,
  withUpdateTarget
} from '../lib/update.js'

const VALID = {
  version: '1.0.2',
  versionCode: 102,
  url: 'https://download.medpilot.cc/pilot/android/Pilot-1.0.2.apk',
  sha256: '4DB3A17204FE53055AE5AAF0C278FF6F2F86EC96DD0157389A082F2067A88E6D',
  size: 20324102,
  notes: '修复状态栏重叠',
  force: false
}

test('合法清单会被规整，sha256 转小写', () => {
  const manifest = normalizeUpdateManifest(VALID)
  assert.ok(manifest)
  assert.equal(manifest.version, '1.0.2')
  assert.equal(manifest.versionCode, 102)
  assert.equal(manifest.size, 20324102)
  assert.equal(manifest.force, false)
  assert.match(manifest.sha256, /^[0-9a-f]{64}$/)
  assert.equal(manifest.notes, '修复状态栏重叠')
})

test('也接受 JSON 字符串', () => {
  const manifest = normalizeUpdateManifest(JSON.stringify(VALID))
  assert.ok(manifest)
  assert.equal(manifest.versionCode, 102)
})

test('拒绝非 HTTPS、非下载域名和缺字段的清单', () => {
  assert.equal(normalizeUpdateManifest({ ...VALID, url: 'http://download.medpilot.cc/a.apk' }), null)
  assert.equal(normalizeUpdateManifest({ ...VALID, url: 'https://evil.example.com/a.apk' }), null)
  assert.equal(normalizeUpdateManifest({ ...VALID, url: 'https://download.medpilot.cc.evil.com/a.apk' }), null)
  assert.equal(normalizeUpdateManifest({ ...VALID, url: 'https://download.medpilot.cc:8443/a.apk' }), null)
  assert.equal(normalizeUpdateManifest({ ...VALID, version: '' }), null)
  assert.equal(normalizeUpdateManifest({ ...VALID, versionCode: 'x' }), null)
  assert.equal(normalizeUpdateManifest(null), null)
  assert.equal(normalizeUpdateManifest('not json'), null)
})

test('不依赖浏览器的 URL 全局对象（App 逻辑层没有 URL）', () => {
  const savedUrl = globalThis.URL
  delete globalThis.URL
  try {
    const manifest = normalizeUpdateManifest(VALID)
    assert.ok(manifest)
    assert.equal(manifest.url, VALID.url)
    assert.equal(normalizeUpdateManifest({ ...VALID, url: 'https://evil.example.com/a.apk' }), null)
  } finally {
    globalThis.URL = savedUrl
  }
})

test('容忍 JSON 字符串前带 BOM 和空白', () => {
  const text = String.fromCharCode(0xfeff) + '  ' + JSON.stringify(VALID) + String.fromCharCode(10)
  const manifest = normalizeUpdateManifest(text)
  assert.ok(manifest)
  assert.equal(manifest.versionCode, 102)
})

test('不合法的 sha256 会被丢弃而不是拒绝整份清单', () => {
  const manifest = normalizeUpdateManifest({ ...VALID, sha256: 'oops' })
  assert.ok(manifest)
  assert.equal(manifest.sha256, '')
})

test('优先按 versionCode 判断是否更新', () => {
  assert.equal(isNewerVersion({ versionCode: 102, version: '1.0.0' }, { versionCode: 101, version: '9.9.9' }), true)
  assert.equal(isNewerVersion({ versionCode: 101, version: '9.9.9' }, { versionCode: 101, version: '1.0.0' }), false)
  assert.equal(isNewerVersion({ versionCode: 100, version: '1.0.2' }, { versionCode: 101, version: '1.0.1' }), false)
})

test('缺少 versionCode 时按版本名比较', () => {
  assert.equal(compareVersionNames('1.0.2', '1.0.1'), 1)
  assert.equal(compareVersionNames('1.2', '1.10'), -1)
  assert.equal(compareVersionNames('2.0.0', '2.0'), 0)
  assert.equal(isNewerVersion({ versionCode: 0, version: '1.0.2' }, { versionCode: 0, version: '1.0.1' }), true)
  assert.equal(isNewerVersion({ versionCode: 0, version: '1.0.1' }, { versionCode: 0, version: '1.0.1' }), false)
})

test('下载进度按字节计算并限制在 0–100', () => {
  assert.equal(computeDownloadProgress(0, 100), 0)
  assert.equal(computeDownloadProgress(42, 100), 42)
  assert.equal(computeDownloadProgress(200, 100), 100)
  assert.equal(computeDownloadProgress(42, 0), 0)
  assert.equal(computeDownloadProgress(-1, 100), 0)
  assert.equal(computeDownloadProgress('x', 'y'), 0)
})

test('文件大小展示保留一位小数', () => {
  assert.equal(formatUpdateBytes(0), '')
  assert.equal(formatUpdateBytes(512), '512 B')
  assert.equal(formatUpdateBytes(2048), '2 KB')
  assert.equal(formatUpdateBytes(17728819), '16.9 MB')
})

test('订阅下载状态会立即收到当前快照', () => {
  const seen = []
  const unsubscribe = subscribeUpdateDownload((state) => seen.push(state))
  assert.equal(seen.length, 1)
  assert.equal(seen[0].status, 'idle')
  assert.equal(getUpdateDownloadState().status, 'idle')
  unsubscribe()
})

test('更新页会记录清单并跳转到独立页面', () => {
  const savedUni = globalThis.uni
  let navigated = ''
  globalThis.uni = {
    navigateTo({ url }) {
      navigated = url
    }
  }
  try {
    const manifest = normalizeUpdateManifest(VALID)
    openUpdatePage(manifest)
    assert.equal(navigated, '/pages/update/index')
    assert.equal(getLastUpdateManifest().version, '1.0.2')
    assert.equal(getLastUpdateManifest().versionCode, 102)
  } finally {
    globalThis.uni = savedUni
  }
})

test('浏览器下载：App 内打开系统浏览器，H5 回退到 window.open', () => {
  const savedPlus = globalThis.plus
  const savedUni = globalThis.uni
  const savedWindow = globalThis.window
  const opened = []
  globalThis.uni = { showToast() {} }
  globalThis.plus = {
    runtime: {
      openURL(url) {
        opened.push(url)
      }
    }
  }
  try {
    openUpdateDownloadPage()
    assert.equal(opened[0], DOWNLOAD_PAGE_URL)

    delete globalThis.plus
    globalThis.window = {
      open(url) {
        opened.push(url)
        return {}
      }
    }
    openUpdateDownloadPage()
    assert.equal(opened[1], DOWNLOAD_PAGE_URL)
  } finally {
    globalThis.plus = savedPlus
    globalThis.uni = savedUni
    globalThis.window = savedWindow
  }
})

test('版本更新记录指向官网手机端记录并直接打开', () => {
  // 官网的版本记录按平台分开，手机端入口要落在「手机端」标签上。
  assert.match(CHANGELOG_URL, /^https:\/\/pilot\.medpilot\.cc\/\?changelog=mobile$/)

  const savedPlus = globalThis.plus
  const savedUni = globalThis.uni
  const savedWindow = globalThis.window
  const opened = []
  globalThis.uni = { showToast() {} }
  globalThis.plus = {
    runtime: {
      openURL(url) {
        opened.push(url)
      }
    }
  }
  try {
    openChangelogPage()
    assert.equal(opened[0], CHANGELOG_URL)

    delete globalThis.plus
    globalThis.window = {
      open(url) {
        opened.push(url)
        return {}
      }
    }
    openChangelogPage()
    assert.equal(opened[1], CHANGELOG_URL)
  } finally {
    globalThis.plus = savedPlus
    globalThis.uni = savedUni
    globalThis.window = savedWindow
  }
})

test('首页左下角显示版本号，点按可手动检查更新', () => {
  const file = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'pages',
    'sessions',
    'index.vue'
  )
  const source = fs.readFileSync(file, 'utf8')
  assert.ok(source.includes('class="version-chip"'), '首页缺少左下角版本号')
  assert.ok(source.includes('{{ checkingUpdate ? t(\'检查更新中…\') : versionLabel }}'))
  assert.ok(source.includes('versionLabel()'), '版本号不是 computed')
  assert.ok(source.includes('checkAndPromptUpdate({ manual: true })'), '点按没有手动检查更新')
  assert.ok(source.includes('.version-chip'), '版本号缺少定位样式')
  assert.ok(source.includes('.version-text'), '版本号缺少文字样式')
  const chipStart = source.indexOf('.version-chip {')
  const chipRule = source.slice(chipStart, source.indexOf('}', chipStart))
  assert.ok(chipRule.includes('left: 40rpx'), '版本号应固定在左下角')
  assert.ok(!chipRule.includes('right: 40rpx'), '版本号不应再贴右边')
  // 版本号要带圆角背景，否则在页面底色上太淡、看不清。
  assert.match(chipRule, /border-radius:\s*999rpx/, '版本号缺少圆角背景')
  assert.match(chipRule, /background:\s*var\(--surface-3\)/, '版本号背景没有跟随主题')
  const textStart = source.indexOf('.version-text {')
  const textRule = source.slice(textStart, source.indexOf('}', textStart))
  assert.match(textRule, /color:\s*var\(--muted\)/, '版本号文字应使用次级文字颜色')
})

test('原生下载器会推进进度，取消后回到 idle', async () => {
  const task = {
    state: 0,
    totalSize: 1000,
    downloadedSize: 0,
    filename: '_doc/Pilot-1.0.10.apk',
    listener: null,
    aborted: false,
    addEventListener(name, listener) {
      assert.equal(name, 'statechanged')
      this.listener = listener
    },
    start() {
      this.state = 1
      this.listener(this)
      // state 3 才是「接收数据中」；进度必须在它触发时更新。
      this.state = 3
      this.downloadedSize = 420
      this.listener(this)
    },
    abort() {
      this.aborted = true
    }
  }
  const savedPlus = globalThis.plus
  const savedUni = globalThis.uni
  globalThis.plus = {
    runtime: { version: '1.0.9', versionCode: 109, install() {}, openURL() {} },
    downloader: {
      createDownload(url, options) {
        assert.equal(url, 'https://download.medpilot.cc/pilot/android/Pilot-1.0.10.apk')
        assert.equal(options.filename, '_doc/Pilot-1.0.10.apk')
        return task
      }
    },
    io: {
      resolveLocalFileSystemURL(path, success, fail) {
        assert.equal(path, '_doc/Pilot-1.0.10.apk')
        fail({ message: 'not found' })
      }
    }
  }
  globalThis.uni = { showToast() {}, showModal() {} }
  try {
    const started = startUpdateDownload({
      version: '1.0.10',
      versionCode: 110,
      url: 'https://download.medpilot.cc/pilot/android/Pilot-1.0.10.apk',
      sha256: '',
      size: 1000
    })
    assert.equal(started, true)
    // 先等待删除旧文件（上面模拟为不存在）的 Promise 完成。
    await new Promise((resolve) => setTimeout(resolve, 0))
    const downloading = getUpdateDownloadState()
    assert.equal(downloading.status, 'downloading')
    assert.equal(downloading.version, '1.0.10')
    assert.equal(downloading.received, 420)
    assert.equal(downloading.progress, 42)
    assert.equal(cancelUpdateDownload(), true)
    assert.equal(task.aborted, true)
    assert.equal(getUpdateDownloadState().status, 'idle')
  } finally {
    globalThis.plus = savedPlus
    globalThis.uni = savedUni
  }
})

test('下载完成后分块读取校验 SHA-256 并进入 ready', async () => {
  const { sha256 } = await import('@noble/hashes/sha256')
  const total = 2 * 1024 * 1024 + 123
  const bytes = new Uint8Array(total)
  for (let index = 0; index < total; index += 1) bytes[index] = index % 251
  const digest = Array.from(sha256(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  const path = '_doc/Pilot-1.0.13.apk'
  const entry = {
    file(success) {
      success({
        size: total,
        slice(start, end) {
          return { start, end }
        }
      })
    },
    remove(success) {
      success()
    }
  }
  const task = {
    state: 0,
    totalSize: total,
    downloadedSize: 0,
    listener: null,
    addEventListener(name, listener) {
      assert.equal(name, 'statechanged')
      this.listener = listener
    },
    start() {
      this.state = 3
      this.downloadedSize = 4096
      this.listener(this)
    },
    abort() {}
  }
  const savedPlus = globalThis.plus
  const savedUni = globalThis.uni
  const savedSetTimeout = globalThis.setTimeout
  globalThis.plus = {
    runtime: { version: '1.0.12', versionCode: 112, install() {}, openURL() {} },
    downloader: { createDownload: () => task },
    io: {
      resolveLocalFileSystemURL(target, success, fail) {
        if (target === path) {
          success(entry)
          return
        }
        fail({ message: 'not found' })
      },
      convertLocalFileSystemURL(value) {
        return value
      },
      FileReader: class {
        readAsArrayBuffer(slice) {
          const chunk = bytes.slice(slice.start, slice.end)
          savedSetTimeout(() => this.onload({ target: { result: chunk.buffer } }), 0)
        }
      }
    }
  }
  globalThis.uni = { showToast() {}, showModal() {} }
  try {
    const started = startUpdateDownload({
      version: '1.0.13',
      versionCode: 113,
      url: 'https://download.medpilot.cc/pilot/android/Pilot-1.0.13.apk',
      sha256: digest,
      size: total
    })
    assert.equal(started, true)
    await new Promise((resolve) => savedSetTimeout(resolve, 10))
    assert.equal(getUpdateDownloadState().status, 'downloading')
    task.listener({ state: 4, filename: path, totalSize: total })
    const deadline = Date.now() + 4000
    while (getUpdateDownloadState().status !== 'ready' && Date.now() < deadline) {
      await new Promise((resolve) => savedSetTimeout(resolve, 20))
    }
    const state = getUpdateDownloadState()
    assert.equal(state.status, 'ready')
    assert.equal(state.progress, 100)
  } finally {
    cancelUpdateDownload()
    globalThis.plus = savedPlus
    globalThis.uni = savedUni
  }
})

/* -------------------- wgt 资源热更 -------------------- */

const WGT_DIGEST = 'c'.repeat(64)
const WGT_MANIFEST = {
  version: '1.0.23',
  versionCode: 123,
  url: 'https://download.medpilot.cc/pilot/android/Pilot-1.0.23.apk',
  sha256: 'a'.repeat(64),
  size: 17831975,
  notes: '',
  force: false,
  wgt: {
    version: '1.0.23',
    url: 'https://download.medpilot.cc/pilot/android/Pilot-1.0.23.wgt',
    sha256: WGT_DIGEST,
    size: 420678
  }
}

test('清单里的 wgt 字段会被规整，下载站以外或缺少 sha256 时只丢弃 wgt', () => {
  const parsed = normalizeUpdateManifest(WGT_MANIFEST)
  assert.deepEqual(parsed.wgt, {
    version: '1.0.23',
    url: 'https://download.medpilot.cc/pilot/android/Pilot-1.0.23.wgt',
    sha256: WGT_DIGEST,
    size: 420678
  })

  // 大写的 sha256 归一成小写
  const upper = normalizeUpdateManifest({ ...WGT_MANIFEST, wgt: { ...WGT_MANIFEST.wgt, sha256: WGT_DIGEST.toUpperCase() } })
  assert.equal(upper.wgt.sha256, WGT_DIGEST)

  // wgt 指向别的域名：只丢掉 wgt，全量 APK 仍然可用
  const foreign = normalizeUpdateManifest({
    ...WGT_MANIFEST,
    wgt: { ...WGT_MANIFEST.wgt, url: 'https://evil.example.com/Pilot.wgt' }
  })
  assert.equal(foreign.wgt, null)
  assert.equal(foreign.url, WGT_MANIFEST.url)

  // wgt 没有 sha256：必须丢弃（不能只靠大小校验就直接解包前端代码）
  const unsigned = normalizeUpdateManifest({ ...WGT_MANIFEST, wgt: { ...WGT_MANIFEST.wgt, sha256: '' } })
  assert.equal(unsigned.wgt, null)

  // 清单里没有 wgt 字段时照旧返回 null
  assert.equal(normalizeUpdateManifest({ ...WGT_MANIFEST, wgt: undefined }).wgt, null)
})

test('壳比全量包旧时先装 APK，壳同代时才走 wgt', () => {
  const current = { version: '1.0.22', versionCode: 122 }
  // 壳 1.0.22 落后于全量包 1.0.23：原生能力（前台服务、Wi-Fi 锁、新权限）只能
  // 随 APK 下发，所以即使 wgt 版本更新也必须先装完整包。
  const target = resolveUpdateTarget(WGT_MANIFEST, current)
  assert.equal(target.kind, 'apk')
  assert.equal(target.version, '1.0.23')
  assert.equal(target.url, WGT_MANIFEST.url)

  // 壳已经是最新全量包，只剩热更：走 wgt
  const hotter = {
    ...WGT_MANIFEST,
    wgt: { ...WGT_MANIFEST.wgt, version: '1.0.24', size: 430000 }
  }
  const warm = resolveUpdateTarget(hotter, { version: '1.0.23', versionCode: 123 })
  assert.equal(warm.kind, 'wgt')
  assert.equal(warm.version, '1.0.24')
  assert.equal(warm.size, 430000)
  assert.equal(warm.url, WGT_MANIFEST.wgt.url)

  // wgt 已经装过：不能重复装同一个 wgt，应该走全量 APK（例如原生模块或壳版本变更）
  const applied = resolveUpdateTarget(WGT_MANIFEST, { version: '1.0.23', versionCode: 122 })
  assert.equal(applied.kind, 'apk')
  assert.equal(applied.url, WGT_MANIFEST.url)

  // 没有 wgt 字段：老路径不变
  const apkOnly = resolveUpdateTarget({ ...WGT_MANIFEST, wgt: null }, current)
  assert.equal(apkOnly.kind, 'apk')

  // 完全不比当前新：不提示更新
  assert.equal(resolveUpdateTarget(WGT_MANIFEST, { version: '1.0.23', versionCode: 123 }), null)
  assert.equal(resolveUpdateTarget(hotter, { version: '1.0.24', versionCode: 123 }), null)

  // withUpdateTarget 把选中的产物投影到顶层字段，下载/安装只认 version/url/sha256/size
  const projected = withUpdateTarget(hotter, { version: '1.0.23', versionCode: 123 })
  assert.equal(projected.kind, 'wgt')
  assert.equal(projected.url, WGT_MANIFEST.wgt.url)
  assert.equal(projected.size, 430000)
  assert.equal(projected.apkUrl, WGT_MANIFEST.url)
  assert.equal(projected.notes, '')
  assert.equal(withUpdateTarget(WGT_MANIFEST, { version: '1.0.23', versionCode: 123 }), null)
})

test('wgt 下载到 _doc/*.wgt，校验通过后用 plus.runtime.install 安装并重启', async () => {
  const { sha256 } = await import('@noble/hashes/sha256')
  const bytes = new Uint8Array(4096)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251
  const digest = Array.from(sha256(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  const path = '_doc/Pilot-1.0.23.wgt'
  const entry = {
    file(success) {
      success({
        size: bytes.length,
        slice(start, end) {
          return { start, end }
        }
      })
    },
    remove(success) {
      success()
    }
  }
  const task = {
    state: 0,
    totalSize: bytes.length,
    downloadedSize: 0,
    listener: null,
    addEventListener(name, listener) {
      assert.equal(name, 'statechanged')
      this.listener = listener
    },
    start() {
      this.state = 3
      this.downloadedSize = 1024
      this.listener(this)
    },
    abort() {}
  }
  const calls = []
  const storage = new Map()
  const savedPlus = globalThis.plus
  const savedUni = globalThis.uni
  const savedSetTimeout = globalThis.setTimeout
  globalThis.plus = {
    runtime: {
      version: '1.0.22',
      versionCode: 122,
      install(target, options, success) {
        calls.push({ install: target, options })
        success()
      },
      restart() {
        calls.push({ restart: true })
      },
      openURL() {}
    },
    downloader: {
      createDownload(url, options) {
        calls.push({ url, filename: options.filename })
        return task
      }
    },
    io: {
      resolveLocalFileSystemURL(target, success, fail) {
        if (target === path) {
          success(entry)
          return
        }
        fail({ message: 'not found' })
      },
      convertLocalFileSystemURL(value) {
        return value
      },
      FileReader: class {
        readAsArrayBuffer(slice) {
          const chunk = bytes.slice(slice.start, slice.end)
          savedSetTimeout(() => this.onload({ target: { result: chunk.buffer } }), 0)
        }
      }
    }
  }
  globalThis.uni = {
    showToast() {},
    showModal() {},
    getStorageSync: (key) => storage.get(key) || '',
    setStorageSync: (key, value) => storage.set(key, value)
  }
  try {
    assert.equal(
      startUpdateDownload({
        kind: 'wgt',
        version: '1.0.23',
        url: 'https://download.medpilot.cc/pilot/android/Pilot-1.0.23.wgt',
        sha256: digest,
        size: bytes.length
      }),
      true
    )
    await new Promise((resolve) => savedSetTimeout(resolve, 10))
    // 关键点：文件名必须是 .wgt，否则 plus.runtime.install 会当成 APK 交给系统安装器
    assert.equal(calls[0].filename, path)
    assert.equal(getUpdateDownloadState().kind, 'wgt')

    task.listener({ state: 4, filename: path, totalSize: bytes.length })
    const deadline = Date.now() + 4000
    while (getUpdateDownloadState().status !== 'ready' && Date.now() < deadline) {
      await new Promise((resolve) => savedSetTimeout(resolve, 20))
    }
    assert.equal(getUpdateDownloadState().status, 'ready')

    // 重启由 800ms 定时器触发；测试里把它换成立即执行，避免真的等一秒。
    globalThis.setTimeout = (fn) => {
      fn()
      return 0
    }
    try {
      assert.equal(installDownloadedUpdate(), true)
    } finally {
      globalThis.setTimeout = savedSetTimeout
    }
    const installCall = calls.find((call) => call.install === path)
    assert.ok(installCall, '应该用 plus.runtime.install 安装 wgt')
    assert.deepEqual(installCall.options, { force: true })
    assert.ok(calls.some((call) => call.restart === true), '安装后必须 restart 才会生效')
    // 本地兜底记录，避免个别机型重启后版本号不刷新导致重复提示
    assert.equal(storage.get('pilot-app.update-wgt.v1'), '1.0.23')
  } finally {
    cancelUpdateDownload()
    globalThis.plus = savedPlus
    globalThis.uni = savedUni
  }
})
