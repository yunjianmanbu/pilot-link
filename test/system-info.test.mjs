import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { DISK_LOW_BYTES, formatBytes } from '../lib/format.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

const page = read('pages/settings/index.vue')
const store = read('store/index.js')
const locale = read('lib/locale-en.js')
const CLIENT_SERVER = path.join(ROOT, '..', 'client', 'src', 'main', 'companion', 'server.ts')
const protocol = fs.existsSync(CLIENT_SERVER) ? fs.readFileSync(CLIENT_SERVER, 'utf8') : null


// 拆仓后本仓库不含桌面端源码与工作区文档：读不到就跳过，而不是判失败。
const skipCross = protocol != null ? false : '独立仓库不含桌面端源码（pilot/client）与工作区文档（pilot/docs），跳过跨仓库一致性检查'
test('字节格式与桌面端一致，读不到时不显示 0', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(2 * 1024 ** 3), '2.0 GB')
  assert.equal(formatBytes(150 * 1024 ** 3), '150 GB')
  assert.equal(formatBytes(null), '—')
  assert.equal(formatBytes(undefined), '—')
  assert.equal(formatBytes(-1), '—')
  assert.equal(formatBytes('nope'), '—')
  assert.equal(DISK_LOW_BYTES, 2 * 1024 ** 3)
})

test('store 通过 system.info 读取电脑端运行环境', () => {
  const start = store.indexOf('export async function loadSystemInfo')
  assert.notEqual(start, -1, '缺少 loadSystemInfo')
  const body = store.slice(start, store.indexOf('\nexport ', start + 10))
  assert.ok(body.includes("'system.info'"), '没有调用 system.info')
  assert.ok(body.includes('isConnected()'), '离线时没有报错')
})

test('设置页只读展示运行环境并可刷新', () => {
  assert.ok(page.includes('loadSystemInfo'), '设置页没有读取运行环境')
  assert.ok(page.includes("t('运行环境')"), '缺少运行环境卡片')
  for (const label of ['系统', 'CPU', '内存', '磁盘', '运行时']) {
    assert.ok(page.includes(`label: t("${label}")`), `运行环境缺少 ${label}`)
  }
  assert.ok(page.includes('@click="loadEnvInfo"'), '缺少刷新动作')
  assert.ok(
    page.includes("message.includes('不支持')"),
    '旧版电脑端没有换成升级提示'
  )
  assert.ok(page.includes('envInfo.disk && envInfo.disk.low'), '磁盘不足时没有提示')
  assert.ok(
    page.includes("t('工作区所在卷剩余空间不足 {v1}，安装依赖或构建可能因 ENOSPC 失败。'"),
    '缺少 ENOSPC 提示文案'
  )
  assert.ok(page.includes('void this.loadEnvInfo()'), '回到设置页时没有刷新运行环境')
})

test('协议只测量当前工作区，不接受手机传路径', { skip: skipCross }, () => {
  assert.ok(protocol.includes("case 'system.info'"), '电脑端缺少 system.info')
  const start = protocol.indexOf("case 'system.info'")
  const body = protocol.slice(start, protocol.indexOf('case ', start + 10))
  assert.ok(body.includes('store.activeWorkspace()'), '没有使用当前工作区')
  assert.ok(!body.includes("params['"), '手机不应能指定测量路径')
  assert.ok(body.includes('await systemInfo('), '没有调用 systemInfo')
})

test('运行环境的关键文案都有英文翻译', () => {
  for (const key of [
    '运行环境',
    '系统',
    '内存',
    '磁盘',
    '运行时',
    '无法读取运行环境',
    '读取运行环境失败',
    '当前电脑端版本不支持手机查看运行环境，请先在电脑上更新 Pilot。',
    '{v1} 核',
    '{v1} 可用 / {v2}',
    '工作区所在卷剩余空间不足 {v1}，安装依赖或构建可能因 ENOSPC 失败。',
    '只读展示；系统、内存和磁盘信息来自当前电脑。'
  ]) {
    assert.ok(locale.includes(JSON.stringify(key)), `英文词典缺少 ${key}`)
  }
})
