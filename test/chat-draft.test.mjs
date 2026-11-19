import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(here, '..', 'pages', 'chat', 'index.vue'), 'utf8')

test('会话输入框接入草稿存取，离开页面和切后台都会落盘', () => {
  assert.match(page, /import \{[^}]*clearDraft[^}]*loadDraft[^}]*saveDraft[^}]*\} from '\.\.\/\.\.\/lib\/storage\.js'/)
  assert.match(page, /onHide\(\)\s*\{[^}]*this\.flushDraft\(\)/)
  assert.match(page, /onUnload\(\)\s*\{[^}]*this\.flushDraft\(\)/)
  assert.match(page, /saveDraft\(this\.draftKey, \{ text: this\.draft, references: this\.references \}\)/)
})

test('进入会话时恢复对应草稿，切换会话时先保存旧草稿', () => {
  assert.match(page, /draftKeyForCurrent\(\)\s*\{[\s\S]*?session:\$\{sessionId\}[\s\S]*?new:\$\{cwd\}/)
  assert.match(page, /this\.restoreDraft\(this\.draftKeyForCurrent\(\)\)/)
  assert.match(
    page,
    /'store\.currentSessionId'\(id\) \{[\s\S]*?const keepDraft = this\.sendInFlight[\s\S]*?this\.flushDraft\(\)[\s\S]*?this\.restoreDraft\(this\.draftKey\)/
  )
})

test('发送过程不覆盖正在发送的文字，发送成功后清掉新旧草稿', () => {
  assert.match(page, /const keepDraft = this\.sendInFlight/)
  assert.match(page, /if \(keepDraft\) this\.queueDraftSave\(this\.draft, true\)/)
  assert.match(page, /const sendingKey = this\.draftKey[\s\S]*?this\.sendInFlight = true[\s\S]*?clearDraft\(sendingKey\)[\s\S]*?clearDraft\(this\.draftKey\)/)
})
