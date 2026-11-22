/**
 * 把 PWA 的壳文件铺进 uni-app 的 H5 构建产物，并做一次装前三连检查。
 *
 * 为什么需要这一步：HBuilderX 的 H5 构建只搬运 `static/` 和打包出来的
 * `assets/`，不会把 `pwa/` 里的文件带到站点根目录；而 Service Worker 只有在
 * 站点根（或带 Service-Worker-Allowed 头）才能拿到整站作用域，放进
 * `static/` 就只能管到 `/static/`，离线壳和「添加到主屏幕」都失效。
 *
 * 除了搬文件，它还会做两件构建产物自身做不到的事：
 *   1. 把构建出来的资源清单（文件名带内容哈希）注入 sw.js，首访就整站预缓存；
 *   2. 把 index.html 里的绝对路径 /assets/、/static/ 改成相对路径，
 *      这样同一份产物挂在域名根和 /app/ 子路径下都能直接用。
 *
 * 用法（仓库根目录，H5 构建之后）：
 *   node pilot/scripts/prepare-app-web.mjs              # 默认写 pilot/pilot-link/unpackage/dist/build/web
 *   node pilot/scripts/prepare-app-web.mjs --check      # 只检查，不写文件
 *   node pilot/scripts/prepare-app-web.mjs --dir <路径>  # 指向别的构建目录
 *
 * 退出码：0 = 产物已就绪（--check 时表示现状合格）；1 = 缺少文件或不一致；
 *         2 = 用法错误（目录不存在等）。
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 本脚本同时活在两种布局里：
 *   主仓库 pilot/scripts/          → 手机端在 pilot/pilot-link，产物在 pilot/pilot-link/unpackage/...
 *   独立仓库 pilot-link/scripts/  → 仓库根就是手机端，产物在仓库根的 unpackage/...
 * 写死 `ROOT/pilot-link` 在独立仓库里会拼成 <repo>/pilot-link/pwa/...，CI 里表现为一句
 * “源文件缺失”，而不是“路径算错”。用根上有没有 manifest.json 判定。
 */
const standalone = !existsSync(join(ROOT, 'pilot-link', 'manifest.json')) && existsSync(join(ROOT, 'manifest.json'))
const APP_DIR = standalone ? ROOT : join(ROOT, 'pilot-link')
const PWA_DIR = join(APP_DIR, 'pwa')
const DEFAULT_WEB_DIR = join(APP_DIR, 'unpackage', 'dist', 'build', 'web')

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const dirIndex = args.indexOf('--dir')
const webDir = dirIndex >= 0 && args[dirIndex + 1] ? resolve(args[dirIndex + 1]) : DEFAULT_WEB_DIR

function fail(message, code = 1) {
  process.stdout.write(`[FAIL] ${message}\n`)
  process.exit(code)
}

function ok(message) {
  process.stdout.write(`[ OK ] ${message}\n`)
}

/** 需要铺到站点根目录的文件：源文件放在 pwa/ 下，名字就是要发布的路径。 */
const SHELL_FILES = ['manifest.webmanifest', 'sw.js']

/** sw.js 里被注入预缓存清单的那一行；清单由构建产物扫描得出。 */
const PRECACHE_MARKER = 'const ASSET_PRECACHE = '

/**
 * 缓存名里的版本号必须随构建内容变化，否则 activate 里的「删除旧缓存」永远命中不了
 * 自己的缓存：同名缓存每次发版只增不减，用户机器上会攒下几届构建产物。
 */
const VERSION_PATTERN = /const VERSION = '([^']+)'/

/** 预缓存清单的内容指纹：文件名本来带内容哈希，清单变了就代表产物变了。 */
function fingerprint(files) {
  return createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 8)
}

/** 参与预缓存的目录：构建出的脚本 / 样式 / 图标全在这两个下面。 */
const PRECACHE_DIRS = ['assets', 'static']

