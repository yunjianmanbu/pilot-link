import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

const sessions = read('pages/sessions/index.vue')

test('项目名称右侧有右对齐的加号，点击在该项目里新建任务', () => {
  const head = sessions.slice(sessions.indexOf('class="project-head"'))
  const block = head.slice(0, head.indexOf('</view>', head.indexOf('project-add')))
  assert.ok(block.includes('class="project-add"'), '项目头缺少加号按钮')
  assert.ok(block.includes('@click.stop="newTaskInGroup(group)"'), '加号没有绑定新建任务')
  assert.ok(block.includes('＋'), '加号需要显示 + 图标')
  // 加号在项目名和数量之后，由 margin-left: auto 推到最右侧。
  assert.ok(block.indexOf('project-name') < block.indexOf('project-add'))
  const cssStart = sessions.indexOf('.project-add {')
  assert.notEqual(cssStart, -1, '缺少 .project-add 样式')
  const css = sessions.slice(cssStart, sessions.indexOf('}', cssStart))
  assert.match(css, /margin-left:\s*auto/)
})

test('「进行中」后面有「待办」入口，弹层按任务汇总待办', () => {
  const barStart = sessions.indexOf('class="filter-bar"')
  const bar = sessions.slice(barStart, sessions.indexOf('</view>', sessions.indexOf('filter-menu', barStart)))
  const running = bar.indexOf('class="running-toggle"')
  const entry = bar.indexOf('class="todo-entry"')
  assert.notEqual(entry, -1, '筛选栏缺少待办按钮')
  assert.ok(running >= 0 && entry > running, '待办应排在「进行中」后面')
  assert.ok(bar.includes('@click="openTodoSheet"'), '待办没有绑定打开弹层')
  assert.ok(bar.includes("t('待办')"), '待办按钮缺少文案')
  assert.ok(bar.includes('totalTodoCount'), '待办按钮没有显示总数')

  assert.ok(sessions.includes(':visible="todoSheetVisible"'), '缺少待办弹层')
  assert.ok(sessions.includes('class="todo-sheet-list"'), '弹层缺少待办列表')
  assert.ok(sessions.includes("t('共 {v1} 条待办', { v1: total })"), '弹层缺少待办数量')
  assert.ok(sessions.includes('todoSheetSubtitle'), '弹层缺少副标题')
  assert.ok(sessions.includes('@click="openTodoSession(group)"'), '点任务行应进入该会话')
  assert.ok(sessions.includes("item?.status === 'pending' && item.text"), '弹层只应展示未发送的待办')

  const groupsStart = sessions.indexOf('todoSheetGroups() {')
  assert.notEqual(groupsStart, -1, '缺少 todoSheetGroups')
  const groups = sessions.slice(groupsStart, sessions.indexOf('\n    },', groupsStart))
  assert.ok(groups.includes("t('未命名会话')"), '没有标题的会话应有兜底文案')
  assert.ok(groups.includes('projectName(session)'), '任务组应显示所属项目')

  const cssStart = sessions.indexOf('.todo-entry {')
  assert.notEqual(cssStart, -1, '缺少 .todo-entry 样式')
  const css = sessions.slice(cssStart, sessions.indexOf('}', cssStart))
  assert.match(css, /flex-shrink:\s*0/)
})

