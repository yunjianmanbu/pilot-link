import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isBatteryUnrestricted,
  openBatterySettings
} from '../lib/background-settings.js'

function fakePlus({
  startActivityFails = false,
  failFirst = false,
  ignoring = true,
  noPower = false
} = {}) {
  const calls = []
  function Intent() {
    this.action = ''
    this.data = null
  }
  Intent.prototype.setAction = function (action) {
    this.action = action
  }
  Intent.prototype.setData = function (uri) {
    this.data = uri
  }
  const Uri = {
    parse: (value) => ({ value })
  }
  const main = {
    getPackageName: () => 'cc.medpilot.pilot',
    startActivity(intent) {
      if (startActivityFails) throw new Error('no activity')
      if (
        failFirst &&
        intent.action === 'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'
      ) {
        throw new Error('not supported')
      }
      calls.push({ action: intent.action, data: intent.data })
    }
  }
  const power = {
    isIgnoringBatteryOptimizations(pkg) {
      calls.push({ method: 'isIgnoringBatteryOptimizations', pkg })
      return ignoring
    }
  }
  const plus = {
    android: {
      runtimeMainActivity: () => main,
      importClass(name) {
        if (name === 'android.content.Intent') return Intent
        if (name === 'android.net.Uri') return Uri
        return null
      },
      invoke(target, method, ...args) {
        if (target === main && method === 'getSystemService') {
          return noPower ? null : power
        }
        return target?.[method]?.(...args)
      }
    },
    os: { name: 'Android', version: '33' }
  }
  return { plus, calls }
}

test('Android 上打开忽略电池优化确认页，并带上本应用包名', () => {
  const { plus, calls } = fakePlus()
  assert.equal(openBatterySettings(plus), true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].action, 'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS')
  assert.deepEqual(calls[0].data, { value: 'package:cc.medpilot.pilot' })
})

test('第一个入口被 ROM 拒绝时依次退到电池优化列表', () => {
  const { plus, calls } = fakePlus({ failFirst: true })
  assert.equal(openBatterySettings(plus), true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].action, 'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS')
})

test('所有入口都不可用时返回 false，不把异常抛给页面', () => {
  const { plus, calls } = fakePlus({ startActivityFails: true })
  assert.equal(openBatterySettings(plus), false)
  assert.equal(calls.length, 0)
})

test('非 Android 或没有 Activity 时返回 false', () => {
  assert.equal(openBatterySettings({ os: { name: 'iOS' } }), false)
  const noMain = fakePlus()
  noMain.plus.android.runtimeMainActivity = () => null
  assert.equal(openBatterySettings(noMain.plus), false)
})

test('读取系统是否已忽略电池优化', () => {
  const allowed = fakePlus({ ignoring: true })
  assert.equal(isBatteryUnrestricted(allowed.plus), true)
  assert.equal(allowed.calls.at(-1).pkg, 'cc.medpilot.pilot')

  const restricted = fakePlus({ ignoring: false })
  assert.equal(isBatteryUnrestricted(restricted.plus), false)
})

test('拿不到 PowerManager 时返回 null，界面显示无法读取', () => {
  const { plus } = fakePlus({ noPower: true })
  assert.equal(isBatteryUnrestricted(plus), null)
  assert.equal(isBatteryUnrestricted({ os: { name: 'iOS' } }), null)
})
