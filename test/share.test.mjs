/**
 * 系统分享的纯逻辑测试：文本整理、拼装、截断、时间格式化、分享/复制回退。
 * 页面接线用源码断言兜住，防止以后改模板把入口删掉。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SHARE_TEXT_LIMIT,
  canShareWithSystem,
  clipShareText,
  formatShareText,
  looksLikeMissingModule,
  normalizeShareText,
  resetShareModuleState,
  shareText,
  shareTimeLabel
} from '../lib/share.js'
import { ensureShareFeature, SHARE_FEATURE_ENTRY } from '../scripts/android-share-feature.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

test('normalizeShareText 统一换行并折叠多余空行', () => {
  assert.equal(normalizeShareText('  a\r\n\r\n\r\nb  '), 'a\n\nb')
  assert.equal(normalizeShareText(null), '')
  assert.equal(normalizeShareText(undefined), '')
  assert.equal(normalizeShareText('   '), '')
})

test('clipShareText 在上限内原样返回，超长才截断并标记', () => {
  const short = clipShareText('短文本', 100)
  assert.deepEqual(short, { text: '短文本', truncated: false })

  const long = clipShareText('长'.repeat(20), 10)
  assert.equal(long.truncated, true)
  assert.ok(long.text.startsWith('长'.repeat(10)))
  assert.ok(long.text.length > 10)

  // 非法的上限按默认值处理，不会把内容清空。
  const fallback = clipShareText('a'.repeat(SHARE_TEXT_LIMIT + 10), 0)
  assert.equal(fallback.truncated, true)
})

test('formatShareText 拼标题、条目与落款，跳过空正文', () => {
  const result = formatShareText({
    heading: '会话标题',
    entries: [
      { label: '我', time: '2026-11-15 09:12', text: '第一条' },
      { label: '助手', time: '', text: '第二条\n\n\n第三段' },
      { label: '助手', text: '   ' },
      null
    ],
    footer: '来自 Pilot 手机端'
  })
  assert.equal(result.count, 2)
  assert.equal(result.truncated, false)
  assert.equal(
    result.text,
    ['会话标题', '我 · 2026-11-15 09:12\n第一条', '助手\n第二条\n\n第三段', '来自 Pilot 手机端'].join('\n\n')
  )
})

test('formatShareText 只有正文时也不会出现空行开头', () => {
  const result = formatShareText({ entries: [{ text: '只有正文' }] })
  assert.equal(result.text, '只有正文')
  assert.equal(formatShareText({}).text, '')
})

test('shareTimeLabel 支持 ISO 与毫秒时间戳，认不出返回空串', () => {
  const iso = shareTimeLabel('2026-11-15T01:12:00')
  assert.match(iso, /^2026-11-15 0[12]:12$/)
  const stamp = new Date(2026, 10, 15, 9, 5).getTime()
  assert.equal(shareTimeLabel(stamp), '2026-11-15 09:05')
  assert.equal(shareTimeLabel(''), '')
  assert.equal(shareTimeLabel('不是时间'), '')
  assert.equal(shareTimeLabel(null), '')
})

test('canShareWithSystem 识别 uni.shareWithSystem 与 plus.share', () => {
  assert.equal(canShareWithSystem({ shareWithSystem() {} }), true)
  assert.equal(canShareWithSystem({ uni: { shareWithSystem() {} } }), true)
  assert.equal(canShareWithSystem({ plus: { share: { sendWithSystem() {} } } }), true)
  assert.equal(canShareWithSystem({}), false)
  assert.equal(canShareWithSystem(null), false)
})

test('不传 api 时用运行时的全局 uni / plus', async () => {
  const calls = []
  const previous = globalThis.uni
  globalThis.uni = {
    shareWithSystem(payload) {
      calls.push(payload.summary)
      payload.success()
    }
  }
  try {
    const result = await shareText('全局 uni 分享', { copy: async () => false })
    assert.equal(result.ok, true)
    assert.deepEqual(calls, ['全局 uni 分享'])
  } finally {
    if (previous === undefined) delete globalThis.uni
    else globalThis.uni = previous
  }
})

test('shareText 交给系统分享面板并带上链接', async () => {
  const calls = []
  const result = await shareText('内容', {
    url: 'https://pilot.medpilot.cc/',
    api: {
      shareWithSystem(payload) {
        calls.push(payload)
        payload.success()
      }
    }
  })
  assert.equal(result.ok, true)
  assert.equal(result.copied, false)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].summary, '内容')
  assert.equal(calls[0].href, 'https://pilot.medpilot.cc/')
})

test('shareText 在无分享面板时退回剪贴板', async () => {
  let copiedValue = ''
  const result = await shareText('  备用内容 \r\n', {
    api: {},
    copy: async (value) => {
      copiedValue = value
      return true
    }
  })
  assert.equal(result.ok, false)
  assert.equal(result.copied, true)
  assert.equal(result.reason, 'copied')
  assert.equal(copiedValue, '备用内容')
})

test('shareText 复制失败与空内容都有明确原因', async () => {
  const failed = await shareText('内容', { api: {}, copy: async () => false })
  assert.equal(failed.copied, false)
  assert.equal(failed.reason, 'copy-failed')

  const empty = await shareText('   ', { api: {}, copy: async () => true })
  assert.equal(empty.ok, false)
  assert.equal(empty.reason, 'empty')
})

test('shareText 用户取消分享时不改写剪贴板', async () => {
  let copied = false
  const result = await shareText('内容', {
    api: {
      shareWithSystem(payload) {
        payload.fail({ errMsg: 'shareWithSystem:fail cancel' })
        payload.complete()
      }
    },
    copy: async () => {
      copied = true
      return true
    }
  })
  assert.equal(result.ok, false)
  assert.equal(result.copied, false)
  assert.equal(result.reason, 'cancelled')
  assert.equal(copied, false)
})

test('shareText 分享抛异常时也退回剪贴板', async () => {
  const result = await shareText('内容', {
    api: {
      shareWithSystem() {
        throw new Error('not supported')
      }
    },
    copy: async () => true
  })
  assert.equal(result.copied, true)
  assert.equal(result.text, '内容')
})

test('任务会话不再提供分享入口，应用分享只保留在设置页', () => {
  const chat = fs.readFileSync(path.join(root, 'pages', 'chat', 'index.vue'), 'utf8')
  // 分享只分享应用，不把任务内容带出去：聊天页和单条消息都不再出现分享入口。
  assert.doesNotMatch(chat, /lib\/share\.js/)
  assert.doesNotMatch(chat, /shareMessage/)
  assert.doesNotMatch(chat, /shareSession/)
  assert.doesNotMatch(chat, /t\('分享'\)/)

  const settings = fs.readFileSync(path.join(root, 'pages', 'settings', 'index.vue'), 'utf8')
  assert.match(settings, /from '\.\.\/\.\.\/lib\/share\.js'/)
  assert.match(settings, /async shareApp\(/)
})

test('基座缺 Share 模块时当成不支持，不抛错也不落到 uni 包装', async () => {  let uniCalled = false
  const result = await shareText('内容', {
    api: {
      plus: {
        get share() {
          throw new Error('打包时未加入 share 模块')
        }
      },
      // 真实基座里 uni 一直在；它就是 plus.share 的包装，缺模块时调用会抛错。
      uni: {
        shareWithSystem() {
          uniCalled = true
          throw new Error('打包时未加入 share 模块')
        }
      }
    },
    copy: async () => true
  })
  assert.equal(uniCalled, false)
  assert.equal(result.ok, false)
  assert.equal(result.copied, true)
  assert.equal(result.reason, 'copied')
  assert.equal(canShareWithSystem({ plus: {} }), false)
  assert.equal(canShareWithSystem({ plus: { share: {} } }), false)
})

test('plus.share 可用时走系统分享面板，而不是 uni 包装', async () => {
  const calls = []
  const result = await shareText('内容', {
    api: {
      plus: {
        share: {
          sendWithSystem(payload) {
            calls.push(payload)
            payload.success()
          }
        }
      },
      uni: {
        shareWithSystem() {
          throw new Error('不应走到 uni 包装')
        }
      }
    }
  })
  assert.equal(result.ok, true)
  assert.equal(result.reason, 'shared')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].content, '内容')
})

test('looksLikeMissingModule 只认「未加入 share 模块」，其它错误不算', () => {
  assert.equal(looksLikeMissingModule(new Error('打包时未加入 share 模块')), true)
  assert.equal(looksLikeMissingModule({ errMsg: 'share 模块不存在' }), true)
  assert.equal(looksLikeMissingModule(new Error('用户取消了分享')), false)
  assert.equal(looksLikeMissingModule({ errMsg: 'sendWithSystem:fail' }), false)
  assert.equal(looksLikeMissingModule(null), false)
})

test('基座没打 Share 模块时退回剪贴板，并记住不再重试', async () => {
  resetShareModuleState()
  let calls = 0
  const api = {
    plus: {
      share: {
        sendWithSystem() {
          calls += 1
          throw new Error('打包时未加入 share 模块')
        }
      }
    }
  }
  const copied = []
  const copy = async (text) => {
    copied.push(text)
    return true
  }

  const first = await shareText('第一段', { api, copy })
  assert.equal(first.ok, false)
  assert.equal(first.reason, 'copied')
  assert.deepEqual(copied, ['第一段'])
  assert.equal(calls, 1)

  // 第二次不再白试一遍原生接口。
  const second = await shareText('第二段', { api, copy })
  assert.equal(second.reason, 'copied')
  assert.equal(calls, 1, '已知缺模块后仍去调了 plus.share')
  resetShareModuleState()
})

test('dcloud_properties.xml 补上 Share feature，且重复执行不再重复插入', () => {
  const base = '<properties>\n\t<features>\n\t\t<feature name="Barcode" value="x"/>\n\t</features>\n</properties>\n'
  const once = ensureShareFeature(base)
  assert.equal(once.changed, true)
  assert.equal(once.xml.split('name="Share"').length - 1, 1)
  assert.ok(once.xml.includes(SHARE_FEATURE_ENTRY.trim()))
  // Share 必须落在 <features> 里，而不是文件末尾。
  assert.ok(once.xml.indexOf('name="Share"') < once.xml.indexOf('</features>'))

  const twice = ensureShareFeature(once.xml)
  assert.equal(twice.changed, false)
  assert.equal(twice.xml, once.xml)

  assert.throws(() => ensureShareFeature('<properties></properties>'), /<features>/)
})

test('打包清单带 Share 模块，头部把次要入口收进更多气泡', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
  const modules = manifest['app-plus']?.modules || {}
  assert.ok(modules.Share, 'manifest 缺 Share 模块，云打包后 plus.share 仍不存在')

  const chat = fs.readFileSync(path.join(root, 'pages', 'chat', 'index.vue'), 'utf8')
  const start = chat.indexOf('<view class="topbar">')
  const end = chat.indexOf('<view v-if="bannerText"', start)
  assert.ok(start >= 0 && end > start, '找不到聊天页头部')
  const topbar = chat.slice(start, end)
  assert.ok(!/files-btn/.test(topbar), '头部还塞着分享/知识/文件三个 chip')
  assert.match(topbar, /class="more-btn"/)
  // 三个点必须用实心圆排版，不能再用字体里的「⋯」：不同系统的字形基线
  // 不一致，和暂停/停止胶囊的中点对不齐。
  assert.match(topbar, /class="more-dot"/)
  assert.ok(!/⋯/.test(topbar), '更多按钮又用回字体的省略号')
  const moreCss = chat.slice(chat.indexOf('.more-btn {'), chat.indexOf('}', chat.indexOf('.more-btn {')))
  assert.match(moreCss, /align-items:\s*center/, '更多按钮没有垂直居中')
  assert.match(moreCss, /height:\s*var\(--btn-h-xs\)/, '更多按钮高度没跟胶囊统一')
  assert.match(chat, /\.more-dot\s*\{[^}]*border-radius:\s*50%/, '三个点不是圆点')

  // 点 ⋯ 出气泡列表（锚在按钮下方 + 遮罩点外部关闭），不再弹底部抽屉。
  assert.match(topbar, /class="more-pop"/, '头部没有气泡容器')
  assert.match(topbar, /class="more-item"/, '气泡里没有菜单项')
  assert.match(topbar, /class="more-mask" @click="moreOpen = false"/, '气泡缺点击外部关闭的遮罩')
  assert.match(topbar, /@click="toggleMore"/, '⋯ 不再是开关')
  assert.ok(
    !/:options="moreOptions"/.test(chat),
    '「更多」还挂在 app-picker 底部弹层上'
  )
  assert.match(chat, /onMorePick\(index\)/)
})

/* ── 网页版（H5 / PWA）：navigator.share ─────────────────────────────── */

