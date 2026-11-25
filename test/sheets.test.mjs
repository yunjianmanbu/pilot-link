import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

const {
  formatTimeOfDay,
  normalizeTimeOfDay,
  parseTimeOfDay
} = await import('../lib/time-of-day.js')

test('页面不再使用系统原生 picker', () => {
  for (const page of ['pages/chat/index.vue', 'pages/settings/index.vue']) {
    const source = read(page)
    assert.ok(!source.includes('<picker'), `${page} 仍在用原生 picker`)
    assert.ok(!source.includes('</picker>'), `${page} 仍在用原生 picker`)
  }
})

test('聊天页用自定义底部弹层替换模式与时间选择', () => {
  const source = read('pages/chat/index.vue')
  assert.ok(source.includes('<app-picker'), '聊天页缺少 app-picker')
  assert.ok(source.includes('<app-time-sheet'), '聊天页缺少 app-time-sheet')
  assert.ok(source.includes('@select="onModePick"'), '模式选择未接自定义选择器')
  assert.ok(source.includes('@confirm="onScheduleTime"'), '时间选择未接自定义时间弹层')
  assert.ok(source.includes("modeSheetOpen = false"), '模式弹层未绑定关闭事件')
  assert.ok(source.includes("scheduleTimeOpen = false"), '时间弹层未绑定关闭事件')
})

test('设置页用自定义底部弹层替换模型选择', () => {
  const source = read('pages/settings/index.vue')
  assert.ok(source.includes('<app-picker'), '设置页缺少 app-picker')
  assert.ok(source.includes('@select="onModelPicked"'), '模型选择未接自定义选择器')
  assert.ok(source.includes('openSessionModelPicker'), '会话模型入口缺失')
  assert.ok(source.includes('openEvaluationPicker'), '评估模型入口缺失')
  assert.ok(source.includes("modelPickerKind = 'session'"), '会话模型选择未区分类型')
  assert.ok(source.includes("modelPickerKind = 'evaluation'"), '评估模型选择未区分类型')
})

test('设置页模型弹框的标题与选项是 computed，不把方法本身传给弹框', () => {
  const source = read('pages/settings/index.vue')
  const computedAt = source.indexOf('computed: {')
  const methodsAt = source.indexOf('methods: {')
  assert.ok(computedAt >= 0 && methodsAt > computedAt, '设置页缺少 computed/methods 结构')
  for (const name of [
    'modelPickerTitle',
    'modelPickerSubtitle',
    'modelPickerOptions',
    'modelPickerIndex',
    'modelPickerEmptyText'
  ]) {
    const at = source.indexOf(`    ${name}() {`)
    assert.ok(at >= 0, `${name} 缺失`)
    assert.ok(
      at > computedAt && at < methodsAt,
      `${name} 必须写在 computed 中；写成 method 会把绑定的函数传进弹框，显示 function () { [native code] }`
    )
    assert.ok(source.includes(`="${name}"`), `${name} 在模板中应按属性方式绑定`)
  }
})

test('自定义弹层复用 app-sheet 以保留主题与安全区', () => {
  const picker = read('components/app-picker/app-picker.vue')
  assert.ok(picker.includes('<app-sheet'), 'app-picker 未基于 app-sheet')
  assert.ok(picker.includes("import AppSheet from '../app-sheet/app-sheet.vue'"))
  assert.ok(picker.includes('scroll-y'), '选项列表需要可滚动')
  assert.ok(picker.includes('暂无可选项'), '空列表需要占位文案')

  const timeSheet = read('components/app-time-sheet/app-time-sheet.vue')
  assert.ok(timeSheet.includes('<app-sheet'), 'app-time-sheet 未基于 app-sheet')
  assert.ok(timeSheet.includes("import AppSheet from '../app-sheet/app-sheet.vue'"))
  assert.ok(timeSheet.includes('scroll-into-view'), '时间列打开时应定位到当前值')
  assert.ok(timeSheet.includes('time-sheet-btn main'), '时间弹层缺少确认按钮样式')
})

test('时间解析接受常见的 HH:mm 写法', () => {
  assert.deepEqual(parseTimeOfDay('09:05'), { hour: 9, minute: 5 })
  assert.deepEqual(parseTimeOfDay(' 23:59 '), { hour: 23, minute: 59 })
  assert.deepEqual(parseTimeOfDay('7:00'), { hour: 7, minute: 0 })
  assert.equal(parseTimeOfDay('24:00'), null)
  assert.equal(parseTimeOfDay('12:60'), null)
  assert.equal(parseTimeOfDay('12'), null)
  assert.equal(parseTimeOfDay('ab:cd'), null)
  assert.equal(parseTimeOfDay(''), null)
  assert.equal(parseTimeOfDay(null), null)
})

test('时间格式化补齐两位并夹在合法范围内', () => {
  assert.equal(formatTimeOfDay(9, 5), '09:05')
  assert.equal(formatTimeOfDay(0, 0), '00:00')
  assert.equal(formatTimeOfDay(23, 59), '23:59')
  assert.equal(formatTimeOfDay(30, 90), '23:59')
  assert.equal(formatTimeOfDay(-1, -1), '00:00')
  assert.equal(formatTimeOfDay('8', '7'), '08:07')
})

