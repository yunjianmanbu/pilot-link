import assert from 'node:assert/strict'
import test from 'node:test'

// storage.js 直接使用全局 uni API；用一个内存版 localStorage 模拟 App 端存储。
const memory = new Map()
globalThis.uni = {
  getStorageSync(key) {
    return memory.has(key) ? memory.get(key) : ''
  },
  setStorageSync(key, value) {
    memory.set(key, value)
  },
  removeStorageSync(key) {
    memory.delete(key)
  },
  getSystemInfoSync() {
    return { brand: 'Test', model: 'Phone' }
  }
}

const storage = await import('../lib/storage.js')

const PAIRING_KEY = 'pilot-app.pairing.v1'
const PAIRINGS_KEY = 'pilot-app.pairings.v2'
const THEME_KEY = 'pilot-app.theme.v1'
const FONT_SIZE_KEY = 'pilot-app.font-size.v1'
const ACCENT_KEY = 'pilot-app.accent.v1'
const CONTRAST_KEY = 'pilot-app.contrast.v1'
const SATURATION_KEY = 'pilot-app.saturation.v1'
const SESSIONS_KEY = 'pilot-app.sessions-cache.v1'
const UNREAD_KEY = 'pilot-app.unread.v1'

function makePairing(overrides = {}) {
  return {
    v: 1,
    relayUrl: 'wss://relay.example/ws',
    deviceId: 'device-a',
    deviceName: '电脑 A',
    phoneId: 'phone-12345678',
    phoneName: '测试手机',
    token: 't'.repeat(32),
    keys: { pcToPhone: 'p'.repeat(43), phoneToPc: 'q'.repeat(43) },
    outSeq: 1,
    inSeq: 1,
    pairedAt: Date.now(),
    lastActiveAt: Date.now(),
    ...overrides
  }
}

function reset() {
  memory.clear()
}

test('未查看标记按电脑保存，非法状态会被过滤', () => {
  reset()
  storage.saveUnreadSessions('device-a', {
    s1: { status: 'done', at: 100 },
    s2: { status: 'failed', at: 200 },
    s3: { status: 'unknown', at: 300 },
    '': { status: 'done', at: 400 }
  })
  assert.deepEqual(storage.loadUnreadSessions('device-a'), {
    s1: { status: 'done', at: 100 },
    s2: { status: 'failed', at: 200 }
  })
  // 另一台电脑的标记互不影响。
  assert.deepEqual(storage.loadUnreadSessions('device-b'), {})
})

test('未查看标记超过上限时只保留最近的任务', () => {
  reset()
  const sessions = {}
  for (let index = 0; index < 210; index += 1) {
    sessions[`s${index}`] = { status: 'done', at: index + 1 }
  }
  storage.saveUnreadSessions('device-a', sessions)
  const loaded = storage.loadUnreadSessions('device-a')
  assert.equal(Object.keys(loaded).length, 200)
  assert.equal(loaded.s0, undefined)
  assert.equal(loaded.s209.at, 210)
})

test('清空全部标记与解绑电脑都会删除未查看记录', () => {
  reset()
  storage.saveUnreadSessions('device-a', { s1: { status: 'done', at: 1 } })
  assert.ok(memory.has(`${UNREAD_KEY}.device-a`))
  storage.saveUnreadSessions('device-a', {})
  assert.equal(memory.has(`${UNREAD_KEY}.device-a`), false)

  storage.saveUnreadSessions('device-b', { s2: { status: 'failed', at: 2 } })
  storage.clearOfflineCache('device-b')
  assert.deepEqual(storage.loadUnreadSessions('device-b'), {})
})

test('单配对存储会迁移成多电脑集合', () => {
  reset()
  const pairing = makePairing()
  memory.set(PAIRING_KEY, JSON.stringify(pairing))
  const data = storage.loadPairings()
  assert.equal(data.v, 2)
  assert.equal(data.activeId, 'device-a')
  assert.equal(data.items.length, 1)
  assert.equal(data.items[0].deviceName, '电脑 A')
  // 迁移后写入新键并删除旧键，后续升级不会重复迁移。
  assert.equal(memory.has(PAIRING_KEY), false)
  assert.ok(memory.has(PAIRINGS_KEY))
})

