/**
 * 手机端内视（self-check）页的数据整形与入口测试。
 *
 * 内视的判定完全在电脑端完成，手机只负责展示与复制，所以这里验证的是：
 * 脏数据不会让页面崩、异常项一定排在最前、复制文本只写真实取值、
 * 以及页面/入口/协议方法都真的接上了。
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  countStatuses,
  groupSelfCheck,
  normalizeSelfCheck,
  reportStamp,
  reportToText,
  statusClass,
  statusLabel,
  summarizeCounts
} from '../lib/self-check.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = path.join(ROOT, '..', 'client')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const readClient = (relative) => {
  const abs = path.join(CLIENT, relative)
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null
}

const page = read('pages/self-check/index.vue')
const pages = read('pages.json')
const settings = read('pages/settings/index.vue')
const store = read('store/index.js')
const protocol = readClient('src/main/companion/server.ts')
const locale = read('lib/locale-en.js')

const sample = {
  at: 1_760_000_000_000,
  version: '0.1.30',
  durationMs: 42,
  items: [
    { id: 'runtime', group: 'runtime', title: '运行时', status: 'ok', detail: '正常', facts: ['Pilot 0.1.30'] },
    { id: 'sandbox', group: 'exec', title: '沙箱', status: 'broken', detail: '沙箱不可用', facts: ['平台 win32'], hint: '检查系统设置' },
    { id: 'mcp', group: 'ext', title: 'MCP', status: 'off', detail: '未配置', facts: [] },
    { id: 'approval', group: 'exec', title: '审批', status: 'warn', detail: '有 2 条规则被忽略', facts: ['允许 8 条'] }
  ]
}


// 拆仓后本仓库不含桌面端源码与工作区文档：读不到就跳过，而不是判失败。
const skipCross = protocol != null ? false : '独立仓库不含桌面端源码（pilot/client）与工作区文档（pilot/docs），跳过跨仓库一致性检查'
test('内视报告归一化后按异常优先排序', () => {
  const report = normalizeSelfCheck(sample)
  assert.ok(report)
  assert.deepEqual(
    report.items.map((item) => item.status),
    ['broken', 'warn', 'off', 'ok']
  )
  assert.equal(report.version, '0.1.30')
  assert.equal(report.durationMs, 42)
})

test('脏字段不会让归一化抛错', () => {
  const report = normalizeSelfCheck({
    at: 'not-a-number',
    version: 42,
    items: [null, 'oops', { id: '', status: 'weird', facts: 'nope' }, { title: '只有标题' }]
  })
  assert.ok(report)
  assert.equal(report.at, 0)
  assert.equal(report.version, '')
  // 两个坏条目被丢掉，两个可用条目保留；未知状态按“注意”处理，不去猜成正常。
  assert.equal(report.items.length, 2)
  assert.equal(report.items[0].status, 'warn')
  assert.deepEqual(report.items[0].facts, [])
})

test('没有报告时返回 null，而不是空壳', () => {
  assert.equal(normalizeSelfCheck(null), null)
  assert.equal(normalizeSelfCheck(undefined), null)
  assert.equal(normalizeSelfCheck({}), null)
  assert.equal(reportToText(null), '还没有内视结果')
})

test('计数与摘要覆盖四类状态', () => {
  const report = normalizeSelfCheck(sample)
  assert.deepEqual(report.counts, { ok: 1, warn: 1, off: 1, broken: 1 })
  assert.deepEqual(countStatuses(null), { ok: 0, warn: 0, off: 0, broken: 0 })
  assert.match(summarizeCounts(report.counts), /正常 1/)
})

test('分组按固定顺序切段，空分组不出现', () => {
  const report = normalizeSelfCheck(sample)
  assert.deepEqual(
    groupSelfCheck(report.items).map((section) => section.group),
    ['runtime', 'exec', 'ext']
  )
  assert.deepEqual(groupSelfCheck([]), [])
})

test('状态文案与样式类名来自同一份映射', () => {
  assert.equal(statusLabel('broken'), '异常')
  assert.equal(statusLabel('nope'), '未知')
  assert.equal(statusClass('warn'), 'is-warn')
  assert.equal(statusClass('nope'), 'is-warn')
})

test('复制文本按分组写出真实取值与下一步', () => {
  const text = reportToText(normalizeSelfCheck(sample))
  assert.match(text, /Pilot 0\.1\.30/)
  assert.match(text, /\[异常\] 沙箱：沙箱不可用/)
  assert.match(text, /平台 win32/)
  assert.match(text, /下一步：检查系统设置/)
  // 正常项也要在文本里，方便对照“哪些是好的”。
  assert.match(text, /\[正常\] 运行时/)
})

test('时间戳按本地时间格式化，坏时间给出明确文案', () => {
  assert.match(reportStamp(1_760_000_000_000), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  assert.equal(reportStamp(0), '时间未知')
  assert.equal(reportStamp('bad'), '时间未知')
})

test('内视页已注册，设置页有入口', () => {
  assert.ok(pages.includes('"pages/self-check/index"'), 'pages.json 缺少内视页')
  assert.ok(settings.includes('@click="openSelfCheck"'), '设置页缺少内视入口')
  assert.ok(
    settings.includes("uni.navigateTo({ url: '/pages/self-check/index' })"),
    '设置页入口没有跳到内视页'
  )
})

test('store 的内视通道走电脑端 selfCheck.run', () => {
  const start = store.indexOf('export async function loadSelfCheck')
  assert.notEqual(start, -1, '缺少 loadSelfCheck')
  const body = store.slice(start, store.indexOf('\nexport ', start + 10))
  assert.ok(body.includes("'selfCheck.run'"), 'loadSelfCheck 没有调用 selfCheck.run')
  assert.ok(body.includes('isConnected()'), 'loadSelfCheck 离线时没有报错')
})

test('电脑端协议实现了 selfCheck.run 并带能力兜底', { skip: skipCross }, () => {
  assert.ok(protocol.includes("case 'selfCheck.run'"), 'companion 缺少 selfCheck.run 分支')
  assert.ok(protocol.includes('不支持手机内视'), '旧宿主没有给出明确的不支持提示')
})

test('内视页不提供任何写入入口', () => {
  // 内视只读：页面里不能出现创建会话、写入文件或确认改造的调用。
  for (const forbidden of ['createSession', 'sendMessage', 'saveFile', 'acceptModuleCheck']) {
    assert.equal(page.includes(forbidden), false, `内视页不应包含 ${forbidden}`)
  }
})

test('内视页用到的英文词条都在词典里', () => {
  for (const key of [
    '内视',
    '只读采样电脑端状态',
    '连接电脑后才能运行内视。',
    '还没有内视结果',
    '复制报告',
    '只复制异常项',
    '正常 {v1} · 注意 {v2} · 未启用 {v3} · 异常 {v4}',
    '下一步：{v1}',
    '时间未知'
  ]) {
    assert.ok(locale.includes(JSON.stringify(key)), `英文词典缺少 ${key}`)
  }
})