test('顶部四个入口压在同一行，进行中用颜色点而不是勾选框', () => {
  const barStart = sessions.indexOf('class="filter-bar"')
  const bar = sessions.slice(barStart, sessions.indexOf('filter-menu', barStart))
  // 项目筛选 / 进行中 / 待办 / 任务 都在 filter-row 里，否则窄屏会折成两行。
  assert.ok(bar.includes('class="filter-row"'), '筛选栏缺少单行容器 .filter-row')
  assert.ok(bar.indexOf('class="filter-trigger"') > bar.indexOf('class="filter-row"'))
  assert.ok(bar.indexOf('class="todo-entry sched-entry"') > bar.indexOf('class="filter-row"'))
  assert.ok(bar.includes("t('任务')"), '任务入口缺少文案')
  assert.ok(!bar.includes("t('全部任务')"), '首页入口应叫「任务」，不再带「全部」')
  assert.ok(!bar.includes("t('全部待办')"), '首页入口应叫「待办」，不再带「全部」')

  const rowCss = sessions.slice(sessions.indexOf('.filter-row {'), sessions.indexOf('}', sessions.indexOf('.filter-row {')))
  assert.match(rowCss, /flex-wrap:\s*nowrap/, '单行容器必须 nowrap，否则窄屏仍会折行')

  // 进行中：与电脑端侧栏「执行中」一致的彩色圆点。
  assert.ok(bar.includes('class="running-dot"'), '进行中缺少颜色点 .running-dot')
  assert.ok(!bar.includes('running-check'), '旧的勾选框应已删除')
  const dotCss = sessions.slice(sessions.indexOf('.running-dot {'), sessions.indexOf('}', sessions.indexOf('.running-dot {')))
  assert.match(dotCss, /border-radius:\s*50%/, '进行中的点应是圆点')
  assert.ok(
    sessions.indexOf('.running-dot.live {') > 0 &&
      /background:\s*var\(--ok\)/.test(
        sessions.slice(
          sessions.indexOf('.running-dot.live {'),
          sessions.indexOf('}', sessions.indexOf('.running-dot.live {'))
        )
      ),
    '有进行中的会话时圆点应变绿'
  )
})

test('全部待办读取不打断当前会话的待办面板', () => {
  const store = read('store/index.js')
  const start = store.indexOf('export async function loadPendingTodosBySession()')
  assert.notEqual(start, -1, '缺少 loadPendingTodosBySession')
  const body = store.slice(start, store.indexOf('\nexport async function syncOfflineTodos', start))
  assert.ok(body.includes("request('todos.list', { sessionId })"), '应逐个会话向电脑端读取待办')
  assert.ok(body.includes('loadTodosCache('), '离线时应先显示本地缓存')
  assert.ok(body.includes('mergeTodoRows('), '应合并手机上未同步的离线待办')
  assert.ok(body.includes('saveTodosCache('), '读取成功后应更新本地缓存')
  assert.ok(body.includes('todosOnline()'), '联网时才向电脑端请求')
  // 首页汇总只更新角标，不能覆盖对话页正在编辑的 store.todos。
  assert.doesNotMatch(body, /store\.todos\s*=/)
})

test('分组记录 cwd，老会话没有目录时退回通用选择器', () => {
  assert.ok(sessions.includes('cwd: String(session.cwd || \'\')'), '分组没有记录 cwd')
  assert.ok(
    sessions.includes('if (!group.cwd && session.cwd) group.cwd = String(session.cwd)'),
    '同组后续会话的 cwd 没有回填'
  )
  const start = sessions.indexOf('newTaskInGroup(group) {')
  assert.notEqual(start, -1, '缺少 newTaskInGroup')
  const body = sessions.slice(start, sessions.indexOf('\n    },', start))
  assert.match(body, /请先连接电脑/, '离线时应提示先连接电脑')
  assert.match(body, /startNewChat\(workdir\)/, '应在项目目录里开始新任务')
  assert.match(body, /pages\/chat\/index\?new=1/, '应跳转到新任务页')
  assert.match(body, /void this\.newChat\(\)/, '没有目录时应退回通用选择器')
})