/**
 * 扫描构建目录，列出要预缓存的资源（相对 sw.js 自身，`./` 开头）。
 *
 * 首访时页面发出的脚本请求早于 SW 接管，不会自动进缓存；不预缓存就等于
 * “能装到主屏、断网白屏”。文件名带内容哈希，所以只能在构建后扫。
 */
function listPrecacheFiles(dir) {
  const files = []
  const walk = (rel) => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`
      if (entry.isDirectory()) walk(child)
      else files.push(`./${child}`)
    }
  }
  for (const name of PRECACHE_DIRS) {
    if (existsSync(join(dir, name)) && statSync(join(dir, name)).isDirectory()) walk(name)
  }
  // 排序只需要稳定：它决定了 sw.js 的字节，而 --check 是逐字节比对。
  return files.sort()
}

/** 把模板里的 `const ASSET_PRECACHE = []` 换成真实清单，并给缓存名打上内容指纹。 */
function renderServiceWorker(template, files, buildId) {
  const stamped = template.replace(VERSION_PATTERN, (line, base) => {
    // 模板里是固定前缀（pilot-link-pwa-v2）；指纹每次都从模板重算，重复注入不会累积。
    const clean = base.replace(/-[0-9a-f]{8}$/, '')
    return `const VERSION = '${clean}-${buildId}'`
  })
  if (stamped === template) fail('pwa/sw.js 缺少 const VERSION 声明，无法为缓存名打指纹')
  const start = stamped.indexOf(PRECACHE_MARKER)
  if (start < 0) fail('pwa/sw.js 缺少 ASSET_PRECACHE 声明，无法注入预缓存清单')
  const from = start + PRECACHE_MARKER.length
  const open = stamped.indexOf('[', from)
  let depth = 0
  let end = -1
  for (let index = open; index < stamped.length; index += 1) {
    if (stamped[index] === '[') depth += 1
    else if (stamped[index] === ']') {
      depth -= 1
      if (depth === 0) {
        end = index + 1
        break
      }
    }
  }
  if (open < 0 || end < 0) fail('pwa/sw.js 的 ASSET_PRECACHE 不是数组字面量')
  const list = files.length
    ? `[\n${files.map((file) => `  '${file}'`).join(',\n')}\n]`
    : '[]'
  return stamped.slice(0, from) + list + stamped.slice(end)
}

/** 构建产物的 index.html 用绝对路径引用 /assets/、/static/，挂到 /app/ 就全 404。 */
const ABSOLUTE_ASSET = /(\s(?:href|src)=")\/(assets|static)\//g

/** 首屏自愈块的包围标记；重跑本脚本时整块替换，不要往 index.html 里叠加。 */
const BOOT_GUARD_MARK = /<!--pilot-pwa-guard-->[\s\S]*?<!--\/pilot-pwa-guard-->/

/**
 * 首屏自愈：把「缓存与线上产物断链」变成一次自动恢复，而不是白屏。
 *
 * 三件事分别对应三种真实白屏：
 *   1. 脚本 / 样式 404 —— 页面跑着上一代 index.html，它引用的带哈希资源已被
 *      本次发布删掉（旧 SW 缓存删早了一步，或部署还没传完）；
 *   2. #app 一直是空 —— 资源都在但渲染挂了；
 *   3. 新 SW 接管后页面还在要旧资源 —— controllerchange 时重载一次。
 *
 * 自愈动作只是「请 SW 检查更新 + 重新加载」，**默认不注销 SW、不清 Cache Storage**：
 * 那是断网时唯一的兜底，清掉只会更白屏。连刷仍不行就渲染一页能看到原因的错误页，
 * 而不是无声白屏或无限自刷。
 *
 * 「注销 SW + 清缓存」只在两个显式入口发生：用户自己打开 /app/?reset=1，或点失败页上
 * 的「彻底重置」。这是被坏缓存卡死的机型（iOS Safari 最典型：SW 缓存里躺着半截脚本，
 * cacheFirst 永远命中，刷新一百次也还是白屏）唯一不靠开发者工具的自救路径。
 */
function renderBootGuard(buildId) {
  return `<!--pilot-pwa-guard--><meta name="pilot-build" content="${buildId}" /><script>
/* Pilot Link 首屏自愈。构建时由 scripts/prepare-app-web.mjs 注入，别手改产物。 */
(function () {
  var KEY = 'pilot-pwa-heal'
  /* 自动重载只给 1 次：再多就变成“自己把自己刷死”，正是用户感知到的“刷新也没用”。 */
  var LIMIT = 1
  /* 弱网首屏给足时间（iOS 冷启动 600KB 主包 + 几十个分包，6 秒远不够）。 */
  var SLOW_AFTER = 12000
  var meta = document.querySelector('meta[name="pilot-build"]')
  var BUILD = meta && meta.getAttribute('content')
  var busy = false
  var reloading = false

  function store(key, value) {
    try { window.sessionStorage.setItem(key, value) } catch (error) {}
  }
  function read(key) {
    try { return Number(window.sessionStorage.getItem(key) || 0) || 0 } catch (error) { return 0 }
  }

  /*
   * 彻底重置：注销本作用域的 SW + 删掉本应用的 Cache Storage，然后不带 query 重载。
   * 只应由用户显式触发（按钮或 ?reset=1）：断网时清掉缓存只剩白屏。
   */
  function hardReset() {
    var done = false
    var go = function () {
      if (done) return
      done = true
      window.location.replace(window.location.href.split('#')[0].split('?')[0])
    }
    var tasks = []
    try {
      var nav = window.navigator
      if (nav.serviceWorker && nav.serviceWorker.getRegistrations) {
        tasks.push(nav.serviceWorker.getRegistrations().then(function (list) {
          return Promise.all(list.map(function (reg) { return reg.unregister() }))
        }, function () {}))
      }
    } catch (error) {}
    try {
      if (window.caches && window.caches.keys) {
        tasks.push(window.caches.keys().then(function (names) {
          return Promise.all(names.filter(function (name) {
            return name.indexOf('pilot-link-pwa') === 0
          }).map(function (name) { return window.caches.delete(name) }))
        }, function () {}))
      }
    } catch (error) {}
    Promise.all(tasks).then(go, go)
    /* 注销 / 删除都可能因为浏览器策略卡住，兜底 2.5 秒后照样重载。 */
    window.setTimeout(go, 2500)
  }

  /* 逃生入口：打开 /app/?reset=1 就把 SW 与缓存清干净重进，不需要开发者工具。 */
  if (/[?&]reset=1(&|$)/.test(window.location.search || '')) {
    hardReset()
    return
  }

  /*
   * 真的恢复不了时，给出能看到原因的一页：绝不能再无声白屏，也不能无限自刷。
   * 标题会随原因区分「加载失败」与「加载较慢」，不让慢网用户以为坏了。
   */
  function showFallback(reason) {
    var app = document.getElementById('app')
    if (!app || app.getAttribute('data-pilot-fallback')) return
    var slow = String(reason || '').indexOf('慢') === 0
    app.setAttribute('data-pilot-fallback', reason || 'unknown')
    app.innerHTML =
      '<div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;gap:12px;padding:24px;text-align:center;box-sizing:border-box;' +
      'font:15px/1.6 system-ui,-apple-system,sans-serif;color:#e8e9ec">' +
      '<strong>' + (slow ? '加载较慢' : '页面没能加载完成') + '</strong>' +
      '<span>' + (slow ? '网络较慢，资源还在下载。可以继续等，也可以重试。' : '原因：' + (reason || '未知')) + '</span>' +
      '<span style="font-size:13px;opacity:.7">构建 ' + (BUILD || '未知') + '</span>' +
      '<button id="pilot-retry" style="padding:10px 18px;border-radius:10px;border:0;' +
      'background:#5b9dff;color:#08131f;font:inherit">重新加载</button>' +
      '<button id="pilot-reset" style="padding:10px 18px;border-radius:10px;border:1px solid #4a4d55;' +
      'background:transparent;color:#e8e9ec;font:inherit">彻底重置</button>' +
      '<span style="font-size:13px;opacity:.7">反复打不开就点「彻底重置」：清掉本机缓存后重新加载</span></div>'
    var retry = document.getElementById('pilot-retry')
    if (retry) retry.addEventListener('click', function () {
      store(KEY + '-count', '0')
      window.location.reload()
    })
    var reset = document.getElementById('pilot-reset')
    if (reset) reset.addEventListener('click', function () { hardReset() })
  }

  /*
   * 自愈分两档，因为「真的坏了」和「只是慢」必须区别对待：
   *   硬失败（脚本 / 样式加载失败）→ 让 SW 检查更新后重载 1 次，再失败就显示失败页；
   *   软迹象（#app 空但没有任何报错）→ 绝不自动重载（会把正在下载的首屏刷死），
   *   只显示一页「加载较慢 + 重试 + 彻底重置」，Vue 一旦挂载就会把它顶掉。
   */
  function heal(reason) {
    if (busy) return
    busy = true
    var count = read(KEY + '-count')
    if (count >= LIMIT) { showFallback(reason); return }
    store(KEY + '-count', String(count + 1))
    var started = read(KEY + '-at')
    if (started && Date.now() - started < 8000) return
    store(KEY + '-at', String(Date.now()))
    var reload = function () {
      if (reloading) return
      reloading = true
      window.location.reload()
    }
    var sw = window.navigator.serviceWorker
    if (sw && sw.getRegistration) {
      sw.getRegistration().then(function (reg) {
        return reg && reg.update ? reg.update().catch(function () {}) : null
      }).then(reload, reload)
      window.setTimeout(reload, 1500)
    } else reload()
  }

  /* 软迹象：不重载，只把话说清楚，给用户自己选。 */
  function showSlow(reason) {
    if (busy) return
    busy = true
    showFallback(reason)
  }

  /* 1. 脚本 / 样式没加载到：元素上的 error 不冒泡，得用捕获阶段。 */
  window.addEventListener('error', function (event) {
    var target = event.target
    if (!target || target === window) return
    var tag = (target.tagName || '').toUpperCase()
    if (tag !== 'SCRIPT' && tag !== 'LINK') return
    heal('资源加载失败：' + (target.getAttribute('src') || target.getAttribute('href') || tag))
  }, true)

  /* 2. 资源都在但没挂上：先排除“还在下载”，再把选择交给用户，不自动重载。 */
  function checkRendered(stage) {
    var app = document.getElementById('app')
    if (!app) return
    if (!(app.childElementCount === 0 && !(app.textContent || '').trim())) return
    if (document.readyState !== 'complete') return
    if (window.navigator.onLine === false) {
      showSlow('离线' + stage)
      return
    }
    showSlow('慢：首屏为空' + stage)
  }
  window.setTimeout(function () { checkRendered('') }, SLOW_AFTER)
  window.addEventListener('load', function () {
    window.setTimeout(function () { checkRendered('（load 后）') }, 3000)
  })

  /* 3. 文档本身是空的：Safari 把无响应体的 304 当页面时就是这种形态。 */
  document.addEventListener('DOMContentLoaded', function () {
    var body = document.body
    if (!body) return
    if (body.childElementCount === 0 && !(body.textContent || '').trim()) heal('文档为空')
  })

  var sw = window.navigator.serviceWorker
  if (!sw) return
  var hadController = !!sw.controller

  /* 4. 换代接管后重载一次，避免旧页面继续要已经被换掉的资源。首装接管不算换代。 */
  sw.addEventListener('controllerchange', function () {
    if (!hadController) {
      hadController = true
      return
    }
    if (reloading) return
    reloading = true
    window.location.reload()
  })

  /* 5. 页面确认自己就是本版本构建，SW 收到后才回收上一代缓存。 */
  function confirmBuild() {
    if (!BUILD || !sw.controller) return
    sw.controller.postMessage({ type: 'pilot-page-ready', build: BUILD })
  }
  if (sw.ready) sw.ready.then(confirmBuild, function () {})
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) confirmBuild()
  })
})()
</script><!--/pilot-pwa-guard-->`
}

/**
 * 把自愈块插到 charset 声明之后。
 *
 * charset 必须落在文档前 1024 字节内，否则 Safari / 微信会先按 windows-1252 解析，
 * 中文变成乱码。自愈块有两千多字节，插到 <head> 之后就把 charset 挤出了窗口。
 */
function injectBootGuard(html, buildId) {
  const block = renderBootGuard(buildId)
  if (BOOT_GUARD_MARK.test(html)) return html.replace(BOOT_GUARD_MARK, block)
  const charset = /<meta[^>]+charset[^>]*>/i.exec(html)
  if (charset) {
    const after = charset.index + charset[0].length
    return html.slice(0, after) + block + html.slice(after)
  }
  const at = html.indexOf('<head>')
  if (at < 0) return html
  const cut = at + '<head>'.length
  return html.slice(0, cut) + block + html.slice(cut)
}

if (!existsSync(webDir) || !statSync(webDir).isDirectory()) {
  fail(
    `H5 构建目录不存在：${webDir}\n` +
      '先在 HBuilderX 里「发行 → 网站-PC/手机 H5」出一次包，或用 --dir 指向已有产物。',
    2
  )
}

const indexPath = join(webDir, 'index.html')
if (!existsSync(indexPath)) {
  fail(`${indexPath} 不存在，这不像是 uni-app 的 H5 产物目录`)
}

for (const name of SHELL_FILES) {
  const source = join(PWA_DIR, name)
  if (!existsSync(source)) fail(`源文件缺失：${source}`)
}

const problems = []
const precache = listPrecacheFiles(webDir)
/**
 * 壳逻辑代次。改 pwa/sw.js 的缓存 / 自愈行为或首屏自愈块时 +1。
 *
 * 不换代的话构建指纹不变，用户机器上会继续跑旧的自愈逻辑 ——
 * 2026-11 的 iOS 白屏就是吃了这个亏（SW 字节变了，但页面认的指纹没变）。
 *
 * 3：首屏自愈块加入 ?reset=1 逃生入口与失败页的「彻底重置」。
 */
const SHELL_EPOCH = 3
const swTemplate = readFileSync(join(PWA_DIR, 'sw.js'), 'utf8')
/**
 * 首屏自愈块的形状（buildId 用占位符，正文与真实产物逐字相同）。
 *
 * 以前指纹只哈 sw.js，改了自愈块指纹不变 → SW 不换代，用户机器上继续跑旧的自愈逻辑。
 * 把这块正文也哈进来，以后改它不必再靠人记得 +SHELL_EPOCH。
 */
const guardShape = renderBootGuard('__PILOT_BUILD__')
/** 本产物指纹：sw 的缓存名后缀和 index.html 的 meta 必须同源，否则页面永远确认不了。 */
const buildId = fingerprint([
  ...precache,
  `shell:${SHELL_EPOCH}:${createHash('sha256').update(swTemplate).digest('hex').slice(0, 8)}`,
  `guard:${createHash('sha256').update(guardShape).digest('hex').slice(0, 8)}`
])

// 1. 壳文件就位（--check 时只验证，不复制）；sw.js 还要注入预缓存清单
for (const name of SHELL_FILES) {
  const target = join(webDir, name)
  const source =
    name === 'sw.js'
      ? renderServiceWorker(swTemplate, precache, buildId)
      : readFileSync(join(PWA_DIR, name), 'utf8')
  if (checkOnly) {
    if (!existsSync(target)) {
      problems.push(`${name} 不在构建目录里`)
      continue
    }
    if (readFileSync(target, 'utf8') !== source) {
      problems.push(
        name === 'sw.js'
          ? '产物里的 sw.js 与当前构建产物不一致（预缓存清单过期，重跑本脚本）'
          : `${name} 与 pwa/ 里的源文件不一致`
      )
    }
  } else {
    writeFileSync(target, source)
  }
}

// 2. index.html 必须真的指向它们，否则浏览器不会去装
const html = readFileSync(indexPath, 'utf8')
if (!/rel="manifest"/.test(html)) problems.push('index.html 缺少 <link rel="manifest">')
if (!/name="theme-color"/.test(html)) problems.push('index.html 缺少 theme-color')

// 3. 资源引用必须是相对路径，否则挂到 /app/ 子路径下整站 404
const relativeHtml = html.replace(ABSOLUTE_ASSET, '$1./$2/')
if (relativeHtml !== html && checkOnly) {
  problems.push('index.html 里还有绝对路径 /assets/ 或 /static/，挂到 /app/ 会 404')
}

// 4. 首屏自愈块必须就位，且构建指纹与本产物一致（旧指纹会让 SW 永远不敢清缓存）
if (!/<head>/i.test(relativeHtml)) {
  problems.push('index.html 没有 <head>，无法注入首屏自愈脚本')
} else {
  const guardedHtml = injectBootGuard(relativeHtml, buildId)
  const onDisk = checkOnly ? readFileSync(indexPath, 'utf8') : guardedHtml
  if (checkOnly) {
    const stamped = /name="pilot-build" content="([^"]+)"/.exec(onDisk)
    if (!stamped) problems.push('index.html 缺少首屏自愈脚本，重跑本脚本（旧客户端会卡在白屏）')
    else if (stamped[1] !== buildId) {
      problems.push(
        `index.html 的构建指纹 ${stamped[1]} 与当前产物 ${buildId} 不一致，重跑本脚本`
      )
    }
  }
  if (!checkOnly && guardedHtml !== html) writeFileSync(indexPath, guardedHtml)
}

// 5. manifest 里声明的图标必须都在产物里
const manifest = JSON.parse(readFileSync(join(PWA_DIR, 'manifest.webmanifest'), 'utf8'))
for (const icon of manifest.icons || []) {
  const rel = String(icon.src || '').replace(/^\.\//, '')
  if (!rel) {
    problems.push('manifest 里有图标没写 src')
    continue
  }
  const file = join(webDir, rel)
  if (!existsSync(file)) {
    problems.push(`manifest 图标不存在：${rel}（先跑 node pilot/pilot-link/scripts/gen-icons.mjs）`)
    continue
  }
  const match = /^(\d+)x(\d+)$/.exec(String(icon.sizes || ''))
  if (match) {
    const size = pngSize(file)
    if (!size) {
      problems.push(`manifest 图标不是 PNG：${rel}`)
    } else if (String(size.width) !== match[1] || String(size.height) !== match[2]) {
      problems.push(
        `manifest 写的尺寸 ${icon.sizes} 与 ${rel} 实际的 ${size.width}x${size.height} 不一致`
      )
    }
  }
}

/** 只读 PNG 的 IHDR，拿到宽高用来跟 manifest 的 sizes 对账。 */
function pngSize(file) {
  const head = readFileSync(file).subarray(0, 24)
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  for (let index = 0; index < signature.length; index += 1) {
    if (head[index] !== signature[index]) return null
  }
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
}

if (problems.length > 0) {
  for (const problem of problems) process.stdout.write(`[FAIL] ${problem}\n`)
  process.exit(1)
}

if (!checkOnly) {
  for (const name of SHELL_FILES) ok(`已铺到站点根目录：${name}`)
  ok(`预缓存清单：${precache.length} 个资源`)
}
ok(`${manifest.name} · display=${manifest.display} · ${(manifest.icons || []).length} 个图标`)
ok(`产物目录：${webDir}`)
if (!checkOnly) {
  process.stdout.write(
    '\n下一步：把整个目录传到 https://pilot.medpilot.cc/app/（必须 HTTPS，' +
      'Service Worker 在局域网 HTTP 下不生效）。\n'
  )
}