test('非法时间回退到默认值', () => {
  assert.equal(normalizeTimeOfDay('08:30'), '08:30')
  assert.equal(normalizeTimeOfDay('08:30', '07:00'), '08:30')
  assert.equal(normalizeTimeOfDay('bad', '07:15'), '07:15')
  assert.equal(normalizeTimeOfDay('bad', 'bad'), '09:00')
  assert.equal(normalizeTimeOfDay('', ''), '09:00')
})

test('遮罩只在遮罩上按下过才关闭弹层', () => {
  const sheet = read('components/app-sheet/app-sheet.vue')
  // 打开入口按钮上抬手后系统补发的合成 click 会落到刚出现的遮罩上，
  // 只看 click 会把弹层一起关掉：必须自己按下过遮罩才算用户想关闭。
  assert.ok(sheet.includes('@touchstart="onMaskPress"'), '遮罩缺少 touchstart 记录')
  assert.ok(sheet.includes('@mousedown="onMaskPress"'), '遮罩缺少 mousedown 记录')
  assert.ok(sheet.includes('onMaskPress()'), '缺少 onMaskPress 实现')
  assert.ok(sheet.includes('pressedAt < this.openedAt'), 'onMaskClick 未区分手势来源')
  // 兜底的 isTrusted 分支会把 click-through 重新放回来：遮罩必须自己承接按下事件。
  assert.ok(!sheet.includes('isTrusted'), 'onMaskClick 不应依赖 isTrusted 兜底')
  assert.ok(sheet.includes('@touchstart.stop'), '弹层本体未阻断 touchstart 冒泡')
})

test('全部任务与全部分待办走同一条链路', () => {
  const page = read('pages/sessions/index.vue')
  assert.ok(page.includes('mergeScheduledResult'), '弹层未使用合并结果')
  assert.ok(
    !page.includes('this.scheduleSheetRows = Array.isArray(result?.groups)'),
    '弹层仍直接覆盖为空列表'
  )
  // 入口与「全部待办」同排同款且常驻显示：不再靠「有任务才出现」的顶部汇总条。
  assert.ok(
    page.includes('class="todo-entry sched-entry" @click="openScheduleSheet"'),
    '定时任务入口未做成与全部待办同款的按钮'
  )
  assert.ok(!page.includes('sched-summary'), '旧汇总条未移除，入口重复')
  // 弹层行结构与待办共用同一套 class，改一处两边一起变。
  for (const cls of ['todo-sheet-group', 'todo-sheet-head', 'todo-sheet-item', 'todo-sheet-dot']) {
    assert.ok(page.includes(`class="${cls}"`), `弹层未复用 ${cls}`)
  }
  assert.ok(page.includes("t('共 {v1} 条定时任务'"), '副标题未与「共 N 条待办」对齐')
  const store = read('store/index.js')
  assert.ok(store.includes('SCHEDULED_ALL_STALE'), 'store 未区分「读取作废」')
  assert.ok(
    /groups: store\.scheduledAllGroups\.slice\(\), offline: true/.test(store),
    '离线时未沿用上一次的分组'
  )
  // 数据链路：逐会话 schedules.list 是主路径（旧电脑端也支持），listAll 只作补齐。
  assert.ok(
    store.includes("request('schedules.list', { sessionId: session.id })"),
    '未按会话逐个读取定时任务'
  )
  const loadStart = store.indexOf('export async function loadAllScheduled')
  assert.notEqual(loadStart, -1, '缺少 loadAllScheduled')
  const loadBody = store.slice(loadStart, store.indexOf('\n}\n', loadStart))
  assert.ok(
    loadBody.indexOf('await requestAllScheduledQuietly(token)') >
      loadBody.indexOf("request('schedules.list', { sessionId: session.id })"),
    'listAll 排在了逐会话读取之前，旧电脑端仍会读空'
  )
  assert.ok(
    store.includes('merged.set(sessionId'),
    'listAll 的分组没有与逐会话结果合并'
  )
  const quietStart = store.indexOf('async function requestAllScheduledQuietly')
  assert.notEqual(quietStart, -1, 'listAll 补充分组未封装成可选函数')
  const quiet = store.slice(quietStart, store.indexOf('\n}\n', quietStart))
  assert.ok(quiet.includes("request('schedules.listAll')"), 'listAll 可选函数没有调用 listAll')
  assert.ok(quiet.includes('catch'), 'listAll 失败时未静默降级')
  assert.ok(
    store.includes('if (!answered && !finalGroups.length)'),
    '全部读取都失败时会拿空结果覆盖缓存'
  )
  assert.ok(store.includes('failed: true'), '未把「这次没读到」告诉页面')
  // 页面要把「没读到」与「没有任务」分开，并且像「全部待办」那样先给缓存。
  assert.ok(page.includes('scheduleSheetFailed'), '页面未区分「没读到」与「没有任务」')
  assert.ok(
    page.includes('this.scheduleSheetRows = (store.scheduledAllGroups || []).slice()'),
    '打开弹层未先铺缓存'
  )
})