test('完成但还没点开的会话在列表里一眼可见：左侧竖条 + 实色徽标', () => {
  assert.ok(
    sessions.includes("unread: Boolean(unreadFor(session.id))"),
    '会话行没有按未查看状态加类名'
  )
  assert.ok(
    sessions.includes("'unread-failed': unreadFor(session.id) === 'failed'"),
    '失败状态没有单独的类名'
  )
  const rowStart = sessions.indexOf('.session.unread {')
  assert.notEqual(rowStart, -1, '缺少 .session.unread 样式')
  const row = sessions.slice(rowStart, sessions.indexOf('}', rowStart))
  assert.match(row, /border-left:\s*6rpx solid var\(--resume\)/, '未查看行缺少左侧高亮条')
  assert.match(row, /background:/, '未查看行缺少淡底')
  const boldStart = sessions.indexOf('.session.unread .session-title {')
  assert.notEqual(boldStart, -1, '未查看行的标题没有加粗')
  assert.match(sessions.slice(boldStart, sessions.indexOf('}', boldStart)), /font-weight:\s*600/)

  // 徽标从浅色小字改成实色底 + 圆点，标题里的「待查看」说清下一步动作。
  const badge = sessions.slice(sessions.indexOf('class="badge unread-badge"'))
  assert.ok(badge.includes('class="unread-dot"'), '徽标缺少圆点')
  assert.ok(badge.includes("t('已完成待查看')"), '完成态缺少「已完成待查看」文案')
  assert.ok(badge.includes("t('失败待查看')"), '失败态缺少「失败待查看」文案')
  const doneStart = sessions.indexOf('.done-badge {')
  const done = sessions.slice(doneStart, sessions.indexOf('}', doneStart))
  assert.match(done, /background:\s*var\(--resume\)/, '完成徽标应是实色底')
  const failedStart = sessions.indexOf('.failed-badge {')
  const failed = sessions.slice(failedStart, sessions.indexOf('}', failedStart))
  assert.match(failed, /background:\s*var\(--stop\)/, '失败徽标应是实色底')
})

