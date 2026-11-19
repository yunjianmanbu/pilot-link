import test from 'node:test'
import assert from 'node:assert/strict'

import { validateWorkspaceName } from '../lib/workspace-name.js'

test('普通文件夹名可以通过，并去掉首尾空白', () => {
  assert.deepEqual(validateWorkspaceName('  my-project  '), {
    ok: true,
    name: 'my-project',
    error: ''
  })
  assert.equal(validateWorkspaceName('项目 A').ok, true)
})

test('空名称不报错，但也不能提交', () => {
  assert.deepEqual(validateWorkspaceName('   '), { ok: false, name: '', error: '' })
})

test('拒绝路径分隔符和 Windows 非法字符', () => {
  for (const name of ['a/b', 'a\\b', '..', '.', '../escape', 'a:b', 'a?b']) {
    const result = validateWorkspaceName(name)
    assert.equal(result.ok, false, name)
    assert.ok(result.error, name)
  }
})

test('拒绝保留名、结尾点和超长名称', () => {
  for (const name of ['con', 'COM1', 'lpt9.txt', 'name.', 'x'.repeat(65)]) {
    assert.equal(validateWorkspaceName(name).ok, false, name)
  }
})
