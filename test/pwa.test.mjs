/**
 * PWA 壳的自检：manifest 必须能解析、图标必须真存在且尺寸对得上、
 * Service Worker 必须只缓存静态资源而放行业务请求、index.html 必须真的挂上它们。
 *
 * 这些断言守的是「装到主屏幕」和「断网还能打开」的唯一前提 —— 全都写在
 * 静态文件里，写错了不会有运行时报错，只会在真机上静默失效。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PWA_DIR = join(ROOT, 'pwa')

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** 只读 PNG 的 IHDR 拿宽高。 */
function pngSize(relPath) {
  const file = join(ROOT, relPath.replace(/^\.\//, ''))
  assert.ok(existsSync(file), `图标不存在：${relPath}`)
  const head = readFileSync(file).subarray(0, 24)
  assert.deepEqual(
    [...head.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    `${relPath} 不是 PNG`
  )
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
}

test('manifest 是合法 JSON，且声明为可安装的 standalone', () => {
  const manifest = readJson(join(PWA_DIR, 'manifest.webmanifest'))
  assert.equal(manifest.name, 'Pilot Link')
  assert.equal(manifest.short_name, 'Pilot')
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.start_url, './', 'start_url 要相对，线上挂在 /app/ 也能用')
  assert.equal(manifest.scope, './')
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i)
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i)
})

test('manifest 的图标都在、尺寸与声明一致，且至少有一张 maskable', () => {
  const manifest = readJson(join(PWA_DIR, 'manifest.webmanifest'))
  const icons = manifest.icons || []
  assert.ok(icons.length >= 3, '至少要有 192 / 512 / maskable 三张')

  let has192 = false
  let has512 = false
  let hasMaskable = false
  for (const icon of icons) {
    const match = /^(\d+)x(\d+)$/.exec(String(icon.sizes || ''))
    assert.ok(match, `图标 ${icon.src} 的 sizes 格式不对：${icon.sizes}`)
    const size = pngSize(icon.src)
    assert.equal(String(size.width), match[1], `${icon.src} 宽度与 sizes 不一致`)
    assert.equal(String(size.height), match[2], `${icon.src} 高度与 sizes 不一致`)
    if (match[1] === '192') has192 = true
    if (match[1] === '512') has512 = true
    if (String(icon.purpose || '').split(/\s+/).includes('maskable')) hasMaskable = true
  }
  assert.ok(has192, '缺 192x192 图标，安卓装到主屏会用错图')
  assert.ok(has512, '缺 512x512 图标，Chrome 不认为是可安装应用')
  assert.ok(hasMaskable, '缺 maskable 图标，自适应图标会把字形裁掉')
})

test('index.html 挂上了 manifest、主题色与 iOS 主屏元信息', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest"/)
  assert.match(html, /name="theme-color"/)
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/)
  assert.match(html, /name="apple-mobile-web-app-title"/)
  assert.match(html, /rel="apple-touch-icon"/)
  // 状态栏区域在浅色主题下也要铺白，否则装成独立窗口会出现一条黑边。
  assert.match(html, /prefers-color-scheme: light/)
})

