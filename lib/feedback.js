/**
 * 问题反馈：本地草稿校验、环境信息与反馈记录。
 *
 * App 本身没有后端，反馈不会自动上传。这里只负责把用户填的内容整理成
 * 一段可复制的文字，并保存在本机（最多 50 条），由用户自己发给开发者。
 * 纯函数部分不依赖 uni，便于在 node 测试里直接调用。
 */

import { t } from './i18n.js'

export const FEEDBACK_KINDS = ['bug', 'feature', 'suggestion']
export const FEEDBACK_TITLE_MAX = 80
export const FEEDBACK_BODY_MAX = 4000
export const FEEDBACK_CONTACT_MAX = 120
export const FEEDBACK_STORE_KEY = 'pilot-app.feedback.v1'
export const FEEDBACK_STORE_LIMIT = 50

export function isFeedbackKind(value) {
  return FEEDBACK_KINDS.includes(value)
}

export function feedbackKindLabel(kind) {
  if (kind === 'feature') return t('提需求')
  if (kind === 'suggestion') return t('提建议')
  return t('反馈问题')
}

/** 输入校验失败时的展示文案；problem 供测试和页面分支使用。 */
export function feedbackProblemText(problem) {
  if (problem === 'kind') return t('请选择反馈类型')
  if (problem === 'title') return t('请填写一句话概括')
  if (problem === 'titleTooLong') return t('概括请控制在 {v1} 个字符以内', { v1: FEEDBACK_TITLE_MAX })
  if (problem === 'body') return t('请填写具体内容')
  if (problem === 'bodyTooLong') return t('内容请控制在 {v1} 个字符以内', { v1: FEEDBACK_BODY_MAX })
  if (problem === 'contactTooLong') {
    return t('联系方式请控制在 {v1} 个字符以内', { v1: FEEDBACK_CONTACT_MAX })
  }
  return ''
}

function readText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 校验一份草稿。返回 `{ ok: true, draft }` 或 `{ ok: false, problem }`，
 * 不抛异常，页面可以直接用 problem 取文案。
 */
export function normalizeFeedback(input) {
  const raw = input && typeof input === 'object' ? input : {}
  if (!isFeedbackKind(raw.kind)) return { ok: false, problem: 'kind' }
  const title = readText(raw.title)
  const body = readText(raw.body)
  const contact = readText(raw.contact)
  if (!title) return { ok: false, problem: 'title' }
  if (title.length > FEEDBACK_TITLE_MAX) return { ok: false, problem: 'titleTooLong' }
  if (!body) return { ok: false, problem: 'body' }
  if (body.length > FEEDBACK_BODY_MAX) return { ok: false, problem: 'bodyTooLong' }
  if (contact.length > FEEDBACK_CONTACT_MAX) return { ok: false, problem: 'contactTooLong' }
  return { ok: true, draft: { kind: raw.kind, title, body, contact } }
}

/** 把一条记录排成可以直接粘贴发送的纯文本。 */
export function formatFeedback(record) {
  const lines = [`【${feedbackKindLabel(record.kind)}】${record.title}`, '', record.body]
  if (record.contact) lines.push('', `${t('联系方式')}：${record.contact}`)
  const env = record.env || {}
  const envParts = [env.version ? `Pilot ${env.version}` : '', env.platform, env.system]
    .filter(Boolean)
    .join(' · ')
  lines.push('', '—')
  if (envParts) lines.push(`${t('版本')}：${envParts}`)
  if (record.createdAt) lines.push(`${t('时间')}：${record.createdAt}`)
  if (record.id) lines.push(`${t('编号')}：${record.id}`)
  return lines.join('\n')
}

function randomId() {
  try {
    const bytes = new Uint8Array(8)
    if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
      globalThis.crypto.getRandomValues(bytes)
    } else {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
    }
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  } catch {
    return String(Date.now())
  }
}

/** 手机端环境信息：只取展示用的版本与机型，不读取任何标识。 */
export function currentFeedbackEnv(version) {
  let system = ''
  let platform = 'app'
  try {
    const info =
      typeof uni !== 'undefined' && typeof uni.getSystemInfoSync === 'function'
        ? uni.getSystemInfoSync()
        : null
    if (info) {
      system = [info.brand, info.model, info.system].filter(Boolean).join(' ')
      platform = info.platform || platform
    }
  } catch {
    // 取不到系统信息时只记录版本，不影响提交。
  }
  return { version: version || '', platform, system }
}

export function loadFeedbackRecords() {
  try {
    const raw = uni.getStorageSync(FEEDBACK_STORE_KEY)
    if (!raw) return []
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item) => item && typeof item === 'object' && item.title)
  } catch {
    return []
  }
}

/**
 * 保存一条反馈：校验、补上编号/时间/环境，写入本地并返回记录。
 * 校验失败时返回 `{ ok: false, problem }`，页面据此提示。
 */
export function saveFeedback(input, options = {}) {
  const result = normalizeFeedback(input)
  if (!result.ok) return result
  const record = {
    ...result.draft,
    id: randomId(),
    createdAt: formatTimestamp(options.now || Date.now()),
    env: currentFeedbackEnv(options.version)
  }
  const rows = [record, ...loadFeedbackRecords()].slice(0, FEEDBACK_STORE_LIMIT)
  try {
    uni.setStorageSync(FEEDBACK_STORE_KEY, JSON.stringify(rows))
  } catch {
    return { ok: false, problem: 'storage' }
  }
  return { ok: true, record, total: rows.length }
}

/** 本地时间 `2026-11-14 02:05`，比 ISO 串更适合直接发给别人看。 */
export function formatTimestamp(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (number) => String(number).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}
