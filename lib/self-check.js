/**
 * 内视（self-check）报告的手机端整形规则。
 *
 * 电脑端的内视只读采样自己正在运行的服务实例（模型接入、审批、沙箱、自写工具、
 * MCP、插件、存储、定时任务、反馈、更新、体检），产出固定四类状态：
 * 正常 / 注意 / 未启用 / 异常。手机端不重算判定，只做三件事：
 *
 * - 把脏数据挡在页面之外：字段缺失按「未知」处理，不让 foreach 崩掉整页；
 * - 按「异常 → 注意 → 未启用 → 正常」排序并分组，异常永远在最前面；
 * - 生成可复制/分享的纯文本，方便直接贴到反馈里。
 */

import { t } from './i18n.js'

/** 判定顺序：越靠前越需要先看。 */
export const STATUS_ORDER = ['broken', 'warn', 'off', 'ok']

/** 分组只在页面上分段展示，不参与判定。 */
export const GROUP_ORDER = ['runtime', 'model', 'exec', 'ext', 'data']

const STATUS_SOURCE = {
  ok: '正常',
  warn: '注意',
  off: '未启用',
  broken: '异常'
}

const GROUP_SOURCE = {
  runtime: '运行时',
  model: '模型',
  exec: '执行',
  ext: '扩展',
  data: '数据'
}

function text(value, limit = 400) {
  if (typeof value !== 'string') return ''
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

function statusOf(value) {
  return STATUS_ORDER.includes(value) ? value : 'warn'
}

function groupOf(value) {
  return GROUP_ORDER.includes(value) ? value : 'runtime'
}

/** 状态与分组的中文原文（也是英文词典的 key）。 */
export function statusLabel(status) {
  return STATUS_SOURCE[status] ?? '未知'
}

/**
 * 分组名走文献字面量，而不是直接返回中文常量：
 * 这样 i18n 的词典覆盖检查能扫到这几个 key，动态拼接的字符串扫不到。
 */
export function groupText(group) {
  const table = {
    runtime: t('运行时'),
    model: t('模型'),
    exec: t('执行'),
    ext: t('扩展'),
    data: t('数据')
  }
  return table[group] ?? t('其它')
}

export function groupLabel(group) {
  return GROUP_SOURCE[group] ?? '其它'
}

/** 状态对应的样式类名，页面直接绑到 class 上。 */
export function statusClass(status) {
  return `is-${statusOf(status)}`
}

/** 计数：四类状态各多少条。缺失的按 0 计，不用默认值伪装成正常。 */
export function countStatuses(items) {
  const counts = { ok: 0, warn: 0, off: 0, broken: 0 }
  for (const item of Array.isArray(items) ? items : []) {
    const status = statusOf(item?.status)
    counts[status] += 1
  }
  return counts
}

/**
 * 归一化电脑端返回的报告。
 *
 * `report` 缺失、字段类型不对都不抛错：页面显示「没有读到内视结果」比整页白屏
 * 有用，而字段坏掉时保留条目本身，让人能看到是哪一项采样出了问题。
 */
export function normalizeSelfCheck(raw) {
  const source = raw && typeof raw === 'object' ? raw : null
  const items = (Array.isArray(source?.items) ? source.items : [])
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const id = text(item.id, 80) || `item-${index}`
      const facts = (Array.isArray(item.facts) ? item.facts : [])
        .map((fact) => text(fact, 300))
        .filter(Boolean)
        .slice(0, 12)
      return {
        id,
        group: groupOf(item.group),
        title: text(item.title, 120) || id,
        status: statusOf(item.status),
        detail: text(item.detail, 300),
        facts,
        hint: text(item.hint, 300),
        durationMs: Number(item.durationMs) || 0
      }
    })
    .filter(Boolean)

  if (!items.length) return null

  const at = Number(source?.at)
  return {
    at: Number.isFinite(at) && at > 0 ? at : 0,
    version: text(source?.version, 40),
    durationMs: Number(source?.durationMs) || 0,
    counts: countStatuses(items),
    // 异常优先，其次注意、未启用、正常；同状态按 id 稳定排序。
    items: items.sort((left, right) => {
      const byStatus =
        STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status)
      if (byStatus !== 0) return byStatus
      return left.id.localeCompare(right.id)
    })
  }
}

/** 按分组切段，段内沿用 normalizeSelfCheck 的排序。空分组不出现。 */
export function groupSelfCheck(items) {
  const rows = Array.isArray(items) ? items : []
  return GROUP_ORDER.map((group) => ({
    group,
    items: rows.filter((item) => item.group === group)
  })).filter((section) => section.items.length > 0)
}

/** 「正常 6 · 注意 2 · 未启用 1 · 异常 0」；0 的那一项也写出来，方便对照。 */
export function summarizeCounts(counts) {
  const value = counts || {}
  return t('正常 {v1} · 注意 {v2} · 未启用 {v3} · 异常 {v4}', {
    v1: Number(value.ok) || 0,
    v2: Number(value.warn) || 0,
    v3: Number(value.off) || 0,
    v4: Number(value.broken) || 0
  })
}

/** 采样时间：手机只显示到分钟，省掉秒带来的无意义抖动。 */
export function reportStamp(at) {
  const value = Number(at)
  if (!Number.isFinite(value) || value <= 0) return t('时间未知')
  const date = new Date(value)
  const pad = (input) => String(input).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

/**
 * 复制/分享用的纯文本。
 *
 * 只写真实取值（facts），不写「一切正常」这类没有证据的总结：这段文字经常被
 * 直接贴进反馈里，含糊的结论帮不上定位问题。
 */
export function reportToText(report) {
  const value = report || null
  if (!value || !Array.isArray(value.items) || value.items.length === 0) {
    return t('还没有内视结果')
  }
  const lines = [
    `Pilot ${t('内视')} · ${value.version || t('未知版本')} · ${reportStamp(value.at)}`,
    summarizeCounts(value.counts)
  ]
  for (const section of groupSelfCheck(value.items)) {
    lines.push('')
    lines.push(`## ${groupText(section.group)}`)
    for (const item of section.items) {
      lines.push(`- [${t(statusLabel(item.status))}] ${item.title}：${item.detail}`)
      for (const fact of item.facts) lines.push(`    ${fact}`)
      if (item.hint) lines.push(`    ${t('下一步：{v1}', { v1: item.hint })}`)
    }
  }
  return lines.join('\n')
}