test('多电脑集合会去重并回退到第一台作为当前电脑', () => {
  reset()
  const data = storage.normalizePairingCollection({
    v: 2,
    activeId: 'missing',
    items: [
      makePairing({ deviceId: 'device-a' }),
      makePairing({ deviceId: 'device-a', deviceName: '重复 A' }),
      makePairing({ deviceId: 'device-b', deviceName: '电脑 B' }),
      { nope: true }
    ]
  })
  assert.equal(data.activeId, 'device-a')
  assert.deepEqual(
    data.items.map((item) => item.deviceId),
    ['device-a', 'device-b']
  )
})

test('新增电脑不改变当前电脑，切换与移除按预期工作', () => {
  reset()
  assert.equal(storage.savePairing(makePairing({ deviceId: 'device-a' })), true)
  assert.equal(storage.savePairing(makePairing({ deviceId: 'device-b' })), true)
  assert.equal(storage.loadPairings().activeId, 'device-a')

  let data = storage.setActivePairing('device-b')
  assert.equal(data.activeId, 'device-b')
  assert.equal(storage.loadPairing().deviceId, 'device-b')

  data = storage.removePairing('device-b')
  assert.equal(data.activeId, 'device-a')
  assert.deepEqual(
    data.items.map((item) => item.deviceId),
    ['device-a']
  )
})

test('主题模式只接受 system / light / dark', () => {
  reset()
  assert.equal(storage.loadThemeMode(), 'system')
  storage.saveThemeMode('light')
  assert.equal(storage.loadThemeMode(), 'light')
  storage.saveThemeMode('dark')
  assert.equal(storage.loadThemeMode(), 'dark')
  storage.saveThemeMode('purple')
  assert.equal(storage.loadThemeMode(), 'system')
  assert.equal(memory.get(THEME_KEY), 'system')
})

test('字号只接受 standard / large / xlarge，默认标准', () => {
  reset()
  assert.equal(storage.loadFontSize(), 'standard')
  storage.saveFontSize('large')
  assert.equal(storage.loadFontSize(), 'large')
  storage.saveFontSize('xlarge')
  assert.equal(storage.loadFontSize(), 'xlarge')
  storage.saveFontSize('huge')
  assert.equal(storage.loadFontSize(), 'standard')
  assert.equal(memory.get(FONT_SIZE_KEY), 'standard')
})

test('对比度与饱和度只接受 low / standard / high，默认标准', () => {
  reset()
  assert.equal(storage.loadContrast(), 'standard')
  assert.equal(storage.loadSaturation(), 'standard')
  storage.saveContrast('low')
  storage.saveSaturation('high')
  assert.equal(storage.loadContrast(), 'low')
  assert.equal(storage.loadSaturation(), 'high')
  storage.saveContrast('high')
  storage.saveSaturation('low')
  assert.equal(storage.loadContrast(), 'high')
  assert.equal(storage.loadSaturation(), 'low')
  storage.saveContrast('ultra')
  storage.saveSaturation('dim')
  assert.equal(storage.loadContrast(), 'standard')
  assert.equal(storage.loadSaturation(), 'standard')
  assert.equal(memory.get(CONTRAST_KEY), 'standard')
  assert.equal(memory.get(SATURATION_KEY), 'standard')
})

test('对比度与饱和度读取会过滤手改的存储值', () => {
  reset()
  memory.set(CONTRAST_KEY, 'HIGH')
  memory.set(SATURATION_KEY, 1)
  assert.equal(storage.loadContrast(), 'standard')
  assert.equal(storage.loadSaturation(), 'standard')
})

