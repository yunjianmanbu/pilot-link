#!/usr/bin/env node
/**
 * 用现有 uni-app 工程（pilot/pilot-link）打 H5 产物，并直接做成可安装的 PWA。
 *
 * 两步合一，缺一不可：
 *   1. HBuilderX CLI `publish web`：把 pages/ lib/ components/ 编成 dist/build/web；
 *   2. prepare-app-web.mjs：把 pwa/ 下的 manifest.webmanifest + sw.js 铺到产物根目录，
 *      注入构建产物的预缓存清单，并把 index.html 的绝对路径改成相对路径。
 * 只做第 1 步得到的是普通 H5 站点（不能装到主屏、断网白屏），只做第 2 步则
 * 产物过期。所以固定成一条命令。
 *
 * HBuilderX 安装路径不写死：按 `--cli` → `HBUILDERX_CLI` 环境变量 → 常见安装目录
 * 依次查找（Windows 的 D:\soft\HBuilderX.* / Program Files，macOS 的
 * /Applications/HBuilderX.app/Contents/MacOS/cli）找到第一个存在的。
 *
 * 用法（仓库根目录一条命令）：
 *
 *   node pilot/scripts/build-app-web.mjs           # 构建 + 铺壳文件
 *   node pilot/scripts/build-app-web.mjs --check   # 只检查现有产物是否需要重建/重新注入
 *   node pilot/scripts/build-app-web.mjs --cli "/path/to/cli"   # 显式指定 HBuilderX CLI
 *   node pilot/scripts/build-app-web.mjs --dir <产物目录>        # 别的产物目录（配合 --check）
 *
 * 退出码：0 = 产物已就绪；1 = 构建失败或产物不合格；2 = 用法/环境错误（找不到 CLI）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')

/** 脚本同时活在主仓库和 split 出来的 pilot-link 独立仓库里，按根上有没有 manifest.json 判定。 */
const standalone = !existsSync(join(REPO_ROOT, 'pilot-link', 'manifest.json')) && existsSync(join(REPO_ROOT, 'manifest.json'))
const APP_DIR = standalone ? REPO_ROOT : join(REPO_ROOT, 'pilot-link')
const APP_ID = (() => {
  try {
    return JSON.parse(readFileSync(join(APP_DIR, 'manifest.json'), 'utf8')).appid || ''
  } catch {
    return ''
  }
})()
const WEB_DIR = join(APP_DIR, 'unpackage', 'dist', 'build', 'web')
// prepare-app-web.mjs 与本脚本同目录：主仓库是 pilot/scripts/，split 仓库是 scripts/。
const PREPARE = join(SCRIPT_DIR, 'prepare-app-web.mjs')

function fail(message, code = 1) {
  process.stdout.write(`[FAIL] ${message}\n`)
  process.exit(code)
}

function ok(message) {
  process.stdout.write(`[ OK ] ${message}\n`)
}

function parseArgs(argv) {
  const options = { dir: '', cli: '', check: false, help: false, quiet: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dir') options.dir = argv[++index] ?? ''
    else if (arg === '--cli') options.cli = argv[++index] ?? ''
    else if (arg === '--check') options.check = true
    else if (arg === '--quiet') options.quiet = true
    else if (arg === '--help' || arg === '-h') options.help = true
  }
  return options
}

/** Windows 上 HBuilderX 常被装在 D:\soft\HBuilderX.<版本>\HBuilderX\cli.exe，逐个试。 */
function candidateClis() {
  const list = []
  const envCli = process.env.HBUILDERX_CLI || ''
  if (envCli) list.push(envCli)

  const suffixes =
    process.platform === 'win32'
      ? ['HBuilderX\\cli.exe', 'HBuilderX\\HBuilderX.exe']
      : ['HBuilderX.app/Contents/MacOS/cli', 'HBuilderX/cli']

  const roots = []
  if (process.platform === 'win32') {
    roots.push('C:\\Program Files\\HBuilderX', 'C:\\Program Files (x86)\\HBuilderX')
    const local = process.env.LOCALAPPDATA || ''
    if (local) roots.push(join(local, 'Programs', 'HBuilderX'))
    const programData = process.env.ProgramData || ''
    if (programData) roots.push(join(programData, 'HBuilderX'))
    // D:\soft\HBuilderX.* 这种带版本号的安装目录
    for (const drive of ['D:', 'C:', 'E:']) {
      const soft = `${drive}\\soft`
      try {
        for (const entry of readdirSync(soft)) {
          if (/^HBuilderX/i.test(entry)) roots.push(join(soft, entry))
        }
      } catch {
        // 该盘没有 soft 目录，跳过
      }
    }
  } else {
    roots.push('/Applications', '/opt/HBuilderX', join(process.env.HOME || '', 'HBuilderX'))
  }

  for (const root of roots) {
    for (const suffix of suffixes) list.push(join(root, suffix))
  }
  return list
}

