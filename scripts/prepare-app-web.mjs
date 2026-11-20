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
 *   node pilot/scripts/prepare-app-web.mjs              # 默认写 pilot/app/unpackage/dist/build/web
 *   node pilot/scripts/prepare-app-web.mjs --check      # 只检查，不写文件
 *   node pilot/scripts/prepare-app-web.mjs --dir <路径>  # 指向别的构建目录
 *
 * 退出码：0 = 产物已就绪（--check 时表示现状合格）；1 = 缺少文件或不一致；
 *         2 = 用法错误（目录不存在等）。
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 本脚本同时活在两种布局里：
 *   主仓库 pilot/scripts/          → 手机端在 pilot/app，产物在 pilot/app/unpackage/...
 *   独立仓库 pilot-link/scripts/  → 仓库根就是手机端，产物在仓库根的 unpackage/...
 * 写死 `ROOT/app` 在独立仓库里会拼成 <repo>/app/pwa/...，CI 里表现为一句
 * “源文件缺失”，而不是“路径算错”。用根上有没有 manifest.json 判定。
 */
const standalone = !existsSync(join(ROOT, 'app', 'manifest.json')) && existsSync(join(ROOT, 'manifest.json'))
const APP_DIR = standalone ? ROOT : join(ROOT, 'app')
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

/** 把模板里的 `const ASSET_PRECACHE = []` 换成真实清单。 */
function renderServiceWorker(template, files) {
  const start = template.indexOf(PRECACHE_MARKER)
  if (start < 0) fail('pwa/sw.js 缺少 ASSET_PRECACHE 声明，无法注入预缓存清单')
  const from = start + PRECACHE_MARKER.length
  const open = template.indexOf('[', from)
  let depth = 0
  let end = -1
  for (let index = open; index < template.length; index += 1) {
    if (template[index] === '[') depth += 1
    else if (template[index] === ']') {
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
  return template.slice(0, from) + list + template.slice(end)
}

/** 构建产物的 index.html 用绝对路径引用 /assets/、/static/，挂到 /app/ 就全 404。 */
const ABSOLUTE_ASSET = /(\s(?:href|src)=")\/(assets|static)\//g

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

// 1. 壳文件就位（--check 时只验证，不复制）；sw.js 还要注入预缓存清单
for (const name of SHELL_FILES) {
  const target = join(webDir, name)
  const source =
    name === 'sw.js'
      ? renderServiceWorker(readFileSync(join(PWA_DIR, name), 'utf8'), precache)
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
if (relativeHtml !== html) {
  if (checkOnly) {
    problems.push('index.html 里还有绝对路径 /assets/ 或 /static/，挂到 /app/ 会 404')
  } else {
    writeFileSync(indexPath, relativeHtml)
  }
}

// 4. manifest 里声明的图标必须都在产物里
const manifest = JSON.parse(readFileSync(join(PWA_DIR, 'manifest.webmanifest'), 'utf8'))
for (const icon of manifest.icons || []) {
  const rel = String(icon.src || '').replace(/^\.\//, '')
  if (!rel) {
    problems.push('manifest 里有图标没写 src')
    continue
  }
  const file = join(webDir, rel)
  if (!existsSync(file)) {
    problems.push(`manifest 图标不存在：${rel}（先跑 node pilot/app/scripts/gen-icons.mjs）`)
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