test('主题配色只接受内置预设', () => {
  reset()
  assert.equal(storage.loadAccent(), 'graphite')
  storage.saveAccent('pine')
  assert.equal(storage.loadAccent(), 'pine')
  storage.saveAccent('clay')
  assert.equal(storage.loadAccent(), 'clay')
  storage.saveAccent('ocean')
  assert.equal(storage.loadAccent(), 'ocean')
  storage.saveAccent('rose')
  assert.equal(storage.loadAccent(), 'rose')
  storage.saveAccent('orange')
  assert.equal(storage.loadAccent(), 'orange')
  storage.saveAccent('celadon')
  assert.equal(storage.loadAccent(), 'celadon')
  storage.saveAccent('claude')
  assert.equal(storage.loadAccent(), 'claude')
  storage.saveAccent('neon')
  assert.equal(storage.loadAccent(), 'graphite')
  assert.equal(memory.get(ACCENT_KEY), 'graphite')
})

test('会话缓存按电脑分开保存，旧缓存迁移给第一台电脑', () => {
  reset()
  const sessions = [
    { id: 's1', title: 'A 的会话', cwd: 'E:\\a' },
    { id: 's2', title: 'B 的会话', cwd: 'E:\\b' }
  ]
  storage.saveSessionsCache('device-a', sessions, ['E:\\a'])
  const a = storage.loadSessionsCache('device-a')
  assert.equal(a.sessions.length, 2)
  assert.deepEqual(a.roots, ['E:\\a'])
  assert.equal(storage.loadSessionsCache('device-b'), null)

  // 1.0.10 及之前的缓存没有 deviceId 后缀，第一次读取时迁移给当前电脑。
  reset()
  memory.set(
    SESSIONS_KEY,
    JSON.stringify({ v: 1, at: Date.now(), sessions, roots: ['E:\\a'] })
  )
  const migrated = storage.loadSessionsCache('device-a')
  assert.equal(migrated.sessions.length, 2)
  assert.equal(memory.has(SESSIONS_KEY), false)
  assert.ok(memory.has(`${SESSIONS_KEY}.device-a`))

  storage.clearSessionsCache('device-a')
  assert.equal(storage.loadSessionsCache('device-a'), null)
})

test('待办缓存按电脑与会话分开保存，并保留已发送状态', () => {
  reset()
  const todos = [
    { id: 't1', text: '检查构建', status: 'pending', createdAt: 1, offline: false },
    {
      id: 't2',
      text: '部署',
      status: 'sent',
      createdAt: 2,
      sentAt: 3,
      sentRunId: 'run-1',
      sentQueueId: '',
      source: 'pc',
      offline: false
    }
  ]
  assert.equal(storage.saveTodosCache('device-a', 's1', todos), true)
  assert.equal(storage.saveTodosCache('device-a', 's2', [{ id: 't3', text: '另一会话' }]), true)
  const loaded = storage.loadTodosCache('device-a', 's1')
  assert.equal(loaded.length, 2)
  assert.equal(loaded[1].status, 'sent')
  assert.equal(loaded[1].sentRunId, 'run-1')
  assert.equal(loaded[1].source, 'pc')
  assert.equal(storage.loadTodosCache('device-a', 'missing').length, 0)
  assert.equal(storage.loadTodosCache('device-b', 's1').length, 0)

  storage.clearTodosCache('device-a')
  assert.equal(storage.loadTodosCache('device-a', 's1').length, 0)
})

test('全部任务的分组缓存按设备落盘，冷启动读回同样的结构', () => {
  reset()
  const key = 'pilot-app.scheduled-cache.v1.device-a'
  const groups = [
    {
      sessionId: 's1',
      sessionTitle: '会话一',
      workspacePath: 'E:/proj',
      missing: false,
      tasks: [
        {
          id: 't1',
          sessionId: 's1',
          content: '每 30 分钟看看日志',
          kind: 'interval',
          intervalMinutes: 30,
          nextRunAt: '2026-03-01T01:00:00.000Z',
          enabled: true,
          extra: '白名单外的字段应被丢掉'
        }
      ]
    },
    // 没有任务的组不占位置，读回来时也不会变成空标题。
    { sessionId: 's2', tasks: [] }
  ]
  assert.equal(storage.saveScheduledCache('device-a', groups), true)
  assert.ok(memory.has(key))

  const loaded = storage.loadScheduledCache('device-a')
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].sessionId, 's1')
  assert.equal(loaded[0].tasks.length, 1)
  assert.equal(loaded[0].tasks[0].content, '每 30 分钟看看日志')
  assert.equal(loaded[0].tasks[0].intervalMinutes, 30)
  // 只存弹层要渲染的字段，别把整份电脑端返回对象堆进 storage。
  assert.equal(loaded[0].tasks[0].extra, undefined)
  // 换一台电脑读不到别人的任务。
  assert.deepEqual(storage.loadScheduledCache('device-b'), [])

  // 存空列表等于「没有可显示的」，键要删掉，别留一份空壳。
  assert.equal(storage.saveScheduledCache('device-a', []), true)
  assert.equal(memory.has(key), false)
  assert.deepEqual(storage.loadScheduledCache('device-a'), [])
})

