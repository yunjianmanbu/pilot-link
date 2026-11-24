import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { readClientTree } from './client-source.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

const page = read('components/module-check-panel/module-check-panel.vue')
const evolution = read('pages/evolution/index.vue')
const pages = read('pages.json')
const store = read('store/index.js')
// 电脑端把各个 case 拆到 companion/handlers/* 之后，整份协议要按目录读（含 constants.ts）。
const protocol = readClientTree('src/main/companion')
const locale = read('lib/locale-en.js')


// 拆仓后本仓库不含桌面端源码与工作区文档：读不到就跳过，而不是判失败。
const skipCross = protocol != null ? false : '独立仓库不含桌面端源码（pilot/pilot）与工作区文档（pilot/docs），跳过跨仓库一致性检查'
test('模块自检面板内嵌在进化页，不再单独注册页面', () => {
  assert.ok(!pages.includes('"pages/module-check/index"'), '自检页应已并入进化页')
  assert.ok(evolution.includes('<module-check-panel'), '进化页缺少模块自检页签')
  assert.ok(
    evolution.includes("activeTab === 'module-check'"),
    '进化页页签没有渲染模块自检面板'
  )
  assert.ok(page.includes("t('模块自检')"), '面板缺少标题')
})

test('store 的五个通道分别走电脑端协议', { skip: skipCross }, () => {
  for (const [fn, method] of [
    ['loadModuleCheckState', 'moduleCheck.state'],
    ['discoverModuleCheckModules', 'moduleCheck.discover'],
    ['runModuleCheck', 'moduleCheck.run'],
    ['saveModuleCheckSettings', 'moduleCheck.settings'],
    ['acceptModuleCheck', 'moduleCheck.accept']
  ]) {
    const start = store.indexOf(`export async function ${fn}`)
    assert.notEqual(start, -1, `缺少 ${fn}`)
    const body = store.slice(start, store.indexOf('\nexport ', start + 10))
    // The long scan call puts the method on the next line, so check the
    // protocol name rather than the exact call shape.
    assert.ok(body.includes(`'${method}'`), `${fn} 没有调用 ${method}`)
    assert.ok(body.includes('isConnected()'), `${fn} 离线时没有报错`)
  }
  // 扫描要读完整份源码，不能沿用普通请求的 60 秒超时。
  const runStart = store.indexOf('export async function runModuleCheck')
  const runBody = store.slice(runStart, store.indexOf('\nexport ', runStart + 10))
  assert.ok(runBody.includes('180_000'), '自检请求缺少更长的超时')
  const acceptStart = store.indexOf('export async function acceptModuleCheck')
  const acceptBody = store.slice(acceptStart, store.indexOf('\nexport ', acceptStart + 10))
  assert.ok(acceptBody.includes('refreshSessions(true)'), '创建修复会话后没有刷新会话列表')
})

test('自检页复用轮询、运行、定期设置和确认修复动作', () => {
  for (const call of [
    'loadModuleCheckState()',
    'discoverModuleCheckModules()',
    'runModuleCheck(',
    'saveModuleCheckSettings(',
    'acceptModuleCheck('
  ]) {
    assert.ok(page.includes(call), `自检页没有调用 ${call}`)
  }
  assert.ok(page.includes('app-picker'), '定期间隔缺少选择器')
  assert.ok(page.includes('app-dialog'), '确认修复缺少确认框')
  assert.ok(page.includes("t('全选')") && page.includes("t('清空')"), '模块缺少全选/清空')
  assert.ok(page.includes("t('立即自检')"), '缺少运行按钮')
  assert.ok(page.includes("t('定期自检')"), '缺少定期开关')
  assert.ok(page.includes("t('生成提案（{v1}）'"), '缺少生成提案按钮')
  assert.ok(page.includes("t('自改源码（{v1}）'"), '缺少自改按钮')
  // 默认只产提案：accept 必须显式带 selfModify，且缺省为 false。
  assert.ok(
    page.includes('acceptModuleCheck(this.report.id, this.picked, selfModify)'),
    '确认时没有传自改开关'
  )
  assert.ok(
    store.includes('acceptModuleCheck(reportId, riskIds, selfModify = false)'),
    '自改开关缺省值不是 false'
  )
})

test('自检页声明扫描对象是内置源码，不再看当前工作区', () => {
  // 自检固定扫 Pilot 自己的源码：文案里不能再出现「你这个工作区」这类措辞，
  // 也不再以工作区作为能否自检的前提。
  assert.ok(page.includes('Pilot 内置源码'), '自检页没有说明扫描对象是内置源码')
  assert.ok(!page.includes('这个工作区里没有发现'), '空模块提示仍在说工作区')
  assert.ok(!page.includes('尚未打开工作区。'), '仍把未打开工作区当成不能自检')
  const storeStart = store.indexOf('export async function discoverModuleCheckModules')
  const storeBody = store.slice(storeStart, store.indexOf('\nexport ', storeStart + 10))
  assert.ok(storeBody.includes("data?.source"), 'store 没有优先读 source 字段')
})

