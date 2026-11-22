/*
 * Pilot Link 的 Service Worker。
 *
 * 目标只有两个，别越界：
 *   1. 装到主屏后断网/弱网还能打开壳子和上次加载过的资源；
 *   2. 新版本上线时自己换代，不把用户卡在旧代码上。
 *
 * 手机与电脑之间的数据全部走 WebSocket 中继（客户端已做端到端加密），
 * 没有任何 HTTP 接口，所以这里只缓存同源的静态资源，绝不碰业务数据。
 *
 * 注意：这份文件是模板，不能直接拷到构建产物里用。prepare-app-web.mjs 会
 * ① 把下面的 ASSET_PRECACHE 换成真实资源清单，② 在 VERSION 末尾追加构建内容指纹。
 * 指纹不能省：缓存名不变时「删除旧缓存」只会删别人的缓存，自己那份会一版版堆下去。
 */

/** 基础前缀；构建时被改写成 `pilot-link-pwa-v2-<8 位内容指纹>`。 */
const VERSION = 'pilot-link-pwa-v2'
/** 本版本指纹。页面 index.html 的 <meta name="pilot-build"> 与之对账。 */
const BUILD = VERSION.replace(/^pilot-link-pwa-v2-?/, '')
/** Cache Storage 是整站共享的：只清自己家的缓存，别动同源其它应用的。 */
const CACHE_PREFIX = 'pilot-link-pwa-v2'
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
      // 也不走 HTTP 缓存：Safari 的条件请求会拿到没有响应体的 304。
      const put = (cache, url) =>
        cache.add(new Request(url, { cache: 'no-store' })).catch(() => {})
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
      await self.clients.claim()
      /*
       * 这里故意不删上一代缓存。
       *
       * 换代的瞬间页面上可能还跑着上一代的 index.html（从主屏冷启动时网络还没
       * 就绪，导航会退回缓存里的旧 HTML）。旧缓存一删，那份 HTML 引用的
       * assets/index-<旧哈希>.js 在服务器上已经不存在，页面就永远停在白屏。
       * 清理交给页面：它确认自己加载的正是本版本构建后发 pilot-page-ready，
       * 那时才 pruneCaches()。
       */
    })()
  )
})

self.addEventListener('message', (event) => {
  const data = event.data || {}
  if (!data || data.type !== 'pilot-page-ready') return
  // 页面加载的是旧构建（meta 指纹对不上）时不能清缓存，否则又断链。
  // 指纹为空说明产物没被 prepare-app-web.mjs 注入过，同样不做任何清理。
  if (!BUILD || data.build !== BUILD) return
  event.waitUntil(pruneCaches())
})

/** 页面已经跑在本版本上，上一代的缓存可以安全回收。 */
async function pruneCaches() {
  const keys = await caches.keys()
  await Promise.all(
    keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && !key.startsWith(VERSION))
      .map((key) => caches.delete(key))
  )
}

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

/**
 * 取一份不走 HTTP 缓存、也不带条件头的请求。
 *
 * Safari（iOS 与微信 WKWebView 同一内核）在 SW 里发导航请求时会带上 HTTP 缓存里的
 * If-None-Match，服务器回 304；304 没有响应体，拿来当导航响应就是一个纯白页。
 * 桌面 Chromium 会先把 304 与 HTTP 缓存合并再交给 SW，所以只在 iPhone 上出现。
 *
 * 线上日志实测：iPhone 刷新时 `GET /app/` 的 referer 是 sw.js，状态码 304、字节 0。
 */
function freshRequest(request) {
  const url = new URL(request.url)
  url.hash = ''
  const headers = new Headers(request.headers || {})
  headers.delete('if-none-match')
  headers.delete('if-modified-since')
  headers.delete('if-range')
  return new Request(url.toString(), {
    method: 'GET',
    headers,
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'follow'
  })
}

/** 拿一份完整响应；失败返回 null（由调用方决定退回缓存还是兜底页）。 */
async function fetchFresh(request) {
  let fresh = null
  try {
    fresh = freshRequest(request)
  } catch (error) {
    fresh = null
  }
  try {
    return await fetch(fresh || request, { cache: 'no-store' })
  } catch (error) {
    return null
  }
}

/** 首屏：先走网络拿新版本，失败再退回缓存（弱网下返回上一次的壳）。 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const response = await fetchFresh(request)
  // 不把 304 / 5xx 当页面交出去；也不因“曾经重定向”就丢弃正常响应。
  if (response && response.ok) {
    // 存不进缓存（配额 / Vary / 私有响应）不能连累这次渲染。
    try {
      await cache.put(request, response.clone())
    } catch (error) {}
    return response
  }
  // 304 / 5xx / 断网：都不能渲染页面，退回缓存里的壳。
  const cached = (await cache.match(request)) || (await cache.match('./'))
  if (cached) return cached
  // 连壳都没有（首访就撞上 304）：给一页会自己重试的提示，而不是空白。
  return offlinePage()
}

/** 构建产物带内容哈希，命中缓存就直接用，省一次流量。 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetchFresh(request)
  if (response && response.ok && response.type === 'basic') {
    try {
      await cache.put(request, response.clone())
    } catch (error) {}
    return response
  }
  // 非 2xx（含没有响应体的 304）给脚本 / 样式，等于加载失败。
  return Response.error()
}

/** 兜底页：断网又没有缓存时自己重试，而不是交给浏览器显示空白。 */
function offlinePage() {
  const html =
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Pilot Link</title><style>' +
    'html,body{margin:0;height:100%;background:#131417;color:#e8e9ec;' +
    'font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
    'main{display:flex;height:100%;flex-direction:column;align-items:center;' +
    'justify-content:center;gap:10px;padding:24px;text-align:center}' +
    'a{color:#5b9dff;text-decoration:none}' +
    '</style></head><body><main><strong>Pilot Link 暂时离线</strong>' +
    '<span>正在重新连接，页面会自动重试。</span>' +
    '<span><a href="./" id="retry">立即重试</a></span></main>' +
    '<script>var n=0;function go(){if(n++>8)return;setTimeout(function(){' +
    'location.replace(location.pathname+location.hash)},2500)}' +
    'document.getElementById("retry").addEventListener("click",function(e){' +
    'e.preventDefault();location.reload()});go()<' +
    '/script></body></html>'
  return new Response(html, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  })
}
