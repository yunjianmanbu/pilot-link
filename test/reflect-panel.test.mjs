/**
 * 设置页「反思」分区：手机端只做配置与阅读，判定与执行都在电脑端。
 *
 * 这里守四件事：
 * 1) store 的每个请求都走 companion 的 reflect.* 协议，离线时不发请求；
 * 2) 面板的问题域表与电脑端 `src/shared/reflect.ts` 同序同 id（两份表，靠测试兜住）；
 * 3) 间隔档位落在电脑端的 30 分钟 ~ 7 天范围内，且含默认的 12 小时；
 * 4) 授权码只写不读：面板里不显示已保存的密码，留空表示不修改。
 */

import './locale-zh.mjs'

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { readClient, readClientTree } from './client-source.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

const panel = read('components/reflect-panel/reflect-panel.vue')
const store = read('store/index.js')
const settings = read('pages/settings/index.vue')
const evolution = read('pages/evolution/index.vue')
const locale = read('lib/locale-en.js')
// 拆仓后本仓库不含桌面端源码：读不到就跳过跨仓库一致性检查。
const protocol = readClientTree('src/main/companion')
const shared = readClient('src/shared/reflect.ts')
const skipCross =
  protocol != null && shared != null
    ? false
    : '独立仓库不含桌面端源码（pilot/pilot），跳过跨仓库一致性检查'

/** 取 store 里某个导出函数的函数体，用于断言它调了哪条协议。 */
function storeBody(name) {
  const start = store.indexOf(`export async function ${name}`)
  assert.notEqual(start, -1, `store 缺少 ${name}`)
  return store.slice(start, store.indexOf('\nexport ', start + 10))
}

test('store 的七个反思通道分别走电脑端协议', () => {
  for (const [fn, method] of [
    ['loadReflect', 'reflect.state'],
    ['saveReflectSettings', 'reflect.settings'],
    ['runReflectNow', 'reflect.now'],
    ['sendReflectTestMail', 'reflect.mail.test'],
    ['clearReflectReports', 'reflect.reports.clear'],
    ['loadReflectReport', 'reflect.report']
  ]) {
    const body = storeBody(fn)
    assert.ok(body.includes(`'${method}'`), `${fn} 没有调用 ${method}`)
    assert.ok(body.includes('isConnected()'), `${fn} 离线时没有先判断连接`)
  }
})

test('断言手机端不自行执行反思，只发请求', () => {
  // 反思要读写工作区、调用模型，手机端不该自己拼提示词或写报告文件。
  assert.ok(!panel.includes('reflectEnabled'), '面板不应自己拼设置字段名')
  assert.ok(panel.includes('loadReflect'), '面板首次进入要拉状态')
  assert.ok(panel.includes('syncMailDraft'), '面板要把电脑端邮件配置灌进草稿')
})

