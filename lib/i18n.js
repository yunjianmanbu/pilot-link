/**
 * 手机端界面语言：中文文案本身就是字典 key，缺少英文时回退到中文。
 *
 * 电脑端和手机端各自维护一份英文词典；智能体的回复语言由系统提示决定，
 * 不在这里翻译。
 */

import { en } from './locale-en.js'

export const APP_LOCALES = ['zh-CN', 'en']
export const LOCALE_SETTING_KEY = 'pilot.locale.v1'

export function normalizeLocaleTag(tag) {
  const value = String(tag || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
  return value === 'zh' || value.startsWith('zh-') ? 'zh-CN' : 'en'
}

export function isLocaleSetting(value) {
  return value === 'auto' || value === 'zh-CN' || value === 'en'
}

export function resolveLocale(setting, systemLocales) {
  if (setting === 'zh-CN' || setting === 'en') return setting
  const tags = Array.isArray(systemLocales) ? systemLocales : [systemLocales]
  for (const tag of tags) {
    if (typeof tag === 'string' && tag.trim()) return normalizeLocaleTag(tag)
  }
  return 'zh-CN'
}

function readStoredSetting() {
  let value = ''
  try {
    if (typeof uni !== 'undefined' && typeof uni.getStorageSync === 'function') {
      value = uni.getStorageSync(LOCALE_SETTING_KEY)
    }
  } catch {
    // ignore
  }
  if (!value) {
    try {
      if (typeof localStorage !== 'undefined') value = localStorage.getItem(LOCALE_SETTING_KEY)
    } catch {
      // ignore
    }
  }
  return isLocaleSetting(value) ? value : 'auto'
}

function writeSetting(value) {
  try {
    if (typeof uni !== 'undefined' && typeof uni.setStorageSync === 'function') {
      uni.setStorageSync(LOCALE_SETTING_KEY, value)
      return
    }
  } catch {
    // ignore
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LOCALE_SETTING_KEY, value)
  } catch {
    // ignore
  }
}

/** 手机系统语言：uni.getLocale 优先，其次系统信息与浏览器。 */
export function systemLocales() {
  try {
    if (typeof uni !== 'undefined' && typeof uni.getLocale === 'function') {
      const locale = uni.getLocale()
      if (locale) return [locale]
    }
  } catch {
    // ignore
  }
  try {
    if (typeof uni !== 'undefined' && typeof uni.getSystemInfoSync === 'function') {
      const info = uni.getSystemInfoSync()
      const tags = [info?.language, info?.locale].filter(
        (item) => typeof item === 'string' && item.trim()
      )
      if (tags.length) return tags
    }
  } catch {
    // ignore
  }
  try {
    if (typeof navigator !== 'undefined') {
      if (Array.isArray(navigator.languages) && navigator.languages.length) {
        return navigator.languages.filter((item) => typeof item === 'string')
      }
      if (navigator.language) return [navigator.language]
    }
  } catch {
    // ignore
  }
  return []
}

let setting = readStoredSetting()
let current = resolveLocale(setting, systemLocales())

export function getLocaleSetting() {
  return setting
}

export function getLocale() {
  return current
}

/** 重新从存储和系统读取语言；App 启动时调用。 */
export function initI18n() {
  setting = readStoredSetting()
  current = resolveLocale(setting, systemLocales())
  return current
}

/** 修改界面语言；返回实际语言是否变化（页面可据此决定是否重新加载）。 */
export function setLocaleSetting(next) {
  const value = isLocaleSetting(next) ? next : 'auto'
  setting = value
  writeSetting(value)
  const resolved = resolveLocale(value, systemLocales())
  const changed = resolved !== current
  current = resolved
  return changed
}

/** 立即在当前页面生效，不写存储（系统语言变化时使用）。 */
export function applyLocale(settingValue, system) {
  const next = resolveLocale(settingValue, system === undefined ? systemLocales() : system)
  const changed = next !== current
  current = next
  return changed
}

export function t(source, vars) {
  const template = current === 'en' ? en[source] ?? source : source
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const value = vars[name]
    return value === undefined ? match : String(value)
  })
}
