import assert from 'node:assert/strict'
import test from 'node:test'
import { USD_CNY_RATE, convertCost, costCurrencyFor, formatClock, formatCost, formatMoney, formatTokens, primaryBalance, topUsageRow } from '../lib/billing.js'

test('amounts keep the currency symbol and enough decimals for cent-level balances', () => {
  assert.equal(formatMoney('12.34', 'CNY'), '¥12.34')
  assert.equal(formatMoney('0.00432', 'USD'), '$0.00432')
  assert.equal(formatMoney('0', 'CNY'), '¥0')
  assert.equal(formatMoney('', 'CNY'), '—')
  assert.equal(formatMoney(null, 'CNY'), '—')
  // Unknown currency keeps the code instead of inventing a symbol.
  assert.equal(formatMoney('5.5', 'EUR'), 'EUR 5.50')
})

test('cost formatting never invents a number', () => {
  assert.equal(formatCost(null), '—')
  assert.equal(formatCost(undefined), '—')
  assert.equal(formatCost('abc'), '—')
  // 中文界面按人民币显示，英文界面按美元显示。
  assert.equal(formatCost(0, 'zh-CN'), '¥0')
  assert.equal(formatCost(0, 'en'), '$0')
  assert.equal(formatCost(0.0012, 'en'), '$0.00120')
  assert.equal(formatCost(1.2394, 'en'), '$1.24')
  assert.equal(formatCost(1.2394, 'zh-CN'), `¥${(1.2394 * USD_CNY_RATE).toFixed(2)}`)
})

test('cost currency follows the UI language and the rate is applied only for display', () => {
  assert.equal(costCurrencyFor('zh-CN'), 'CNY')
  assert.equal(costCurrencyFor('zh'), 'CNY')
  assert.equal(costCurrencyFor('en'), 'USD')
  assert.equal(costCurrencyFor(''), 'CNY')
  assert.equal(costCurrencyFor(null), 'CNY')
  assert.equal(convertCost(1, 'CNY'), USD_CNY_RATE)
  assert.equal(convertCost(1, 'USD'), 1)
  assert.equal(convertCost(null, 'CNY'), null)
  assert.equal(convertCost('abc', 'CNY'), null)
})

test('token counts are rounded and grouped', () => {
  assert.equal(formatTokens(1234567), '1,234,567')
  assert.equal(formatTokens(0), '0')
  assert.equal(formatTokens(-5), '0')
  assert.equal(formatTokens('42'), '42')
  assert.equal(formatTokens(null), '0')
})

test('primaryBalance only trusts a successful response with entries', () => {
  assert.equal(primaryBalance(null), null)
  assert.equal(primaryBalance({ ok: false, entries: [] }), null)
  assert.equal(primaryBalance({ ok: true, entries: [] }), null)
  const entry = { currency: 'CNY', totalBalance: '10', grantedBalance: '1', toppedUpBalance: '9' }
  assert.equal(primaryBalance({ ok: true, entries: [entry] }), entry)
})

test('topUsageRow returns the largest row or null', () => {
  assert.equal(topUsageRow(null), null)
  assert.equal(topUsageRow({ rows: [] }), null)
  const row = { model: 'deepseek-chat', promptTokens: 10, completionTokens: 2 }
  assert.equal(topUsageRow({ rows: [row] }), row)
})

test('clock formatting is local HH:mm and survives junk', () => {
  assert.equal(formatClock('nonsense'), 'nonsense')
  assert.equal(formatClock(''), '')
  assert.match(formatClock(new Date(2026, 0, 2, 7, 5).toISOString()), /^0?7:05$/)
})
