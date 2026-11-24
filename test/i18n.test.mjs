import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const storage = new Map()
globalThis.uni = {
  getStorageSync: (key) => storage.get(key) || '',
  setStorageSync: (key, value) => storage.set(key, value),
  getLocale: () => 'en-US'
}

const {
  getLocale,
  getLocaleSetting,
  isLocaleSetting,
  normalizeLocaleTag,
  resolveLocale,
  setLocaleSetting,
  t
} = await import('../lib/i18n.js')
const { en } = await import('../lib/locale-en.js')

test('locale tags map to zh-CN or en', () => {
  assert.equal(normalizeLocaleTag('zh'), 'zh-CN')
  assert.equal(normalizeLocaleTag('zh-Hans-CN'), 'zh-CN')
  assert.equal(normalizeLocaleTag('zh_TW'), 'zh-CN')
  assert.equal(normalizeLocaleTag('en-US'), 'en')
  assert.equal(normalizeLocaleTag('fr-FR'), 'en')
  assert.equal(normalizeLocaleTag(''), 'en')
})

test('auto follows the phone while a pinned setting wins', () => {
  assert.equal(resolveLocale('auto', ['en-US']), 'en')
  assert.equal(resolveLocale('auto', ['zh-Hans-CN', 'en-US']), 'zh-CN')
  assert.equal(resolveLocale('en', ['zh-CN']), 'en')
  assert.equal(resolveLocale('zh-CN', ['en-US']), 'zh-CN')
  assert.equal(resolveLocale('auto', []), 'zh-CN')
  assert.equal(isLocaleSetting('auto'), true)
  assert.equal(isLocaleSetting('en'), true)
  assert.equal(isLocaleSetting('fr'), false)
})

test('switching language translates, interpolates and persists', () => {
  assert.equal(getLocale(), 'en')
  assert.equal(t('{v1} 分钟前', { v1: 3 }), '3 minutes ago')
  assert.equal(t('{v1} 个文件', { v1: 2 }), '2 files')
  assert.equal(t('这段文案还没有英文'), '这段文案还没有英文')

  assert.equal(setLocaleSetting('zh-CN'), true)
  assert.equal(getLocaleSetting(), 'zh-CN')
  assert.equal(t('{v1} 分钟前', { v1: 3 }), '3 分钟前')
  assert.equal(storage.get('pilot.locale.v1'), 'zh-CN')

  setLocaleSetting('auto')
  assert.equal(getLocaleSetting(), 'auto')
  assert.equal(getLocale(), 'en')
  assert.equal(t('已连接'), 'Connected')
})

function sourceFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // dist / unpackage 是构建产物，里面压着旧版本的每条文案；把它们算进「源码用到的 key」
    // 会让「字典里有没有多余条目」这项检查永远通过，所以只扫真正的源码。
    if (
      entry.name === 'node_modules' ||
      entry.name === 'unpackage' ||
      entry.name === 'dist' ||
      entry.name.startsWith('.')
    ) {
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(vue|js)$/.test(entry.name)) out.push(full)
  }
  return out
}

function usedKeys() {
  const keys = new Set()
  const cjk = /[\u4e00-\u9fff]/
  for (const file of sourceFiles(path.join(ROOT))) {
    if (file.endsWith('locale-en.js') || file.endsWith(path.join('lib', 'i18n.js'))) continue
    const code = fs.readFileSync(file, 'utf8')
    const re = /\bt\(\s*(["'])((?:\\.|(?!\1)[\s\S])*?)\1\s*[,)]/g
    let match
    while ((match = re.exec(code))) {
      const quote = match[1]
      const text = match[2]
      const key =
        quote === '"'
          ? JSON.parse('"' + text + '"')
          : text.replace(/\\(['"\\n])/g, (m, char) => (char === 'n' ? '\n' : char))
      if (cjk.test(key)) keys.add(key)
    }
  }
  return keys
}

test('English dictionary covers every wrapped string', () => {
  const keys = usedKeys()
  assert.ok(keys.size > 500)
  const missing = [...keys].filter((key) => !(key in en))
  assert.deepEqual(missing, [])
  const extra = Object.keys(en).filter((key) => !keys.has(key))
  assert.deepEqual(extra, [])
})