test('定时任务缓存超过 7 天或版本不符时视为没读到', () => {
  reset()
  const key = 'pilot-app.scheduled-cache.v1.device-a'
  const groups = [
    { sessionId: 's1', tasks: [{ id: 't1', content: '任务', kind: 'interval' }] }
  ]
  storage.saveScheduledCache('device-a', groups)
  const raw = JSON.parse(memory.get(key))
  raw.at = Date.now() - 8 * 24 * 60 * 60 * 1000
  memory.set(key, JSON.stringify(raw))
  assert.deepEqual(storage.loadScheduledCache('device-a'), [])

  storage.saveScheduledCache('device-a', groups)
  const stale = JSON.parse(memory.get(key))
  stale.v = 99
  memory.set(key, JSON.stringify(stale))
  assert.deepEqual(storage.loadScheduledCache('device-a'), [])
})

test('离线待办按设备持久化，空列表会删除存储键', () => {
  reset()
  const key = 'pilot-app.offline-todos.v1.device-a'
  const items = [
    { id: 'local-1', sessionId: 's1', text: '断网时记的待办', createdAt: 10 },
    { id: 'local-2', sessionId: 's2', text: '另一条', createdAt: 11 }
  ]
  assert.equal(storage.saveOfflineTodos('device-a', items), true)
  assert.ok(memory.has(key))
  const loaded = storage.loadOfflineTodos('device-a')
  assert.deepEqual(
    loaded.map((item) => item.id),
    ['local-1', 'local-2']
  )
  assert.equal(loaded[0].text, '断网时记的待办')
  // 缺少会话或正文的脏数据会被忽略。
  storage.saveOfflineTodos('device-b', [{ id: 'x', text: '缺少会话' }, ...items])
  assert.equal(storage.loadOfflineTodos('device-b').length, 2)

  storage.saveOfflineTodos('device-a', [])
  assert.equal(memory.has(key), false)
  assert.deepEqual(storage.loadOfflineTodos('device-a'), [])
})

test('会话正文缓存只保留最近消息，断网时可回读', () => {
  reset()
  const messages = Array.from({ length: 30 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 ? 'assistant' : 'user',
    blocks: [{ type: 'text', text: `消息 ${index}` }]
  }))
  assert.equal(storage.saveHistoryCache('device-a', 's1', messages, 'before-1', { id: 's1' }), true)
  const cached = storage.loadHistoryCache('device-a', 's1')
  assert.equal(cached.messages.length, 25)
  assert.equal(cached.messages[0].id, 'm5')
  assert.equal(cached.messages[24].id, 'm29')
  assert.equal(cached.nextBefore, 'before-1')
  assert.equal(cached.session.id, 's1')
  assert.equal(storage.loadHistoryCache('device-a', 'missing'), null)
  // 知识库离线检索会一次读取这台手机上缓存的所有会话正文。
  assert.equal(storage.loadHistoryCacheAll('device-a').s1.messages.length, 25)

  storage.clearHistoryCache('device-a')
  assert.equal(storage.loadHistoryCache('device-a', 's1'), null)
})

