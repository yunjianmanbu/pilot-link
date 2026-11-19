import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = path.join(ROOT, '..', 'client')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const readClient = (relative) => {
  const abs = path.join(CLIENT, relative)
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null
}

const page = read('pages/connect-phone/index.vue')
const pages = read('pages.json')
const settings = read('pages/settings/index.vue')
const store = read('store/index.js')
const protocol = readClient('src/main/companion/server.ts')
const locale = read('lib/locale-en.js')


// 拆仓后本仓库不含桌面端源码与工作区文档：读不到就跳过，而不是判失败。
const skipCross = protocol != null ? false : '独立仓库不含桌面端源码（pilot/client）与工作区文档（pilot/docs），跳过跨仓库一致性检查'
test('换机二维码页已注册，设置页有入口', () => {
  assert.ok(pages.includes('"pages/connect-phone/index"'), 'pages.json 缺少换机二维码页')
  assert.ok(settings.includes('@click="openConnectPhone"'), '设置页缺少显示连接二维码入口')
  assert.ok(
    settings.includes("uni.navigateTo({ url: '/pages/connect-phone/index' })"),
    '设置页入口没有跳到换机二维码页'
  )
})

test('store 通过电脑端协议申请一次性连接二维码', () => {
  const start = store.indexOf('export async function createConnectQr')
  assert.notEqual(start, -1, '缺少 createConnectQr')
  const body = store.slice(start, store.indexOf('\nexport ', start + 10))
  assert.ok(body.includes("'pairing.transfer'"), '没有调用 pairing.transfer')
  assert.ok(body.includes('isConnected()'), '离线时没有报错')
  assert.ok(body.includes("startsWith('data:image/')"), '没有校验二维码图片')
  assert.ok(!body.includes('setStorageSync'), '换机二维码不应写入本地存储')
})

test('电脑端只对已认证手机开放，并保持普通配对仍需确认', { skip: skipCross }, () => {
  assert.ok(protocol.includes("case 'pairing.transfer'"), '电脑端缺少换机二维码接口')
  assert.ok(protocol.includes('createTransferPairing()'), '电脑端缺少换机二维码生成方法')
  assert.ok(protocol.includes('TRANSFER_PAIRING_TTL_MS'), '换机二维码没有单独的有效期')
  assert.ok(protocol.includes('autoApprove'), '换机二维码没有一次性的自动配对标记')
  assert.ok(
    protocol.includes('if (!offer.autoApprove) {'),
    '换机二维码不应再走桌面确认，普通二维码仍必须确认'
  )
  assert.ok(protocol.includes('requestPairApproval'), '普通配对二维码丢失了桌面确认')
  assert.ok(protocol.includes('this.clearOffer()'), '配对成功后没有让二维码立即失效')
})

test('页面展示二维码、倒计时和不可转发的安全提醒', () => {
  assert.ok(page.includes(':src="qr.qrDataUrl"'), '页面没有显示二维码图片')
  assert.ok(page.includes(':show-menu-by-longpress="false"'), '二维码图片不应允许长按保存')
  assert.ok(page.includes("t('{v1}:{v2} 后过期'"), '页面没有展示剩余有效时间')
  assert.ok(page.includes("t('二维码已过期，请刷新')"), '页面没有提示二维码过期')
  assert.ok(page.includes("qr.mode === 'lan'"), '局域网直连时没有提示额外条件')
  for (const text of [
    '二维码包含一次性配对凭证',
    '请勿截图、录屏或发送给他人',
    '当前手机不会自动断开',
    '使用一次后立刻失效'
  ]) {
    assert.ok(page.includes(text), `页面缺少安全提醒：${text}`)
  }
  assert.ok(page.includes('this.qr = null'), '离开页面没有丢弃二维码')
  assert.ok(!page.includes('console.log'), '页面不应记录二维码内容')
})

test('旧版电脑端或生成失败时有明确提示', () => {
  assert.ok(page.includes('friendlyError'), '页面没有处理旧版电脑端')
  assert.ok(page.includes('不支持生成换机二维码'), '页面没有提示升级电脑端')
  assert.ok(page.includes("t('生成连接二维码失败')"), '页面没有生成失败兜底提示')
})

test('换机二维码的英文文案齐全', () => {
  for (const text of [
    '连接另一台手机',
    '用另一台手机扫码连接',
    '用另一台手机扫描下方二维码，即可连接到同一台电脑。',
    '显示连接二维码',
    '不在电脑前时，用另一台手机扫描二维码连接同一台电脑。',
    '正在生成二维码…',
    '二维码只在这台手机上显示。',
    '扫描二维码连接',
    '刷新二维码',
    '二维码已过期，请刷新',
    '当前电脑没有配置云端中继，另一台手机需要和电脑处在同一局域网。',
    '{v1}:{v2} 后过期',
    '仅限本人使用',
    '· 二维码包含一次性配对凭证，只在你自己的手机上展示。请勿截图、录屏或发送给他人。',
    '· 新手机扫码后会立即连接这台电脑；当前手机不会自动断开，需要移除旧设备时请在电脑端「手机配对」里操作。',
    '· 二维码短时间内有效，使用一次后立刻失效；过期后点「刷新二维码」重新生成。',
    '这台电脑的 Pilot 版本较旧，不支持生成换机二维码。请先在电脑上安装新版 Pilot。',
    '生成连接二维码失败',
    '电脑没有返回连接二维码'
  ]) {
    assert.ok(locale.includes(`"${text}"`), `英文词典缺少：${text}`)
  }
})
