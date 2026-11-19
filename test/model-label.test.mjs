import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  MODEL_TAG_MAX_LENGTH,
  modelOptionLabel,
  modelTagLength,
  normalizeModelTag
} from '../lib/model-label.js'

test('模型标签按字符计数，不按 UTF-16 码元', () => {
  assert.equal(MODEL_TAG_MAX_LENGTH, 4)
  assert.equal(modelTagLength('个人'), 2)
  assert.equal(modelTagLength('公司甲乙'), 4)
  assert.equal(modelTagLength('🙂🙂🙂🙂'), 4)
  assert.equal(modelTagLength(undefined), 0)
})

test('模型标签去空白并截到四个字', () => {
  assert.equal(normalizeModelTag('  公司A '), '公司A')
  assert.equal(normalizeModelTag('公司  A'), '公司 A')
  assert.equal(normalizeModelTag('公司甲乙丙'), '公司甲乙')
  assert.equal(normalizeModelTag(''), '')
  assert.equal(normalizeModelTag(42), '')
})

test('选择器文案是「名称 · 标签」，没有标签时只有名称', () => {
  assert.equal(modelOptionLabel('gpt-5', '个人'), 'gpt-5 · 个人')
  assert.equal(modelOptionLabel('gpt-5', ''), 'gpt-5')
  assert.equal(modelOptionLabel('gpt-5', '   '), 'gpt-5')
  assert.equal(modelOptionLabel('  通义千问  ', '公司A'), '通义千问 · 公司A')
  assert.equal(modelOptionLabel('', '公司A'), '公司A')
})

test('设置页的模型列表、两个选择器和项目行都带标签', () => {
  const source = readFileSync(new URL('../pages/settings/index.vue', import.meta.url), 'utf8')
  assert.match(source, /import \{ modelOptionLabel \} from '\.\.\/\.\.\/lib\/model-label\.js'/)
  // 资源行 + 会话模型 + 评估模型，三处都走同一个「名称 · 标签」函数。
  assert.equal((source.match(/modelOptionLabel\(/g) || []).length, 3)
})

test('modelOptionLabel 已挂到 methods，模板才能直接调用', () => {
  const source = readFileSync(new URL('../pages/settings/index.vue', import.meta.url), 'utf8')
  const start = source.indexOf('methods: {')
  assert.notEqual(start, -1)
  assert.match(source.slice(start), /^\s+modelOptionLabel,\s*$/m, '缺少 methods 注册会让模型区白屏')
})
