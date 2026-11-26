/**
 * 「全部任务」页的接线测试。
 *
 * 为什么要单独钉这几条：这个入口在真机上连续三版「点了完全没反应、连新增的
 * 说明文字都不出现」，而同排的「全部待办」正常——说明点击本身和 app-sheet 都
 * 没问题，出事的只能是弹层那一侧（遮罩、动画、同页 7 个 app-sheet、高度计算）。
 * 现在入口改成跳独立页面，页面自己带版本与诊断行，读不到也有话可看。
 *
 * 单测拦住的是「接线被改回去」和「页面少了必现信息」这两类回归：
 * 这些在单测里看不见渲染效果，但缺一行就等于用户又看到一次白屏。
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

test('「全部任务」在 pages.json 里注册成独立页面', () => {
  const pages = JSON.parse(read('pages.json'))
  const paths = pages.pages.map((item) => item.path)
  assert.ok(paths.includes('pages/tasks/index'), 'pages.json 缺 pages/tasks/index')
  const entry = pages.pages.find((item) => item.path === 'pages/tasks/index')
  // 与其它自定义导航页一致：自己画顶栏，系统栏只留状态栏高度。
  assert.equal(entry.style.navigationStyle, 'custom')
})

test('首页入口跳独立页面，跳页失败退回弹层', () => {
  const source = read('pages/sessions/index.vue')
  assert.ok(source.includes('@click="openSchedulePage"'), '入口未绑定 openSchedulePage')

  const start = source.indexOf('openSchedulePage() {')
  assert.ok(start > 0, '缺 openSchedulePage 方法')
  // 取到下一个方法边界为止：这方法里带点击回执与降级，按字符数截会漏后面的行。
  const end = source.indexOf('\n    async openScheduleSheet()', start)
  const body = source.slice(start, end > start ? end : start + 2000)
  assert.ok(body.includes("url: '/pages/tasks/index'"), '跳页地址不对')
  assert.ok(body.includes('this.openScheduleSheet()'), '跳页失败没有退回弹层')
})

test('入口同时绑 touchend：真机上 click 丢失时仍能跳页', () => {
  const source = read('pages/sessions/index.vue')
  // App 端的 click 由 webview 合成，落在 scroll-view 里时曾被滚动手势吃掉；
  // touchend 在 App 端一定到，所以入口与回执行都必须绑上它，靠 tap-guard 去重。
  for (const anchor of [
    '@touchstart="noteScheduleTouch"',
    '@touchend="onScheduleTouchEnd"',
    'noteScheduleTouch(event)',
    'onScheduleTouchEnd(event)',
    'armTapGuard(600)'
  ]) {
    assert.ok(source.includes(anchor), `入口缺 ${anchor}`)
  }
  const touchend = source.indexOf('onScheduleTouchEnd(event) {')
  const nextMethod = source.indexOf('\n    openSchedulePage() {', touchend)
  assert.ok(
    source.slice(touchend, nextMethod > touchend ? nextMethod : touchend + 900).includes(
      'this.openSchedulePage()'
    ),
    'touchend 没有走到 openSchedulePage'
  )
})

test('入口下方的常驻行带当前运行版本，不点也能看到跑的是哪一版', () => {
  const source = read('pages/sessions/index.vue')
  const start = source.indexOf('scheduledTraceText() {')
  assert.ok(start > 0, '缺 scheduledTraceText')
  const body = source.slice(start, start + 700)
  assert.ok(body.includes('this.versionLabel'), '常驻行没有带版本号')
  // 字号不能再掉回脚注级：真机上正是太小才像「没有这一行」。
  const traceStyle = source.indexOf('.sched-trace-text {')
  const css = source.slice(traceStyle, traceStyle + 200)
  assert.match(css, /font-size: calc\(24rpx/, '说明行字号太小')
})

test('全部任务页自带版本与诊断行，读不到也有可见内容', () => {
  const source = read('pages/tasks/index.vue')
  for (const anchor of [
    'versionText',
    'diagText',
    'errorCaptured',
    'loadAllScheduled',
    'scheduleDiagText',
    'hydrateScheduledCache'
  ]) {
    assert.ok(source.includes(anchor), `全部任务页缺 ${anchor}`)
  }

  // 四种空态各给一条：离线 / 被抢占 / 失败 / 确实没有任务。
  for (const text of [
    '手机和电脑没连上，暂时读不到定时任务',
    '电脑端同时在处理别的读取，这次没取到定时任务',
    '电脑端暂时没返回定时任务，稍后再点一次',
    '还没有定时任务'
  ]) {
    assert.ok(source.includes(text), `全部任务页缺空态文案：${text}`)
  }
})

test('全部任务页用到的 store 导出都真的存在', () => {
  const store = read('store/index.js')
  for (const fn of [
    'loadAllScheduled',
    'hydrateScheduledCache',
    'selectSession',
    'reconnect',
    'init',
    'onAppShow'
  ]) {
    assert.ok(
      new RegExp(`export (async )?function ${fn}\\b`).test(store),
      `store 缺导出 ${fn}`
    )
  }
})

test('全部任务页与弹层共用同一套取数决策，不各写一份', () => {
  const page = read('pages/tasks/index.vue')
  assert.ok(page.includes('decideScheduleSheet('), '页面自己算决策，会与弹层走偏')
  const sheet = read('pages/sessions/index.vue')
  assert.ok(sheet.includes('scheduleDiagText'), '弹层没有用共享的诊断行')
  // 诊断行的拼装在 lib 里只有一份，页面与弹层都不该再手拼。
  const lib = read('lib/scheduled-overview.js')
  assert.ok(lib.includes('export function scheduleDiagText'), 'lib 缺 scheduleDiagText')
})
