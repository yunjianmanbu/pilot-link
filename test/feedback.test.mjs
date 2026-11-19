import assert from 'node:assert/strict'
import test from 'node:test'

const storage = new Map()
globalThis.uni = {
  getStorageSync: (key) => storage.get(key) || '',
  setStorageSync: (key, value) => storage.set(key, value),
  getLocale: () => 'zh-CN',
  getSystemInfoSync: () => ({
    brand: 'Xiaomi',
    model: 'M2007J3SC',
    system: 'Android 13',
    platform: 'android'
  })
}

const {
  FEEDBACK_BODY_MAX,
  FEEDBACK_STORE_KEY,
  FEEDBACK_TITLE_MAX,
  feedbackKindLabel,
  feedbackProblemText,
  formatFeedback,
  formatTimestamp,
  loadFeedbackRecords,
  normalizeFeedback,
  saveFeedback
} = await import('../lib/feedback.js')

test('三种反馈类型都能通过校验并去掉首尾空白', () => {
  for (const kind of ['bug', 'feature', 'suggestion']) {
    const result = normalizeFeedback({ kind, title: '  标题  ', body: ' 内容 ' })
    assert.equal(result.ok, true)
    assert.deepEqual(result.draft, { kind, title: '标题', body: '内容', contact: '' })
  }
})

test('校验失败时返回具体问题而不是抛异常', () => {
  const problem = (input) => {
    const result = normalizeFeedback(input)
    return result.ok ? 'ok' : result.problem
  }
  assert.equal(problem(null), 'kind')
  assert.equal(problem({ kind: 'praise', title: 'a', body: 'b' }), 'kind')
  assert.equal(problem({ kind: 'bug', title: '   ', body: 'b' }), 'title')
  assert.equal(problem({ kind: 'bug', title: 'x'.repeat(FEEDBACK_TITLE_MAX + 1), body: 'b' }), 'titleTooLong')
  assert.equal(problem({ kind: 'bug', title: 'a', body: '' }), 'body')
  assert.equal(problem({ kind: 'bug', title: 'a', body: 'x'.repeat(FEEDBACK_BODY_MAX + 1) }), 'bodyTooLong')
  assert.equal(problem({ kind: 'bug', title: 'a', body: 'b', contact: 'x'.repeat(200) }), 'contactTooLong')
})

test('问题文案带上限数字，类型有对应标签', () => {
  assert.equal(feedbackProblemText('title'), '请填写一句话概括')
  assert.match(feedbackProblemText('titleTooLong'), new RegExp(String(FEEDBACK_TITLE_MAX)))
  assert.match(feedbackProblemText('bodyTooLong'), new RegExp(String(FEEDBACK_BODY_MAX)))
  assert.equal(feedbackProblemText('unknown'), '')
  assert.equal(feedbackKindLabel('bug'), '反馈问题')
  assert.equal(feedbackKindLabel('feature'), '提需求')
  assert.equal(feedbackKindLabel('suggestion'), '提建议')
})

test('保存后能在本地读到，最新一条排在最前面', () => {
  storage.clear()
  const first = saveFeedback({ kind: 'bug', title: '第一条', body: '说明' }, { version: '1.0.40' })
  assert.equal(first.ok, true)
  const second = saveFeedback(
    { kind: 'feature', title: '第二条', body: '想法', contact: 'me@example.com' },
    { version: '1.0.40' }
  )
  assert.equal(second.ok, true)
  const rows = loadFeedbackRecords()
  assert.equal(rows.length, 2)
  assert.equal(rows[0].title, '第二条')
  assert.notEqual(rows[0].id, rows[1].id)
  assert.equal(rows[0].env.version, '1.0.40')
  assert.equal(rows[0].env.system, 'Xiaomi M2007J3SC Android 13')
  assert.equal(storage.has(FEEDBACK_STORE_KEY), true)
})

test('校验失败时不写本地存储', () => {
  storage.clear()
  const result = saveFeedback({ kind: 'bug', title: '', body: '' })
  assert.equal(result.ok, false)
  assert.equal(result.problem, 'title')
  assert.equal(storage.has(FEEDBACK_STORE_KEY), false)
})

test('本地记录上限 50 条，超出后丢掉最旧的', () => {
  storage.clear()
  for (let i = 0; i < 55; i += 1) {
    saveFeedback({ kind: 'suggestion', title: `第 ${i} 条`, body: '内容' })
  }
  const rows = loadFeedbackRecords()
  assert.equal(rows.length, 50)
  assert.equal(rows[0].title, '第 54 条')
  assert.equal(rows.some((row) => row.title === '第 0 条'), false)
})

test('损坏的本地数据不会让页面崩溃', () => {
  storage.set(FEEDBACK_STORE_KEY, '{not json')
  assert.deepEqual(loadFeedbackRecords(), [])
  storage.set(FEEDBACK_STORE_KEY, JSON.stringify([{ title: '有效' }, null, 42]))
  assert.deepEqual(loadFeedbackRecords(), [{ title: '有效' }])
})

test('反馈文本包含类型、正文、环境与编号，无联系方式时省略该行', () => {
  const record = {
    kind: 'feature',
    title: '支持批量删除',
    body: '现在只能一条一条删。',
    contact: '',
    id: 'abc123',
    createdAt: '2026-11-14 02:05',
    env: { version: '1.0.40', platform: 'android', system: 'Xiaomi M2007J3SC Android 13' }
  }
  const text = formatFeedback(record)
  assert.ok(text.startsWith('【提需求】支持批量删除'))
  assert.ok(text.includes('现在只能一条一条删。'))
  assert.ok(text.includes('版本：Pilot 1.0.40 · android · Xiaomi M2007J3SC Android 13'))
  assert.ok(text.includes('编号：abc123'))
  assert.equal(text.includes('联系方式'), false)
  assert.ok(formatFeedback({ ...record, contact: 'me@example.com' }).includes('联系方式：me@example.com'))
})

test('时间戳固定为 YYYY-MM-DD HH:mm', () => {
  assert.equal(formatTimestamp(new Date(2026, 10, 14, 2, 5).getTime()), '2026-11-14 02:05')
  assert.equal(formatTimestamp('not a date'), '')
})