test('网页版用 navigator.share 打开系统分享面板，并带上链接', async () => {
  resetShareModuleState()
  const calls = []
  const result = await shareText('网页版内容', {
    url: 'https://pilot.medpilot.cc/',
    api: {
      navigator: {
        share(payload) {
          calls.push(payload)
          return Promise.resolve()
        }
      }
    }
  })
  assert.equal(result.ok, true)
  assert.equal(result.copied, false)
  assert.deepEqual(calls, [{ text: '网页版内容', url: 'https://pilot.medpilot.cc/' }])
})

test('网页版用户取消分享时不写剪贴板', async () => {
  resetShareModuleState()
  let copied = false
  const abort = Object.assign(new Error('share cancelled'), { name: 'AbortError' })
  const result = await shareText('内容', {
    api: { navigator: { share: () => Promise.reject(abort) } },
    copy: async () => {
      copied = true
      return true
    }
  })
  assert.equal(result.ok, false)
  assert.equal(result.copied, false)
  assert.equal(result.reason, 'cancelled')
  assert.equal(copied, false, '用户取消后不应该偷偷改写剪贴板')
})

test('网页版分享失败时退回剪贴板', async () => {
  resetShareModuleState()
  const result = await shareText('内容', {
    api: {
      navigator: {
        share: () => Promise.reject(new Error('NotAllowedError'))
      }
    },
    copy: async () => true
  })
  assert.equal(result.ok, false)
  assert.equal(result.copied, true)
  assert.equal(result.reason, 'copied')
})

test('桌面浏览器没有 navigator.share 时直接走剪贴板', async () => {
  resetShareModuleState()
  const result = await shareText('内容', {
    api: { navigator: {} },
    copy: async () => true
  })
  assert.equal(result.copied, true)
  assert.equal(result.reason, 'copied')
})
