
import { t } from './i18n.js'

/**
 * 全局应用弹框队列。
 *
 * 更新检查、安装失败等逻辑分散在 lib 里，没有页面实例，无法直接控制弹框。
 * 这里用一个很小的订阅式 store：lib 调 openAppDialog，页面上的
 * app-dialog-host 负责渲染，用户操作后再把结果 resolve 回去。
 */

const state = {
  visible: false,
  title: '',
  message: '',
  icon: '',
  cancelText: t("取消"),
  confirmText: t("确定"),
  danger: false
}

const listeners = new Set()
let resolveCurrent = null

function snapshot() {
  return { ...state }
}

function notify() {
  const current = snapshot()
  for (const listener of listeners) listener(current)
}

/** 页面里的 host 组件订阅弹框状态；返回取消订阅函数。 */
export function subscribeAppDialog(listener) {
  if (typeof listener !== 'function') return () => {}
  listeners.add(listener)
  listener(snapshot())
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 打开一个应用内弹框，resolve 为 true 表示用户点了主按钮。
 * cancelText 为空字符串时只显示主按钮。
 */
export function openAppDialog(options = {}) {
  return new Promise((resolve) => {
    if (resolveCurrent) {
      const previous = resolveCurrent
      resolveCurrent = null
      previous(false)
    }
    resolveCurrent = resolve
    state.visible = true
    state.title = options.title || ''
    state.message = options.message || ''
    state.icon = options.icon || ''
    state.cancelText = options.cancelText === undefined ? t("取消") : options.cancelText
    state.confirmText = options.confirmText || t("确定")
    state.danger = Boolean(options.danger)
    notify()
  })
}

/** 关闭当前弹框；confirmed 表示用户确认还是取消。 */
export function closeAppDialog(confirmed = false) {
  const resolve = resolveCurrent
  resolveCurrent = null
  state.visible = false
  notify()
  if (resolve) resolve(Boolean(confirmed))
}
