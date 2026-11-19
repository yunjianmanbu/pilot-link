/**
 * 费用与余额的纯格式化工具。
 *
 * 数据来自电脑端：`billing.get` 返回
 * `{ balance: { ok, available, entries, source, fetchedAt, error }, usage: {...} }`。
 * 这里只做数字与币种的显示转换，便于单元测试；文案仍由页面用 t() 提供。
 */

const CURRENCY_SYMBOL = { CNY: '¥', USD: '$' }

/**
 * 折算汇率（1 美元 ≈ N 元人民币）。仅用于展示：电脑端记录的估算值仍是美元，
 * 这里换算出人民币给中文界面看。需与 `client/src/shared/billing.ts` 的
 * `USD_CNY_RATE` 保持一致。
 */
export const USD_CNY_RATE = 7.1

/** 估算费用币种：中文界面人民币，英文界面美元。 */
export function costCurrencyFor(locale) {
  const text = String(locale == null ? '' : locale).trim().toLowerCase()
  return text.startsWith('en') ? 'USD' : 'CNY'
}

/** 把电脑端记录的美元估算值换算成展示币种；空值返回 null。 */
export function convertCost(value, currency) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return String(currency || 'CNY').toUpperCase() === 'USD' ? numeric : numeric * USD_CNY_RATE
}

/** 金额：¥12.34 / $0.00432；空值显示 —。 */
export function formatMoney(value, currency) {
  const text = String(value == null ? '' : value).trim()
  if (!text) return '—'
  const numeric = Number(text)
  const symbol = CURRENCY_SYMBOL[String(currency || '').toUpperCase()] || `${currency || ''} `
  if (!Number.isFinite(numeric)) return `${symbol}${text}`
  const abs = Math.abs(numeric)
  if (numeric === 0) return `${symbol}0`
  if (abs < 0.01) return `${symbol}${numeric.toFixed(5)}`
  if (abs < 1) return `${symbol}${numeric.toFixed(4)}`
  return `${symbol}${numeric.toFixed(2)}`
}

/** 估算费用：中文 ¥、英文 $；未知价格返回 —。 */
export function formatCost(value, locale) {
  const currency = costCurrencyFor(locale)
  const numeric = convertCost(value, currency)
  if (numeric === null) return '—'
  return formatMoney(numeric, currency)
}

/** 千分位 token 数。 */
export function formatTokens(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return '0'
  return Math.round(numeric).toLocaleString('en-US')
}

/** 从电脑返回的余额状态里取出主币种那一行；没有则返回 null。 */
export function primaryBalance(balance) {
  if (!balance || !balance.ok || !Array.isArray(balance.entries) || balance.entries.length === 0) {
    return null
  }
  return balance.entries[0]
}

/** 本机用量里最贵（token 最多）的那一行，用于「当前模型」展示。 */
export function topUsageRow(usage) {
  if (!usage || !Array.isArray(usage.rows) || usage.rows.length === 0) return null
  return usage.rows[0]
}

/** 把 ISO 时间转成 HH:mm；无效输入原样返回。 */
export function formatClock(iso) {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return String(iso)
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`
}
