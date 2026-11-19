import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * 设置页按使用场景分区：设备和连接、更新、能力、模型、外观、帮助。
 * 目录每一项都要直接显示对应分区的卡片（v-if），不靠滚动定位；
 * 同时保持标题栏固定、六个目录卡片三列两行等宽。
 */
const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'pages', 'settings', 'index.vue'), 'utf8')
const locale = readFileSync(join(here, '..', 'lib', 'locale-en.js'), 'utf8')

const navStart = source.indexOf('settingsNavItems: [')
const navEnd = source.indexOf(']', navStart)
const navBlock = source.slice(navStart, navEnd)
const navIds = [...navBlock.matchAll(/id: '([^']+)'/g)].map((match) => match[1])

/** 每个分区应有的卡片数：关系近的卡片放进同一区，覆盖全部 14 张卡片。 */
const expectedCards = {
  'settings-connection': 3,
  'settings-update': 2,
  'settings-security': 3,
  'settings-models': 2,
  'settings-appearance': 2,
  'settings-help': 2
}

// 卡片可以由运行时条件再收窄（例如网页版没有「文件缓存」），分组只看 activeSection。
const cardMatches = [...source.matchAll(/<view v-if="activeSection === '([^']+)'[^"]*"/g)]
const dialogStart = source.indexOf('<app-dialog')

/** 按分区取出对应的卡片模板块，便于核对卡片有没有放错区。 */
function sectionBlocks(id) {
  const blocks = []
  cardMatches.forEach((match, index) => {
    if (match[1] !== id) return
    const start = match.index
    const end = index + 1 < cardMatches.length
      ? cardMatches[index + 1].index
      : dialogStart > start ? dialogStart : source.length
    blocks.push(source.slice(start, end))
  })
  return blocks.join('\n')
}

test('设置目录按场景分为六个分区', () => {
  assert.equal(navIds.length, 6, '设置目录应有六个分区')
  assert.deepEqual(navIds, Object.keys(expectedCards))
})

test('设置目录每一项都能直接切换到对应分区', () => {
  for (const id of navIds) {
    assert.ok(
      source.includes(`v-if="activeSection === '${id}'"`),
      `分区 ${id} 没有按 activeSection 显示`
    )
  }
})

test('每个分区的卡片数量符合分组，且覆盖全部卡片', () => {
  assert.equal(cardMatches.length, 14, '设置页应有 14 张卡片')
  for (const [id, count] of Object.entries(expectedCards)) {
    const actual = cardMatches.filter((match) => match[1] === id).length
    assert.equal(actual, count, `分区 ${id} 的卡片数量不符`)
  }
})

test('连接分区合并了设备、配对信息和连接', () => {
  const block = sectionBlocks('settings-connection')
  assert.ok(block.includes("t('已配对电脑')"), '连接分区缺少已配对电脑')
  assert.ok(block.includes("t('配对信息')"), '连接分区缺少配对信息')
  assert.ok(block.includes("t('连接')"), '连接分区缺少连接设置')
})

test('更新分区同时包含电脑端更新和手机端关于', () => {
  const block = sectionBlocks('settings-update')
  assert.ok(block.includes("t('电脑端更新')"), '更新分区缺少电脑端更新')
  assert.ok(block.includes("t('关于')"), '更新分区缺少关于')
})

test('外观分区包含外观与语言', () => {
  const block = sectionBlocks('settings-appearance')
  assert.ok(block.includes("t('外观')"))
  assert.ok(block.includes("t('语言')"))
})

test('功能分区包含安全与能力、运行环境', () => {
  const block = sectionBlocks('settings-security')
  assert.ok(block.includes("t('安全与能力')"))
  assert.ok(block.includes("t('运行环境')"))
})

test('功能分区可以改文件缓存保存天数，默认 7 天', () => {
  const block = sectionBlocks('settings-security')
  assert.ok(block.includes("t('文件缓存')"), '功能分区缺少文件缓存卡片')
  assert.ok(block.includes('v-for="option in fileCacheDayOptions"'))
  assert.ok(block.includes('@click="chooseFileCacheDays(option.value)"'))
  assert.ok(source.includes('fileCacheDays: loadFileCacheDays()'), '默认值应来自配置')
  assert.ok(source.includes('saveFileCacheDays(value)'), '选择后要写回配置')
  assert.ok(locale.includes('"文件缓存": "File cache"'))
  assert.ok(locale.includes('"{v1} 天（默认）": "{v1} days (default)"'))
})

test('文件缓存 6 档用三列网格换行（3×2），不再挤成一行', () => {
  const block = sectionBlocks('settings-security')
  assert.ok(
    block.includes('class="theme-options theme-options-grid"'),
    '文件缓存档位要单独用网格布局'
  )
  // 其它选项组（主题、对比度、饱和度、字号、语言）都只有 3 档，保持一行。
  assert.equal(source.match(/class="theme-options theme-options-grid"/g).length, 1)
  assert.ok(source.includes('.theme-options-grid {'))
  assert.ok(
    source.includes('grid-template-columns: repeat(3, minmax(0, 1fr));'),
    '6 档应排成三列两行'
  )
  assert.ok(source.includes('.theme-options-grid .theme-option {'))
  assert.ok(source.includes('min-width: 0;'), '网格单元要允许收缩，否则长标签会溢出')
  assert.ok(source.includes('.theme-options-grid .theme-name {'))
})

test('模型分区包含模型与余额费用', () => {
  const block = sectionBlocks('settings-models')
  assert.ok(block.includes("t('模型')"))
  assert.ok(block.includes("t('余额与费用')"))
})

test('目录切换不依赖滚动定位', () => {
  assert.ok(source.includes('@click="selectSettingsSection(item)"'))
  assert.ok(source.includes('this.activeSection = item.id'))
  assert.ok(source.includes('uni.pageScrollTo({ scrollTop: 0, duration: 0 })'))
  assert.ok(!source.includes('uni.createSelectorQuery()'), '目录不应再测量卡片位置')
  assert.ok(!source.includes('uni.upx2px(284)'), '目录不应再按固定偏移滚动')
})

test('标题栏固定、目录卡片三列等宽', () => {
  assert.ok(source.includes('position: fixed;'))
  assert.ok(source.includes('height: calc(var(--status-bar-height) + var(--settings-topbar-h));'))
  assert.ok(source.includes('top: calc(var(--status-bar-height) + var(--settings-topbar-h));'))
  assert.ok(source.includes('grid-template-columns: repeat(3, minmax(0, 1fr));'))
  assert.ok(source.includes('height: 72rpx;'))
  assert.ok(source.includes('class="settings-nav-card"'))
})

test('设置目录标签有英文翻译', () => {
  assert.ok(locale.includes('"更新": "Updates"'))
  assert.ok(locale.includes('"功能": "Features"'))
  assert.ok(locale.includes('"帮助": "Help"'))
})

/**
 * 网页版（H5 / PWA）没有 plus 运行时：后台保活、本地文件缓存、APK 更新全都做不了，
 * 这些入口必须收起来或换说法，否则用户点下去只会拿到「当前环境不支持」。
 */
test('网页版设置页收起原生专属入口', () => {
  const connection = sectionBlocks('settings-connection')
  assert.ok(connection.includes('v-if="webRuntime"'), '连接分区没有网页版分支')
  assert.ok(connection.includes('网页版的连接由浏览器托管'), '缺少网页版的连接说明')
  assert.ok(
    connection.includes('v-else') && connection.includes('后台保持'),
    '原生的后台保活内容应落在网页版分支之外'
  )

  const fileCache = source.slice(
    source.indexOf("id=\"settings-file-cache\"") - 200,
    source.indexOf("id=\"settings-file-cache\"")
  )
  assert.ok(fileCache.includes('!webRuntime'), '文件缓存卡片没有在网页版隐藏')

  const update = sectionBlocks('settings-update')
  assert.ok(update.includes('网页版随服务器更新'), '关于分区没有网页版更新说明')
  assert.ok(update.includes('reloadWebApp'), '网页版没有刷新入口')
  assert.ok(source.includes('isWebRuntime()'), '没有接上 lib/platform.js 的判定')
})

test('platform.js 能区分原生运行时与浏览器', async () => {
  const { hasNativeRuntime, isWebRuntime, runtimeLabel } = await import('../lib/platform.js')
  const browser = { document: {}, plus: undefined }
  const native = { document: {}, plus: { runtime: { version: '1.0.94' } } }

  assert.equal(hasNativeRuntime(native), true)
  assert.equal(isWebRuntime(native), false)
  assert.equal(hasNativeRuntime(browser), false)
  assert.equal(isWebRuntime(browser), true)
  assert.equal(runtimeLabel(browser), '网页版')
  assert.equal(runtimeLabel(native), '')
  // 基座里读 plus 属性本身也能抛错，这种情况按「没有原生能力」处理，不能崩。
  const hostile = {
    document: {},
    get plus() {
      throw new Error('打包时未加入模块')
    }
  }
  assert.equal(hasNativeRuntime(hostile), false)
  assert.equal(isWebRuntime(hostile), true)
})