function findCli(explicit) {
  if (explicit) {
    if (!existsSync(explicit)) fail(`--cli 指向的 HBuilderX 不存在：${explicit}`, 2)
    return explicit
  }
  for (const candidate of candidateClis()) {
    if (existsSync(candidate)) return candidate
  }
  return ''
}

/** 源文件是否比产物新：pages/lib/components/App.vue 等改过就该重新构建。 */
function staleSources() {
  const index = join(WEB_DIR, 'index.html')
  if (!existsSync(index)) return ['（产物目录不存在）']
  const builtAt = statSync(index).mtimeMs
  const watched = ['pages', 'lib', 'components', 'static', 'App.vue', 'main.js', 'pages.json', 'manifest.json', 'uni.scss']
  const stale = []
  const walk = (rel) => {
    const abs = join(APP_DIR, rel)
    if (!existsSync(abs)) return
    const info = statSync(abs)
    if (info.isDirectory()) {
      for (const entry of readdirSync(abs)) walk(`${rel}/${entry}`)
      return
    }
    if (info.mtimeMs > builtAt) stale.push(rel)
  }
  for (const rel of watched) walk(rel)
  return stale
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    process.stdout.write(
      'node pilot/scripts/build-app-web.mjs [--cli <HBuilderX cli>] [--dir <产物目录>] [--check]\n'
    )
    return 0
  }

  if (!APP_ID) fail(`读不到 ${join(APP_DIR, 'manifest.json')} 的 appid`, 2)
  const webDir = options.dir ? resolve(options.dir) : WEB_DIR

  if (options.check) {
    if (!existsSync(join(webDir, 'index.html'))) fail(`产物不存在：${webDir}（先跑 node pilot/scripts/build-app-web.mjs）`)
    const stale = staleSources()
    if (stale.length) {
      process.stdout.write(`[FAIL] ${stale.length} 个源文件比产物新，需要重新构建：\n`)
      for (const rel of stale.slice(0, 20)) process.stdout.write(`  ${rel}\n`)
      return 1
    }
    ok(`源文件与产物一致（${webDir}）`)
    const prepared = spawnSync(process.execPath, [PREPARE, '--check', '--dir', webDir], {
      stdio: 'inherit',
      cwd: REPO_ROOT
    })
    return prepared.status ?? 1
  }

  const cli = findCli(options.cli)
  if (!cli) {
    process.stdout.write('[FAIL] 找不到 HBuilderX CLI。用下面任一方式指定：\n')
    process.stdout.write('  --cli "<HBuilderX 安装目录>/HBuilderX/cli.exe"\n')
    process.stdout.write('  或设置环境变量 HBUILDERX_CLI\n')
    process.stdout.write('  Windows 常见位置：D:\\soft\\HBuilderX.<版本>\\HBuilderX\\cli.exe\n')
    return 2
  }

  process.stdout.write(`HBuilderX CLI: ${cli}\n`)
  process.stdout.write(`工程: ${APP_DIR}（appid ${APP_ID}）\n`)
  const build = spawnSync(
    cli,
    ['publish', 'web', '--project', APP_DIR, '--webTitle', 'Pilot Link'],
    { cwd: APP_DIR, stdio: options.quiet ? 'pipe' : 'inherit', encoding: 'utf8' }
  )
  if (build.status !== 0) {
    const detail = [build.stdout, build.stderr].filter(Boolean).join('\n').trim()
    fail(`HBuilderX 构建失败（exit ${build.status ?? 'null'}）${detail ? `\n${detail}` : ''}`)
  }
  if (!existsSync(join(webDir, 'index.html'))) {
    fail(`构建结束但没找到 ${join(webDir, 'index.html')}`)
  }
  ok('H5 构建完成')

  const prepared = spawnSync(process.execPath, [PREPARE, '--dir', webDir], {
    stdio: 'inherit',
    cwd: REPO_ROOT
  })
  if ((prepared.status ?? 1) !== 0) fail('壳文件注入失败（见上面的 [FAIL]）')
  return 0
}

process.exit(main())
