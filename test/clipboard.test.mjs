import test from 'node:test'
import assert from 'node:assert/strict'

import { copyText, stageSelectionText, takeSelectionText } from '../lib/clipboard.js'

function makeUni() {
  const storage = new Map()
  return {
    storage,
    uni: {
      setStorageSync(key, value) {
        storage.set(key, value)
      },
      getStorageSync(key) {
        return storage.has(key) ? storage.get(key) : ''
      },
      removeStorageSync(key) {
        storage.delete(key)
      },
      setClipboardData(options) {
        if (options.data === '失败') {
          options.fail && options.fail({ errMsg: 'copy failed' })
          return
        }
        storage.set('clipboard', options.data)
        options.success && options.success()
      }
    }
  }
}

test('选择复制文本暂存后读取一次并清除', () => {
  const { uni, storage } = makeUni()
  globalThis.uni = uni
  assert.equal(stageSelectionText('第一段\n第二段'), true)
  assert.equal(storage.get('pilot-app.select-text.v1'), '第一段\n第二段')
  assert.equal(takeSelectionText(), '第一段\n第二段')
  assert.equal(takeSelectionText(), '')
  assert.equal(storage.has('pilot-app.select-text.v1'), false)
})

test('空文本不会暂存', () => {
  const { uni, storage } = makeUni()
  globalThis.uni = uni
  storage.set('pilot-app.select-text.v1', '旧内容')
  assert.equal(stageSelectionText(''), false)
  assert.equal(storage.has('pilot-app.select-text.v1'), false)
})

test('复制文本写入系统剪贴板', async () => {
  const { uni, storage } = makeUni()
  globalThis.uni = uni
  assert.equal(await copyText('你好，世界'), true)
  assert.equal(storage.get('clipboard'), '你好，世界')
  assert.equal(await copyText(''), false)
  assert.equal(await copyText('失败'), false)
})

test('没有 uni 时回退到浏览器复制', async () => {
  const previousUni = globalThis.uni
  const previousDocument = globalThis.document
  delete globalThis.uni
  const area = {
    value: '',
    style: {},
    parentNode: null,
    setAttribute() {},
    select() {
      area.selected = true
    },
    setSelectionRange() {}
  }
  const body = {
    appendChild(node) {
      node.parentNode = body
    },
    removeChild(node) {
      node.parentNode = null
    }
  }
  globalThis.document = {
    body,
    createElement: () => area,
    execCommand: (command) => command === 'copy' && area.selected === true
  }
  try {
    assert.equal(await copyText('浏览器环境'), true)
    assert.equal(area.value, '浏览器环境')
    assert.equal(area.parentNode, null)
  } finally {
    globalThis.uni = previousUni
    globalThis.document = previousDocument
  }
})
