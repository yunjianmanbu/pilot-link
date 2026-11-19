/*
 * Pilot Link 的 Service Worker。
 *
 * 目标只有两个，别越界：
 *   1. 装到主屏后断网/弱网还能打开壳子和上次加载过的资源；
 *   2. 新版本上线时自己换代，不把用户卡在旧代码上。
 *
 * 手机与电脑之间的数据全部走 WebSocket 中继（客户端已做端到端加密），
 * 没有任何 HTTP 接口，所以这里只缓存同源的静态资源，绝不碰业务数据。
 */

const VERSION = 'pilot-link-pwa-v2'
const SHELL_CACHE = `${VERSION}-shell`
const ASSET_CACHE = `${VERSION}-assets`
/** 断网时至少能回到首屏；路径相对 sw.js 自身，线上是 /app/ 也能用。 */
const SHELL_ASSETS = ['./', './manifest.webmanifest']

/**
 * 构建产物的预缓存清单，由 scripts/prepare-app-web.mjs 铺文件时替换成真实文件名。
 *
 * 这一段不能省：首访时页面发出的脚本 / 样式请求早于 SW 接管，不会进缓存；
 * 清单为空就等于「装得上主屏、断网白屏」（实测 macOS Edge：断网刷新拿得到
 * index.html，拿不到 assets/index-*.js，页面一片空白）。
 *
 * @precache-assets
 */
const ASSET_PRECACHE = []

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE)
      const assets = await caches.open(ASSET_CACHE)
      // 单个资源失败（比如首装时 manifest 还没铺好）不能把整次安装拖死。
      const put = (cache, url) =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
      await Promise.all([
        ...SHELL_ASSETS.map((url) => put(shell, url)),
        ...ASSET_PRECACHE.map((url) => put(assets, url))
      ])
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }
  // 只处理本站：中继、下载站和浏览器扩展一律放行。
  if (url.origin !== self.location.origin) return
  if (url.pathname.endsWith('/sw.js')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE))
    return
  }
  if (isStatik(url, request)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE))
  }
})

/** 哪些请求值得缓存：uni-app 的 /assets/* 构建产物和 /static/* 图标、字体。 */
function isStatik(url, request) {
  if (/\/(assets|static)\//.test(url.pathname)) return true
  const destination = request.destination
  return (
    destination === 'script' ||
    destination === 'style' ||
    destination === 'image' ||
    destination === 'font' ||
    destination === 'manifest'
  )
}

/** 首屏：先走网络拿新版本，失败再退回缓存（弱网下返回上一次的壳）。 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response && response.ok) await cache.put(request, response.clone())
    return response
  } catch (error) {
    const cached = (await cache.match(request)) || (await cache.match('./'))
    if (cached) return cached
    throw error
  }
}

/** 构建产物带内容哈希，命中缓存就直接用，省一次流量。 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response && response.ok && response.type === 'basic') {
    await cache.put(request, response.clone())
  }
  return response
}
