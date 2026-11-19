import assert from 'node:assert/strict'
import test from 'node:test'

import { fuzzyFieldsScore, fuzzyScore } from '../lib/fuzzy.js'

test('连续子串优先命中，且不区分大小写', () => {
  assert.ok(fuzzyScore('Pilot Agent', 'agent') > 0)
  assert.ok(fuzzyScore('Pilot Agent', 'AGENT') > 0)
  assert.ok(fuzzyScore('Pilot Agent', 'agent') > fuzzyScore('Pilot Agent', 'pgt'))
})

test('按顺序逐字匹配，支持中文和路径', () => {
  assert.ok(fuzzyScore('自进化项目', '进化') > 0)
  assert.ok(fuzzyScore('自进化项目', '自进') > 0)
  assert.ok(fuzzyScore('E:\\code\\pilot', 'cpi') > 0)
  assert.equal(fuzzyScore('自进化项目', '项目进化'), -1)
})

test('多字段查询每个关键词都要命中', () => {
  const fields = ['Pilot Agent', 'E:\\code\\pilot-agent']
  assert.ok(fuzzyFieldsScore(fields, 'pilot agent') > 0)
  assert.ok(fuzzyFieldsScore(fields, 'agent E:\\code') > 0)
  assert.equal(fuzzyFieldsScore(fields, 'pilot missing'), -1)
})

test('空查询匹配全部，空文本不匹配非空查询', () => {
  assert.equal(fuzzyScore('任何内容', ''), 1)
  assert.equal(fuzzyFieldsScore(['a', 'b'], '   '), 1)
  assert.equal(fuzzyScore('', 'a'), -1)
  assert.equal(fuzzyScore('a', 'b'), -1)
})
