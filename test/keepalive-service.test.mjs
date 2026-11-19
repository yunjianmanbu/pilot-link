/**
 * 前台服务保活的接线测试：只验证 Native.js 调用形状与静默降级，
 * 真正的常驻行为由 Android 壳里的 PilotKeepAliveService 负责。
 */
import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  startKeepAliveService,
  stopKeepAliveService
} from '../lib/keepalive-service.js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

// 模块内记住「服务已启动」，测试之间必须清掉，否则后一个用例会提前返回。
afterEach(() => {
  stopKeepAliveService()
})

function fakePlus({ sdk = 33, startFails = false, stopFails = false } = {}) {
  const calls = []
  function Intent() {
    this.packageName = ''
    this.className = ''
  }
  Intent.prototype.setClassName = function (packageName, className) {
    this.packageName = packageName
    this.className = className
  }
  const main = {
    getPackageName: () => 'cc.medpilot.pilot',
    startForegroundService(intent) {
      if (startFails) throw new Error('not allowed')
      calls.push({ method: 'startForegroundService', intent })
    },
    startService(intent) {
      if (startFails) throw new Error('not allowed')
      calls.push({ method: 'startService', intent })
    },
    stopService(intent) {
      if (stopFails) throw new Error('not allowed')
      calls.push({ method: 'stopService', intent })
    }
  }
  const plus = {
    android: {
      runtimeMainActivity: () => main,
      importClass(name) {
        return name === 'android.content.Intent' ? Intent : null
      }
    },
    os: { name: 'Android', version: String(sdk) }
  }
  return { plus, calls, main, Intent }
}

test('Android 8+ 用 startForegroundService 启动壳里的保活服务', () => {
  const { plus, calls } = fakePlus()
  assert.equal(startKeepAliveService(plus), true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'startForegroundService')
  assert.equal(calls[0].intent.packageName, 'cc.medpilot.pilot')
  assert.equal(calls[0].intent.className, 'cc.medpilot.pilot.PilotKeepAliveService')
  // 同一次运行里重复调用不会重复启动。
  assert.equal(startKeepAliveService(plus), true)
  assert.equal(calls.length, 1)
})

test('Android 8 之前退回 startService', () => {
  const { plus, calls } = fakePlus({ sdk: 23 })
  assert.equal(startKeepAliveService(plus), true)
  assert.equal(calls[0].method, 'startService')
})

test('停止服务调用 stopService，之后可以重新启动', () => {
  const { plus, calls } = fakePlus()
  startKeepAliveService(plus)
  assert.equal(stopKeepAliveService(plus), true)
  assert.equal(calls.at(-1).method, 'stopService')

  assert.equal(startKeepAliveService(plus), true)
  assert.equal(calls.filter((call) => call.method === 'startForegroundService').length, 2)
})

test('非 Android、旧壳没有服务类、或无 Activity 时静默返回 false', () => {
  assert.equal(startKeepAliveService({ os: { name: 'iOS' } }), false)

  const noClass = fakePlus()
  noClass.plus.android.importClass = () => null
  assert.equal(startKeepAliveService(noClass.plus), false)
  assert.equal(noClass.calls.length, 0)

  const noMain = fakePlus()
  noMain.plus.android.runtimeMainActivity = () => null
  assert.equal(startKeepAliveService(noMain.plus), false)
  assert.equal(noMain.calls.length, 0)

  assert.equal(startKeepAliveService(null), false)
})

test('启动失败（例如后台限制）不抛错，也不记住已启动', () => {
  const { plus, calls } = fakePlus({ startFails: true })
  assert.equal(startKeepAliveService(plus), false)
  // 下一次在前台仍然可以重试。
  plus.android.runtimeMainActivity().startForegroundService = (intent) => {
    calls.push({ method: 'startForegroundService', intent })
  }
  assert.equal(startKeepAliveService(plus), true)
  assert.equal(calls.length, 1)
})

test('回到前台强制重下发启动命令，服务被 ROM 杀掉后能自愈', () => {
  const { plus, calls } = fakePlus()
  startKeepAliveService(plus)
  assert.equal(calls.length, 1)

  // 后台期间系统把服务杀了，JS 里的 servicePlus 仍缓存着「已在跑」。
  // 回前台必须重新下发，否则永远不会再启动。
  assert.equal(startKeepAliveService(plus, { force: true }), true)
  assert.equal(calls.filter((call) => call.method === 'startForegroundService').length, 2)
})

test('停止失败时仍清理模块状态，不把错误抛给页面', () => {
  const { plus } = fakePlus({ stopFails: true })
  assert.equal(stopKeepAliveService(plus), false)
  assert.equal(startKeepAliveService(plus), true)
})

test('壳内前台服务源码和清单声明没有被删掉', () => {
  const java = fs.readFileSync(
    path.join(root, 'native', 'android', 'PilotKeepAliveService.java'),
    'utf8'
  )
  assert.match(java, /class PilotKeepAliveService extends Service/)
  assert.match(java, /FOREGROUND_SERVICE_TYPE_SPECIAL_USE/)
  assert.match(java, /PARTIAL_WAKE_LOCK/)
  assert.match(java, /START_NOT_STICKY/)

  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
  const permissions = manifest['app-plus']?.distribute?.android?.permissions || []
  const joined = permissions.join('\n')
  assert.match(joined, /android\.permission\.FOREGROUND_SERVICE"/)
  assert.match(joined, /android\.permission\.FOREGROUND_SERVICE_SPECIAL_USE"/)
})