test('会话知识库缓存按电脑保存，断网后可回读并限制条数', () => {
  reset()
  const pairs = Array.from({ length: 90 }, (_, index) => ({
    key: `pair-${index}`,
    index: index + 1,
    instructionId: `u${index}`,
    instruction: `指令 ${index}`,
    replyId: `a${index}`,
    reply: `回复 ${index}`,
    replyCount: 1
  }))
  assert.equal(
    storage.saveKnowledgeCache('device-a', 's1', { pairs, total: 90, hasMore: false }),
    true
  )
  const cached = storage.loadKnowledgeCache('device-a', 's1')
  // 只保留最近 80 对，避免单会话知识库无限膨胀。
  assert.equal(cached.pairs.length, 80)
  assert.equal(cached.pairs[0].index, 11)
  assert.equal(cached.total, 90)
  assert.equal(cached.hasMore, false)
  // 另一台电脑的缓存互不影响。
  assert.equal(storage.loadKnowledgeCache('device-b', 's1'), null)
  assert.equal(storage.loadKnowledgeCache('device-a', 'missing'), null)

  storage.clearKnowledgeCache('device-a')
  assert.equal(storage.loadKnowledgeCache('device-a', 's1'), null)
})

test('会话知识库缓存会截断超长回复并清理过旧数据', () => {
  reset()
  const long = 'x'.repeat(20_000)
  storage.saveKnowledgeCache('device-a', 's1', {
    pairs: [{ key: 'p1', index: 1, instruction: '问题', reply: long }],
    total: 1
  })
  const cached = storage.loadKnowledgeCache('device-a', 's1')
  assert.equal(cached.pairs[0].reply.length, 12_000)

  const key = 'pilot-app.knowledge-cache.v1.device-a'
  const raw = JSON.parse(memory.get(key))
  raw.at = Date.now() - 8 * 24 * 60 * 60 * 1000
  memory.set(key, JSON.stringify(raw))
  assert.equal(storage.loadKnowledgeCache('device-a', 's1'), null)
})

test('解除电脑时一次性清掉待办、离线队列、正文与知识库缓存', () => {
  reset()
  storage.saveTodosCache('device-a', 's1', [{ id: 't1', text: '待办' }])
  storage.saveScheduledCache('device-a', [
    { sessionId: 's1', tasks: [{ id: 'st1', content: '定时', kind: 'interval' }] }
  ])
  storage.saveOfflineTodos('device-a', [
    { id: 'local-1', sessionId: 's1', text: '离线待办', createdAt: 1 }
  ])
  storage.saveHistoryCache('device-a', 's1', [{ id: 'm1', role: 'user', blocks: [] }], null, null)
  storage.saveKnowledgeCache('device-a', 's1', {
    pairs: [{ key: 'p1', index: 1, instruction: '问题', reply: '回复' }]
  })
  storage.clearOfflineCache('device-a')
  assert.equal(storage.loadTodosCache('device-a', 's1').length, 0)
  assert.deepEqual(storage.loadScheduledCache('device-a'), [])
  assert.deepEqual(storage.loadOfflineTodos('device-a'), [])
  assert.equal(storage.loadHistoryCache('device-a', 's1'), null)
  assert.equal(storage.loadKnowledgeCache('device-a', 's1'), null)
})

test('超过 7 天未活动的配对会被本地判定为过期', () => {
  reset()
  const old = makePairing({
    pairedAt: Date.now() - storage.PAIRING_IDLE_MS - 1000,
    lastActiveAt: Date.now() - storage.PAIRING_IDLE_MS - 1000
  })
  const fresh = makePairing()
  assert.equal(storage.pairingExpiredLocally(old), true)
  assert.equal(storage.pairingExpiredLocally(fresh), false)
})