test('问题域表与电脑端同序同 id', { skip: skipCross }, () => {
  const desktopIds = [...shared.matchAll(/id: '([a-z-]+)'/g)].map((match) => match[1])
  const phoneIds = [...panel.matchAll(/\{ id: '([a-z-]+)', label:/g)].map((match) => match[1])
  assert.ok(desktopIds.length >= 8, '电脑端问题域少于预期')
  assert.deepEqual(phoneIds, desktopIds, '手机端问题域顺序或 id 与电脑端不一致')
})

test('问题域、触发来源、严重度都有英文翻译', () => {
  for (const label of [
    '会话压缩漂移',
    '存储性能',
    '页面设计合理性',
    '项目结构合理性',
    '代码优化',
    '执行效率',
    '输出质量',
    '交互体验',
    '手动触发',
    '运行失败触发',
    '高',
    '中',
    '低'
  ]) {
    assert.ok(locale.includes(`"${label}":`), `英文词典缺少「${label}」`)
  }
})

test('间隔档位在电脑端允许范围内，且包含默认的 12 小时', {
  skip: skipCross
}, () => {
  // 电脑端写的是 `60 * 24 * 7` 这样的算式，逐项相乘求值即可（不用 eval）。
  const product = (expr) =>
    String(expr)
      .split('*')
      .reduce((total, part) => total * Number(part.trim()), 1)
  const constant = (name) =>
    product(shared.match(new RegExp(`${name}\\s*=\\s*([\\d\\s*+]+)`))?.[1])
  const min = constant('REFLECTION_INTERVAL_MIN_MINUTES')
  const max = constant('REFLECTION_INTERVAL_MAX_MINUTES')
  const fallback = constant('REFLECTION_INTERVAL_DEFAULT_MINUTES')
  assert.ok(min > 0 && max > min, '读不到电脑端的间隔上下限')
  const minutes = [...panel.matchAll(/\{ minutes: (\d+), label:/g)].map((m) => Number(m[1]))
  assert.ok(minutes.length >= 5, '间隔档位少于预期')
  for (const value of minutes) {
    assert.ok(value >= min && value <= max, `${value} 分钟超出 ${min}~${max}`)
  }
  assert.ok(minutes.includes(fallback), `缺少电脑端默认的 ${fallback} 分钟档`)
  assert.deepEqual([...minutes].sort((a, b) => a - b), minutes, '间隔档位应按升序排列')
})

test('授权码只写不读，留空表示不修改', () => {
  assert.ok(panel.includes('smtpPassword: \'\''), '草稿里的授权码必须留空')
  assert.ok(panel.includes('if (password) patch.smtpPassword = password'), '留空时不应提交授权码')
  assert.ok(panel.includes('settings.hasPassword'), '要能提示「已保存」')
  assert.ok(panel.includes('secretVisible'), '授权码要能临时显示')
  assert.ok(
    panel.includes(':password="!secretVisible"'),
    '授权码输入框默认应是密码框'
  )
})

test('保存邮件前先就地校验端口和收件地址', () => {
  const body = panel.slice(panel.indexOf('async saveMail()'))
  assert.ok(body.includes("port < 1 || port > 65535"), '没有校验端口范围')
  assert.ok(body.includes("!emailTo.includes('@')"), '没有校验收件地址')
  assert.ok(!panel.includes('smtpPassword: this.mail.smtpPassword,'), '授权码不能进默认补丁')
})

test('电脑端注册了 reflect 域，并对未知方法报错', { skip: skipCross }, () => {
  assert.ok(protocol.includes("'reflect.state'"), 'companion 没有 reflect.state')
  assert.ok(protocol.includes("'reflect.mail.test'"), 'companion 没有测试邮件通道')
  assert.ok(protocol.includes('handleReflectRequest'), 'reflect 域没有接进 handlers 索引')
  assert.ok(
    protocol.includes('手机端不支持该操作'),
    '未知方法应统一报「手机端不支持该操作」，手机端据此判定版本过旧'
  )
})

test('进化页挂上了反思面板，设置页只留进「进化」页的入口', () => {
  assert.ok(evolution.includes('ReflectPanel'), '进化页没有注册反思组件')
  assert.ok(evolution.includes("activeTab === 'reflect'"), '进化页没有反思页签')
  assert.ok(!settings.includes('<reflect-panel'), '设置页不应再嵌反思面板')
  assert.ok(panel.includes('supported === false'), '没有区分「电脑端版本过旧」')
  assert.ok(locale.includes('"反思": "Reflection"'))
  assert.ok(locale.includes('"启用反思": "Enable reflection"'))
})

test('邮件拆成「邮箱配置」与「通知配置」两块，通知项由电脑端下发', () => {
  assert.ok(panel.includes("t('邮箱配置')"), '缺少邮箱配置分区')
  assert.ok(panel.includes("t('通知配置')"), '缺少通知配置分区')
  // 事件目录不写死在手机端：电脑端下发 notifyCatalog，数组顺序就是推荐优先级。
  assert.ok(panel.includes('settings?.notifyCatalog'), '面板没有读电脑端下发的通知目录')
  assert.ok(panel.includes('v-for="(entry, index) in notifyCatalog"'), '通知项没有按目录顺序渲染')
  assert.ok(panel.includes('{{ index + 1 }}.'), '通知项没有显示推荐序号')
  assert.ok(panel.includes('notifyHint(entry)'), '通知项没有显示说明文字')
  assert.ok(panel.includes('isNotifyOn(entry.id)'), '通知项没有反映当前勾选状态')
  assert.ok(panel.includes('@click="toggleNotifyEvent(entry.id)"'), '通知项不能单独开关')
  assert.ok(panel.includes('patch({ notifyEmailEvents: next })'), '勾选结果没有提交给电脑端')
  assert.ok(panel.includes('notifyEmailEnabled'), '缺少邮件通知总开关')
  assert.ok(!panel.includes('notifyCatalog: ['), '事件目录不能写死在手机端')
  assert.ok(!panel.includes('toggleMail()'), '旧的单个邮件开关应已移除')
})

test('电脑端把通知目录与开关一起下发给手机端', { skip: skipCross }, () => {
  assert.ok(protocol.includes('notifyCatalog'), 'companion 没有下发 notifyCatalog')
  assert.ok(protocol.includes('notifyEmailEvents'), 'companion 没有下发 notifyEmailEvents')
  assert.ok(protocol.includes('notifyEmailEnabled'), 'companion 没有下发 notifyEmailEnabled')
  assert.ok(protocol.includes('NOTIFY_EVENTS'), '目录应复用 shared/notify-events 的定义')
})

test('分区文案都有英文翻译，旧的分区键已删', () => {
  for (const key of [
    '邮箱配置',
    '通知配置',
    '收件人、SMTP 登录名和发件人都是这一个地址，也就是自己发给自己。',
    '开启就通知，关闭就不通知；列表按推荐优先级排序。',
    '共 {v1} 类通知，已选 {v2} 类。未勾选的事件不会发信。',
    '这台电脑的 Pilot 版本较旧，请在电脑端的「邮箱配置 → 通知配置」里设置。',
    '保存邮箱配置'
  ]) {
    assert.ok(locale.includes(`"${key}":`), `英文词典缺少「${key}」`)
  }
  assert.ok(!locale.includes('"邮件通知":'), '旧的「邮件通知」键应已移除')
  assert.ok(!locale.includes('"保存邮件设置":'), '旧的「保存邮件设置」键应已移除')
})