test('自检状态先显示，模块发现不挡首屏', () => {
  // loading 初值必须是 false：load() 用它防重入，初值为 true 会让首次进入
  // 页面直接返回，一直停在「读取中」。
  assert.ok(page.includes('loading: false'), 'loading 初值会让首次加载被防重入挡住')
  const loadStart = page.indexOf('async load()')
  const loadBody = page.slice(loadStart, page.indexOf('async refreshModules()', loadStart))
  assert.ok(loadBody.includes('loadModuleCheckState()'), '没有先读取自检状态')
  assert.ok(!loadBody.includes('discoverModuleCheckModules()'), '模块发现仍在挡状态读取')
  assert.ok(loadBody.includes('void this.refreshModules()'), '状态读完后没有继续发现模块')
  assert.ok(page.includes('async refreshModules()'), '缺少独立的模块发现流程')
  assert.ok(page.includes("t('正在发现模块…')"), '模块发现期间缺少提示')
  assert.ok(
    page.includes(':disabled="busy !== \'\' || !connected || discovering"'),
    '模块还没发现完就能点立即自检'
  )
})

test('疑似凭据等人工项不能被勾选', () => {
  assert.ok(
    page.includes('if (!risk?.id || risk.manual) return'),
    '人工处理项仍可勾选'
  )
  assert.ok(
    page.includes("t('该项已标记为人工处理，自检不会自动修改。')"),
    '人工处理项缺少说明'
  )
  assert.ok(
    page.includes("t('显示的条目里有 {v1} 项需要人工处理（例如疑似凭据），自检不会把它们交给会话自动修改。'"),
    '缺少人工项计数说明'
  )
  assert.ok(page.includes('!risk.manual'), '可勾选列表没有排除人工项')
})

test('手机报告截断时保留总数和分级计数', { skip: skipCross }, () => {
  assert.ok(page.includes('report?.riskTotal'), '页面没有读取 riskTotal')
  assert.ok(page.includes('report?.riskCounts'), '页面没有读取 riskCounts')
  assert.ok(
    page.includes("t('仅显示前 {v1} 项，共 {v2} 项；完整报告请在电脑端查看。'"),
    '截断报告缺少说明'
  )
  // 电脑端最多回传 160 条，避免加密中继信封放不下完整报告。
  const constant = protocol.indexOf('const PHONE_MODULE_RISK_LIMIT = 160')
  assert.notEqual(constant, -1, '协议层缺少手机报告条数上限')
  // 裁剪函数已从 server.ts 的方法搬成 handlers/host-support.ts 的模块级函数，
  // 两种写法都接受，拆分前后口径一致。
  const helper = Math.max(
    protocol.indexOf('function phoneModuleCheckReport('),
    protocol.indexOf('private phoneModuleCheckReport(')
  )
  assert.notEqual(helper, -1, '协议层缺少报告裁剪函数')
  const helperEnd = protocol.indexOf('function phoneModuleCheckState(', helper)
  const body = protocol.slice(helper, helperEnd === -1 ? undefined : helperEnd)
  assert.ok(body.includes('ranked.slice(0, PHONE_MODULE_RISK_LIMIT)'), '报告没有裁剪风险列表')
  // 按电脑端同一套顺序（严重度优先）排序后再截断，避免后几个模块的高风险被整体丢掉。
  assert.ok(body.includes('const ranked = sortRisks(report.risks)'), '裁剪前没有按严重度排序')
  assert.ok(body.includes('riskTotal: report.risks.length'), '报告没有保留风险总数')
  assert.ok(body.includes('riskCounts: counts'), '报告没有保留分级计数')
})

test('协议只接受经过收敛的参数，旧版电脑端有明确提示', { skip: skipCross }, () => {
  for (const method of [
    'moduleCheck.state',
    'moduleCheck.discover',
    'moduleCheck.run',
    'moduleCheck.settings',
    'moduleCheck.accept'
  ]) {
    assert.ok(protocol.includes(`case '${method}'`), `电脑端缺少 ${method}`)
  }
  assert.ok(
    protocol.includes("throw new Error('当前电脑端版本不支持手机模块自检')"),
    '旧版电脑端缺少提示'
  )
  assert.ok(protocol.includes('intervalHours = Math.max(1, Math.min(24 * 30'), '自检间隔没有边界')
  assert.ok(protocol.includes("requireString(params['reportId']"), '缺少报告 id 校验')
  assert.ok(protocol.includes("throw new Error('请先勾选要优化的风险点')"), '缺少空选择校验')
})

test('手机端关键文案都有英文翻译', () => {
  for (const key of [
    '模块自检',
    '工程健康',
    '健康分',
    '风险点',
    '已扫描文件',
    '自检模块',
    '立即自检',
    '定期自检',
    '自检间隔',
    '风险点与建议',
    '全选可优化项',
    '生成提案（{v1}）',
    '自改源码（{v1}）',
    '改造提案预览',
    '超大文件',
    '疑似凭据',
    '缺少验证脚本'
  ]) {
    assert.ok(locale.includes(JSON.stringify(key)), `英文词典缺少 ${key}`)
  }
})