test('配对信息保留局域网直连地址，并兼容旧数据', () => {
  reset()
  const direct = storage.normalizePairing(
    makePairing({
      relayUrl: 'ws://192.168.1.8:47831/ws',
      relayWrapped: false,
      fallbackUrl: 'wss://relay.example/ws',
      fallbackWrapped: true,
      lanUrls: ['ws://192.168.1.8:47831/ws', 'ws://10.0.0.5:47831/ws']
    })
  )
  assert.deepEqual(direct.lanUrls, [
    'ws://192.168.1.8:47831/ws',
    'ws://10.0.0.5:47831/ws'
  ])
  assert.equal(direct.relayWrapped, false)

  // 没有 lanUrls 字段的旧数据：私有地址视为直连。
  const legacyLan = storage.normalizePairing(
    makePairing({ relayUrl: 'ws://192.168.1.9:47831/ws', room: '', roomKey: '' })
  )
  assert.deepEqual(legacyLan.lanUrls, ['ws://192.168.1.9:47831/ws'])

  // 有房间号但没有 relayWrapped 的旧数据是云端配对，不能误判成直连。
  const legacyRelay = storage.normalizePairing(
    makePairing({ room: 'room-1', roomKey: 'key-1' })
  )
  assert.equal(legacyRelay.relayWrapped, true)
  assert.deepEqual(legacyRelay.lanUrls, [])

  reset()
  assert.equal(storage.savePairing(direct), true)
  assert.deepEqual(storage.loadPairing().lanUrls, direct.lanUrls)
})

test('输入框草稿按会话保存，重新进入可恢复', () => {
  reset()
  assert.equal(storage.loadDraft('session:s1'), null)
  assert.equal(storage.saveDraft('session:s1', { text: '帮我修一下测试', references: ['/work/a', '/work/a', '  '] }), true)
  assert.deepEqual(storage.loadDraft('session:s1').references, ['/work/a'])
  assert.equal(storage.loadDraft('session:s1').text, '帮我修一下测试')
  // 不同会话互不影响。
  assert.equal(storage.loadDraft('session:s2'), null)
})

test('草稿为空时删除，避免旧内容反复预填', () => {
  reset()
  storage.saveDraft('session:s1', { text: '临时内容' })
  assert.equal(storage.clearDraft('session:s1'), true)
  assert.equal(storage.loadDraft('session:s1'), null)

  storage.saveDraft('session:s1', { text: '   ', references: [] })
  assert.equal(storage.loadDraft('session:s1'), null)
  storage.saveDraft('session:s1', { text: '有内容', references: [] })
  storage.saveDraft('session:s1', { text: '', references: ['/work/a'] })
  assert.equal(storage.loadDraft('session:s1').text, '')
  assert.deepEqual(storage.loadDraft('session:s1').references, ['/work/a'])
})

test('草稿只保留最近的 50 个会话，超长内容会被截断', () => {
  reset()
  for (let index = 0; index < 55; index += 1) {
    storage.saveDraft(`session:s${index}`, { text: `草稿 ${index}` })
  }
  const drafts = storage.loadDrafts()
  assert.equal(Object.keys(drafts).length, 50)
  // 最新写入的最后 50 个保留，最早的那条被淘汰。
  assert.equal(drafts['session:s0'], undefined)
  assert.equal(drafts['session:s54'].text, '草稿 54')

  storage.saveDraft('session:long', { text: 'x'.repeat(25_000) })
  assert.equal(storage.loadDraft('session:long').text.length, 20_000)
})

test('更新检查记录区分「已是最新」与「有未装的新版本」，并兼容旧的纯时间戳', () => {
  reset()
  assert.deepEqual(storage.loadUpdateCheck(), { at: 0, hasUpdate: false })

  // 旧版本写的是纯数字时间戳：读出来要当成「已是最新」，不能当成有更新。
  memory.set('pilot-app.update-check.v1', String(1700000000000))
  assert.deepEqual(storage.loadUpdateCheck(), { at: 1700000000000, hasUpdate: false })

  storage.saveUpdateCheck({ at: 1700000001000, hasUpdate: true })
  assert.deepEqual(storage.loadUpdateCheck(), { at: 1700000001000, hasUpdate: true })

  storage.saveUpdateCheck({ hasUpdate: false })
  const record = storage.loadUpdateCheck()
  assert.equal(record.hasUpdate, false)
  assert.ok(record.at > 0)

  // 坏数据不抛错，退化成「没查过」。
  memory.set('pilot-app.update-check.v1', '{not json')
  assert.deepEqual(storage.loadUpdateCheck(), { at: 0, hasUpdate: false })
})