test('Service Worker 存在且只接管静态资源', () => {
  const source = readFileSync(join(PWA_DIR, 'sw.js'), 'utf8')
  assert.match(source, /addEventListener\('install'/)
  assert.match(source, /addEventListener\('activate'/)
  assert.match(source, /addEventListener\('fetch'/)
  assert.match(source, /skipWaiting/, '不 skipWaiting 会让新版本等到用户关页面才生效')
  assert.match(source, /clients\.claim/, '不 claim 时首次安装的页面不受控')
  assert.match(source, /caches\.keys\(\)[\s\S]*?caches\.delete/, '旧版本缓存不会被清掉')
  // 业务数据走 WebSocket，SW 不该缓存跨域请求（中继、下载站）。
  assert.match(source, /url\.origin !== self\.location\.origin/)
  // 预缓存清单只能由构建脚本注入：写死文件名在哈希变动后会全部落空。
  assert.match(source, /@precache-assets/)
  assert.match(source, /const ASSET_PRECACHE = \[\]/, '源模板里清单应该是空的，由脚本填')
})

/** 用假 caches / fetch 跑一遍 SW 的 fetch 分支，确认跨域请求真的被放行。 */
function runServiceWorker() {
  const listeners = new Map()
  const added = []
  const handlers = []
  const self = {
    location: { origin: 'https://pilot.medpilot.cc' },
    addEventListener(type, handler) {
      listeners.set(type, handler)
    },
    skipWaiting: async () => {},
    clients: { claim: async () => {} }
  }
  const cacheStore = new Map()
  const caches = {
    open: async (name) => {
      if (!cacheStore.has(name)) cacheStore.set(name, new Map())
      const store = cacheStore.get(name)
      return {
        add: async (request) => {
          added.push(String(request.url ?? request))
        },
        put: async (request, response) => {
          store.set(String(request.url), response)
        },
        match: async (request) => store.get(String(request.url)) || null
      }
    },
    keys: async () => [...cacheStore.keys()]
  }
  const context = vm.createContext({
    self,
    caches,
    fetch: async () => ({ ok: true, clone: () => ({}) }),
    Request: class {
      constructor(url) {
        this.url = url
      }
    },
    Response: class {},
    URL,
    Promise,
    console
  })
  vm.runInContext(readFileSync(join(PWA_DIR, 'sw.js'), 'utf8'), context)
  return { listeners, added, handlers }
}

test('SW 安装时预缓存壳文件，activate 时清掉旧版本', async () => {
  const { listeners, added } = runServiceWorker()
  const install = listeners.get('install')
  assert.ok(install, '没有 install 监听')
  let pending = null
  install({ waitUntil: (promise) => (pending = promise) })
  await pending
  // 模板里 ASSET_PRECACHE 为空，壳是首屏 + manifest；真实资源清单由构建脚本注入。
  assert.deepEqual(added, ['./', './manifest.webmanifest'])

  let activated = null
  listeners.get('activate')({ waitUntil: (promise) => (activated = promise) })
  await activated
})

test('SW 对跨域请求与 POST 完全不介入', () => {
  const { listeners } = runServiceWorker()
  const fetchHandler = listeners.get('fetch')
  const events = []
  const makeEvent = (request) => ({
    request,
    respondWith: () => events.push(request.url)
  })

  fetchHandler(makeEvent({ method: 'POST', url: 'https://pilot.medpilot.cc/api' }))
  fetchHandler(makeEvent({ method: 'GET', url: 'https://relay.example.com/connector' }))
  fetchHandler(makeEvent({ method: 'GET', url: 'https://pilot.medpilot.cc/sw.js' }))
  assert.deepEqual(events, [], '这些请求都不该被 SW 接管')

  fetchHandler({
    ...makeEvent({ method: 'GET', url: 'https://pilot.medpilot.cc/assets/index-abc.js', mode: 'no-cors' }),
    respondWith: (promise) => events.push(typeof promise?.then)
  })
  assert.deepEqual(events, ['function'], '构建产物应该走 cache-first')
})

test('main.js 只在 H5 注册 SW，且不在非安全上下文强注册', () => {
  const source = readFileSync(join(ROOT, 'main.js'), 'utf8')
  assert.match(source, /#ifdef H5/, '没有用条件编译包住，App 端会白跑一遍')
  assert.match(source, /serviceWorker' in navigator/)
  assert.match(source, /isSecureContext/, '局域网 HTTP 下强注册只会刷控制台报错')
  assert.match(source, /register\('\.\/sw\.js'/, 'sw.js 要相对路径，线上挂在 /app/ 也能用')
  assert.match(source, /scope: '\.\/'/)
  // 注册失败必须静默：HBuilderX 调试服务器上没有 sw.js，那是正常情况。
  assert.match(source, /\.catch\(\(\) => \{/)
})

/* ── 构建铺文件脚本 ────────────────────────────────────────────────── */

test('prepare-app-web.mjs 把壳文件铺到构建目录，--check 能查出缺失', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { spawnSync } = await import('node:child_process')

  const script = join(ROOT, '..', 'scripts', 'prepare-app-web.mjs')
  const work = mkdtempSync(join(tmpdir(), 'pilot-app-web-'))
  const webDir = join(work, 'web')
  mkdirSync(join(webDir, 'static', 'icons'), { recursive: true })
  copyFileSync(join(ROOT, 'index.html'), join(webDir, 'index.html'))
  for (const name of ['192.png', '512.png', 'maskable-512.png']) {
    copyFileSync(join(ROOT, 'static', 'icons', name), join(webDir, 'static', 'icons', name))
  }

  const run = (...extra) =>
    spawnSync(process.execPath, [script, '--dir', webDir, ...extra], { encoding: 'utf8' })

  try {
    // 没铺文件之前 --check 必须失败（并指明缺哪两个）
    const before = run('--check')
    assert.equal(before.status, 1, before.stdout)
    assert.match(before.stdout, /manifest\.webmanifest 不在构建目录里/)
    assert.match(before.stdout, /sw\.js 不在构建目录里/)

    const copy = run()
    assert.equal(copy.status, 0, copy.stdout)
    assert.ok(existsSync(join(webDir, 'sw.js')))
    assert.ok(existsSync(join(webDir, 'manifest.webmanifest')))

    const after = run('--check')
    assert.equal(after.status, 0, after.stdout)

    // 图标被删掉时 --check 必须报出来，而不是当成 OK
    writeFileSync(join(webDir, 'static', 'icons', '512.png'), '')
    const broken = run('--check')
    assert.equal(broken.status, 1)
    assert.match(broken.stdout, /512\.png/)

    // 目录不存在时是用法错误（退出码 2），不是校验失败
    const missing = spawnSync(process.execPath, [script, '--dir', join(work, 'nope')], {
      encoding: 'utf8'
    })
    assert.equal(missing.status, 2)
    assert.match(missing.stdout, /H5 构建目录不存在/)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

/*
 * 首访即离线可用：macOS Edge 实测发现，页面首访发出的脚本请求早于 SW 接管，
 * 不预缓存就只能在断网时拿到 index.html、拿不到 JS，页面一片空白。
 * 下面这组断言守的就是「构建后必须重跑脚本」这件事。
 */
test('prepare-app-web.mjs 注入预缓存清单，并改掉 index.html 的绝对路径', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { spawnSync } = await import('node:child_process')

  const script = join(ROOT, '..', 'scripts', 'prepare-app-web.mjs')
  const work = mkdtempSync(join(tmpdir(), 'pilot-app-web-pre-'))
  const webDir = join(work, 'web')
  mkdirSync(join(webDir, 'assets'), { recursive: true })
  mkdirSync(join(webDir, 'static', 'icons'), { recursive: true })
  for (const name of ['192.png', '512.png', 'maskable-512.png']) {
    writeFileSync(join(webDir, 'static', 'icons', name), readFileSync(join(ROOT, 'static', 'icons', name)))
  }
  writeFileSync(join(webDir, 'assets', 'index-abc123.js'), 'console.log(1)')
  writeFileSync(join(webDir, 'assets', 'index-def456.css'), 'body{}')
  // HBuilderX 出的 H5 产物就是这种绝对路径写法
  writeFileSync(
    join(webDir, 'index.html'),
    '<link rel="manifest" href="./manifest.webmanifest" />' +
      '<meta name="theme-color" content="#000" />' +
      '<script src="/assets/index-abc123.js"></script>' +
      '<link rel="stylesheet" href="/assets/index-def456.css" />'
  )

  const run = (...extra) =>
    spawnSync(process.execPath, [script, '--dir', webDir, ...extra], { encoding: 'utf8' })

  try {
    const copy = run()
    assert.equal(copy.status, 0, copy.stdout)
    assert.match(copy.stdout, /预缓存清单：5 个资源/)

    const sw = readFileSync(join(webDir, 'sw.js'), 'utf8')
    assert.match(sw, /'\.\/assets\/index-abc123\.js'/, '带哈希的构建产物必须进预缓存')
    assert.match(sw, /'\.\/assets\/index-def456\.css'/)
    assert.match(sw, /'\.\/static\/icons\/512\.png'/, 'manifest 引用的图标也要能离线打开')
    assert.match(sw, /const ASSET_PRECACHE = \[\n/, '清单没被注入')
    assert.doesNotMatch(sw, /const ASSET_PRECACHE = \[\]/, '清单没被注入')

    const html = readFileSync(join(webDir, 'index.html'), 'utf8')
    assert.match(html, /src="\.\/assets\/index-abc123\.js"/, '绝对路径会让 /app/ 子路径部署 404')
    assert.match(html, /href="\.\/assets\/index-def456\.css"/)

    assert.equal(run('--check').status, 0, '刚铺完应该直接通过')

    // 重新构建 H5（文件名哈希变了）但忘了重跑脚本：--check 必须抦住
    writeFileSync(join(webDir, 'assets', 'index-zzz999.js'), 'console.log(2)')
    const stale = run('--check')
    assert.equal(stale.status, 1, '预缓存清单过期却当成 OK，上线后就是断网白屏')
    assert.match(stale.stdout, /预缓存清单过期/)

    // 重跑一次就恢复正常
    assert.equal(run().status, 0)
    assert.equal(run('--check').status, 0)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})