test('列表上方的未查看汇总条显示数量，点一下直达最近一条', () => {
  const summaryStart = sessions.indexOf('class="unread-summary"')
  assert.notEqual(summaryStart, -1, '缺少未查看汇总条')
  const summary = sessions.slice(sessions.lastIndexOf('<view', summaryStart), sessions.indexOf('>', summaryStart))
  assert.ok(summary.includes('v-if="unreadTotal > 0"'), '没有未查看任务时不应显示汇总条')
  assert.ok(summary.includes('@click="openLatestUnread"'), '汇总条没有绑定直达操作')

  const entriesStart = sessions.indexOf('unreadEntries() {')
  assert.notEqual(entriesStart, -1, '缺少 unreadEntries')
  const entries = sessions.slice(entriesStart, sessions.indexOf('\n    },', entriesStart))
  // 只认当前列表里还存在的会话，按结束时间倒序：最近结束的排第一。
  assert.ok(entries.includes('store.sessions.some('), '未过滤已删除的会话')
  assert.match(entries, /sort\(\(a, b\) => \(Number\(map\[b\]\?\.at\) \|\| 0\)/)

  const openStart = sessions.indexOf('openLatestUnread() {')
  assert.notEqual(openStart, -1, '缺少 openLatestUnread')
  const open = sessions.slice(openStart, sessions.indexOf('\n    },', openStart))
  assert.ok(open.includes('this.unreadEntries[0]'), '应打开最近结束的未查看会话')
  assert.ok(open.includes('this.open(session)'), '应复用 open 进入会话')
  assert.ok(open.includes('this.refresh()'), '会话不在列表时应退回刷新')

  const textStart = sessions.indexOf('unreadSummaryText() {')
  assert.notEqual(textStart, -1, '缺少 unreadSummaryText')
  const text = sessions.slice(textStart, sessions.indexOf('\n    },', textStart))
  assert.ok(text.includes("t('{v1} 个任务已完成，点开查看'"), '缺少完成数量文案')
  assert.ok(text.includes("t('{v1} 个任务已结束，其中 {v2} 个失败'"), '失败数量没有单独说明')
})

test('未查看相关的英文词条与源码里的 t() 键保持一致', () => {
  const en = read('lib/locale-en.js')
  assert.ok(en.includes('"已完成待查看": "Done, not opened"'), '英文词典缺少「已完成待查看」')
  assert.ok(en.includes('"失败待查看": "Failed, not opened"'), '英文词典缺少「失败待查看」')
  assert.ok(
    en.includes('"{v1} 个任务已完成，点开查看"'),
    '英文词典缺少完成数量文案'
  )
  assert.ok(
    en.includes('"{v1} 个任务已结束，其中 {v2} 个失败"'),
    '英文词典缺少失败数量文案'
  )
  // 旧的两个宽泛词条已经不再使用，留着会和 i18n 的「无冗余键」检查冲突。
  assert.ok(!en.includes('"已完成": "Completed"'), '旧词条「已完成」应删除')
  assert.ok(!en.includes('"失败": "Failed"'), '旧词条「失败」应删除')
})

test('会话行同时显示运行中和排队数量，并汇总全屏排队总数', () => {
  const rowStart = sessions.indexOf('class="session-title-row"')
  assert.notEqual(rowStart, -1, '缺少会话标题行')
  const row = sessions.slice(rowStart, sessions.indexOf('</view>', rowStart))
  // 运行中不再是 v-else-if：跑着的时候也要能看到还排了几个。
  assert.ok(
    row.includes('v-if="runningFor(session.id)"'),
    '运行中徽标应独立显示，不能被排队徽标挤掉'
  )
  assert.ok(
    !row.includes('v-else-if="pendingFor(session.id)"'),
    '排队徽标不能是运行中徽标的 else 分支'
  )
  assert.ok(
    row.includes('v-if="pendingFor(session.id) > 0" class="badge queue-badge"'),
    '排队徽标缺少数量判断'
  )
  assert.ok(row.includes("t('排队{v1}', { v1: pendingFor(session.id) })"), '排队徽标缺少数量文案')

  // 顶部汇总条：只在有排队时出现，点一下切到「进行中」筛选。
  const summary = sessions.slice(
    sessions.indexOf('class="queue-summary"') - 200,
    sessions.indexOf('class="filter-bar"')
  )
  assert.ok(sessions.includes('v-if="totalQueueCount > 0" class="queue-summary"'), '没有排队任务时不应显示汇总条')
  assert.ok(summary.includes('@click="showQueued"'), '汇总条没有跳到进行中筛选')
  assert.ok(summary.includes("t('{v1} 个任务排队中'"), '汇总条缺少排队数量文案')

  const totalStart = sessions.indexOf('totalQueueCount() {')
  assert.notEqual(totalStart, -1, '缺少 totalQueueCount')
  const total = sessions.slice(totalStart, sessions.indexOf('\n    },', totalStart))
  assert.ok(total.includes('this.pendingFor(session.id)'), '排队总数没有复用 pendingFor 的口径')
})

test('会话行有文件、知识、链接、工具、记忆五个快捷入口，样式统一且点击直达对应页', () => {
  const rowStart = sessions.indexOf('class="session-links"')
  assert.notEqual(rowStart, -1, '会话行缺少快捷入口区')
  const row = sessions.slice(rowStart, sessions.indexOf('class="chevron"', rowStart))
  // @click.stop：点快捷入口不能顺带打开会话。
  assert.ok(row.includes('@click.stop="openSessionFiles(session)"'), '文件入口缺少点击绑定')
  assert.ok(row.includes('@click.stop="openSessionKnowledge(session)"'), '知识入口缺少点击绑定')
  assert.ok(row.includes('@click.stop="openSessionLinks(session)"'), '链接入口缺少点击绑定')
  assert.ok(row.includes('@click.stop="openSessionTools(session)"'), '工具入口缺少点击绑定')
  assert.ok(row.includes('@click.stop="openSessionMemory(session)"'), '记忆入口缺少点击绑定')
  assert.ok(row.includes("t('文件')"), '文件入口缺少文案')
  assert.ok(row.includes("t('知识')"), '知识入口缺少文案')
  assert.ok(row.includes("t('链接')"), '链接入口缺少文案')
  assert.ok(row.includes("t('工具')"), '工具入口缺少文案')
  assert.ok(row.includes("t('记忆')"), '记忆入口缺少文案')
  // 五个入口共用一套胶囊样式：尺寸/圆角走 .chip；记忆不能再单独一个外观。
  assert.equal(row.match(/class="chip session-link"/g)?.length, 5, '五个入口应共用同一套胶囊样式')
  const cssStart = sessions.indexOf('.session-link {')
  assert.notEqual(cssStart, -1, '缺少 .session-link 样式')
  const css = sessions.slice(cssStart, sessions.indexOf('}', cssStart))
  assert.match(css, /var\(--surface-3\)/, '入口底色没有用 --surface-3（--surface-2 贴卡片太近）')
  assert.match(css, /var\(--line\)/, '入口描边没有用 --line')
  // 顺序：文件 / 知识 / 链接 / 工具 / 记忆。
  const order = [
    'openSessionFiles',
    'openSessionKnowledge',
    'openSessionLinks',
    'openSessionTools',
    'openSessionMemory'
  ]
  const positions = order.map((name) => row.indexOf(`@click.stop="${name}(session)"`))
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(
      positions[index] > positions[index - 1],
      `${order[index]} 应排在 ${order[index - 1]} 后面`
    )
  }

  const filesStart = sessions.indexOf('    openSessionFiles(session) {')
  assert.notEqual(filesStart, -1, '缺少 openSessionFiles')
  const filesBody = sessions.slice(filesStart, sessions.indexOf('\n    },', filesStart))
  assert.ok(filesBody.includes('/pages/files/index?sessionId='), '文件入口没有带 sessionId 跳转')
  // 只是看一眼文件，不该顺手把当前会话切走。
  assert.ok(!filesBody.includes('selectSession('), '文件入口不应切换当前会话')

  const knowledgeStart = sessions.indexOf('    openSessionKnowledge(session) {')
  assert.notEqual(knowledgeStart, -1, '缺少 openSessionKnowledge')
  const knowledgeBody = sessions.slice(
    knowledgeStart,
    sessions.indexOf('\n    },', knowledgeStart)
  )
  assert.ok(
    knowledgeBody.includes('/pages/knowledge/index?sessionId='),
    '知识入口没有带 sessionId 跳转'
  )
  assert.ok(
    !knowledgeBody.includes('selectSession('),
    '知识入口不应切换当前会话'
  )

  // 链接 / 工具 / 记忆各进独立页面，不再在合并页里切 tab。
  for (const [name, route] of [
    ['openSessionLinks', 'session-links'],
    ['openSessionTools', 'session-tools'],
    ['openSessionMemory', 'session-memory']
  ]) {
    const start = sessions.indexOf(`    ${name}(session) {`)
    assert.notEqual(start, -1, `缺少 ${name}`)
    const body = sessions.slice(start, sessions.indexOf('\n    },', start))
    assert.ok(body.includes(`/pages/${route}/index?sessionId=`), `${name} 没有进独立页面`)
    assert.ok(!body.includes('tab='), `${name} 不应再带 tab 参数`)
    assert.ok(!body.includes('selectSession('), `${name} 不应切换当前会话`)
  }
})

test('文件页优先按 URL 里的会话 id 取任务名和工作目录', () => {
  const files = read('pages/files/index.vue')
  const start = files.indexOf('const session =')
  assert.notEqual(start, -1, '缺少文件页会话解析')
  const body = files.slice(start, files.indexOf('void this.load()', start))
  assert.ok(
    body.indexOf('store.sessions.find') < body.indexOf('store.currentSession'),
    '应按 URL 的 sessionId 先找会话，再用当前会话兑底'
  )
  assert.ok(
    body.includes('store.currentSessionId === this.sessionId'),
    '用当前会话兑底时必须校验 id 一致'
  )
})
