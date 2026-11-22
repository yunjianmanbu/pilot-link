<template>
  <view class="page resources-page" :class="[{ 'theme-light': store.theme === 'light' }, { 'is-standalone': single }, 'accent-' + store.accent, 'btn-scheme-' + buttonSchemeClass, 'font-' + store.fontSize, 'contrast-' + store.contrast, 'saturation-' + store.saturation]">
    <view class="rs-header">
      <view class="rs-topbar">
        <view class="rs-back" @click="back"><view class="back-arrow"></view></view>
        <view class="rs-titles">
          <text class="rs-title">{{ title }}</text>
          <text class="rs-subtitle">{{ subtitle }}</text>
        </view>
        <text v-if="sessionId" class="rs-action" @click="openChat">{{ t('原会话') }}</text>
      </view>

      <!-- 合并页保留分类切换；快捷入口各自有独立页面时不渲染这条。 -->
      <view v-if="showTabs" class="rs-tabs">
        <text
          class="rs-tab link"
          :class="{ active: tab === 'links' }"
          @click="setTab('links')"
        >{{ t('链接') }}</text>
        <text
          class="rs-tab tool"
          :class="{ active: tab === 'tools' }"
          @click="setTab('tools')"
        >{{ t('工具') }}</text>
        <text
          class="rs-tab memory"
          :class="{ active: tab === 'memory' }"
          @click="setTab('memory')"
        >{{ t('记忆') }}</text>
        <text
          class="rs-tab knowledge"
          :class="{ active: tab === 'knowledge' }"
          @click="setTab('knowledge')"
        >{{ t('知识库') }}</text>
        <text
          class="rs-tab file"
          :class="{ active: tab === 'files' }"
          @click="setTab('files')"
        >{{ t('文件') }}</text>
      </view>

      <view v-if="banner" class="rs-banner">
        <text class="rs-banner-text">{{ banner }}</text>
      </view>

      <view class="rs-meta">
        <text v-if="loading" class="rs-meta-text">{{ loadingText }}</text>
        <text v-else class="rs-meta-text">{{ countText }}</text>
        <text v-if="!loading && hasMore && current.length" class="rs-meta-hint">
          {{ t('只显示最近{v1}条', { v1: current.length }) }}
        </text>
        <!-- 读空了也给一个重试入口：没有这一下，用户只能退出页面再进一次。 -->
        <text v-if="!loading && sessionId" class="rs-meta-refresh" @click="retry">
          {{ t('刷新') }}
        </text>
        <text v-if="fullPageSource" class="rs-meta-action" @click="openFullPage">
          {{ t('查看全部') }}
        </text>
      </view>
    </view>

    <scroll-view class="rs-scroll" scroll-y :show-scrollbar="false">
      <view class="rs-content">
        <view v-if="error" class="rs-error">{{ error }}</view>

        <template v-if="tab === 'links'">
          <view v-if="!sessionId" class="rs-empty">
            <text class="rs-empty-title">{{ t('还没有选择会话') }}</text>
            <text class="rs-empty-hint">{{ t('从任务卡片上的「链接」进入，就能看到这个任务里的链接。') }}</text>
          </view>
          <view v-else-if="loading && links.length === 0" class="rs-empty">
            <text class="rs-empty-title">{{ t('正在整理链接…') }}</text>
            <text class="rs-empty-hint">{{ t('只读会话正文，不访问网络。') }}</text>
          </view>
          <view v-else-if="links.length === 0" class="rs-empty">
            <text class="rs-empty-title">{{ linkEmptyTitle }}</text>
            <text class="rs-empty-hint">{{ linkEmptyHint }}</text>
          </view>

          <view
            v-for="(link, index) in links"
            :key="link.url + index"
            class="rs-card"
            @click="openLink(link)"
          >
            <view class="rs-card-head">
              <text class="rs-host">{{ link.host }}</text>
              <text v-if="link.count > 1" class="rs-tag count">{{ t('出现{v1}次', { v1: link.count }) }}</text>
              <text class="rs-time">{{ relativeTime(link.createdAt) }}</text>
            </view>
            <text class="rs-url" user-select>{{ link.url }}</text>
            <text v-if="link.context" class="rs-context">{{ link.context }}</text>
            <view class="rs-card-foot">
              <text class="rs-role">{{ link.role === 'assistant' ? t('Pilot 回复') : t('我的指令') }}</text>
              <text class="rs-copy" @click.stop="copyLink(link)">{{ t('复制链接') }}</text>
              <text class="rs-copy" @click.stop="openLinkExternal(link.url, link)">{{ t('浏览器打开') }}</text>
              <text class="rs-open" @click.stop="openLink(link)">{{ t('预览') }}</text>
            </view>
          </view>
        </template>

        <template v-else-if="tab === 'tools'">
          <view v-if="!sessionId" class="rs-empty">
            <text class="rs-empty-title">{{ t('还没有选择会话') }}</text>
            <text class="rs-empty-hint">{{ t('从任务卡片上的「工具」进入，就能看到这个任务可用的工具。') }}</text>
          </view>
          <view v-else-if="loading && tools.length === 0" class="rs-empty">
            <text class="rs-empty-title">{{ t('正在读取工具…') }}</text>
            <text class="rs-empty-hint">{{ t('工具清单取自电脑端当前生效的配置。') }}</text>
          </view>
          <view v-else-if="tools.length === 0 && !error" class="rs-empty">
            <text class="rs-empty-title">{{ toolEmptyTitle }}</text>
            <text class="rs-empty-hint">{{ toolEmptyHint }}</text>
          </view>

          <view v-for="tool in tools" :key="tool.name" class="rs-card">
            <view class="rs-card-head">
              <text class="rs-tool-name">{{ tool.name }}</text>
              <text class="rs-tag source">{{ sourceText(tool) }}</text>
              <text class="rs-tag risk" :class="'risk-' + tool.risk">{{ riskText(tool) }}</text>
            </view>
            <text v-if="toolDesc(tool)" class="rs-tool-desc">{{ toolDesc(tool) }}</text>
            <view class="rs-card-foot">
              <text class="rs-tool-state" :class="{ off: !tool.enabled || !tool.approved }">{{ toolState(tool) }}</text>
              <text v-if="tool.version" class="rs-time">v{{ tool.version }}</text>
            </view>
          </view>
        </template>

        <template v-else-if="tab === 'knowledge'">
          <view v-if="!sessionId" class="rs-empty">
            <text class="rs-empty-title">{{ t('还没有选择会话') }}</text>
            <text class="rs-empty-hint">{{ t('从任务卡片上的「知识」进入，就能看到这个任务的问答整理。') }}</text>
          </view>
          <view v-else-if="loading && pairs.length === 0" class="rs-empty">
            <text class="rs-empty-title">{{ t('正在读取知识库…') }}</text>
            <text class="rs-empty-hint">{{ t('电脑端把会话正文整理成「我的指令 → Pilot 回复」。') }}</text>
          </view>
          <view v-else-if="pairs.length === 0 && !error" class="rs-empty">
            <text class="rs-empty-title">{{ t('这个任务里还没有可整理的知识') }}</text>
            <text class="rs-empty-hint">{{ t('你和 Pilot 的正文会按轮次整理到这里。') }}</text>
          </view>

          <view
            v-for="pair in pairs"
            :key="pair.key"
            class="rs-card"
            @click="openKnowledge()"
          >
            <view class="rs-card-head">
              <text class="rs-tag count">{{ t('第{v1}轮', { v1: pair.index }) }}</text>
              <text class="rs-time">{{ relativeTime(pair.instructionAt) }}</text>
            </view>
            <text class="rs-url" user-select>{{ preview(pair.instruction) }}</text>
            <text v-if="pair.reply" class="rs-context">{{ preview(pair.reply) }}</text>
            <view class="rs-card-foot">
              <text class="rs-role">
                {{ pair.replyCount ? t('{v1} 条回复', { v1: pair.replyCount }) : t('还没有回复') }}
              </text>
              <text class="rs-open" @click.stop="openKnowledge()">{{ t('打开知识库') }}</text>
            </view>
          </view>
        </template>

        <template v-else-if="tab === 'memory'">
          <view v-if="!sessionId" class="rs-empty">
            <text class="rs-empty-title">{{ t('还没有选择会话') }}</text>
            <text class="rs-empty-hint">{{ t('从任务卡片上的「记忆」进入，就能看到这个任务用到的项目记忆。') }}</text>
          </view>
          <view v-else-if="loading && memories.length === 0" class="rs-empty">
            <text class="rs-empty-title">{{ t('正在读取记忆…') }}</text>
            <text class="rs-empty-hint">{{ t('记忆存在电脑端工作区里，这里只列出这个任务用到或写下的条目。') }}</text>
          </view>
          <!-- 任务本身没用过记忆时，直接列出项目记忆，别让用户看到一页空。 -->
          <view v-else-if="memories.length === 0 && memoryFallback.length > 0" class="rs-banner">
            <text class="rs-banner-text">
              {{ t('这个任务还没用到记忆，下面是这个项目的全部记忆。') }}
            </text>
          </view>
          <view v-else-if="memories.length === 0" class="rs-empty">
            <text class="rs-empty-title">{{ memoryEmptyTitle }}</text>
            <text class="rs-empty-hint">{{ memoryEmptyHint }}</text>
          </view>

          <view v-for="entry in memoryRows" :key="entry.id" class="rs-card memory-card">
            <view class="rs-card-head">
              <text class="rs-tag memory">{{ memoryCategoryLabel(entry) }}</text>
              <text v-if="entry.written" class="rs-tag source">{{ t('本任务写入') }}</text>
              <text v-else-if="entry.injected" class="rs-tag count">{{ t('已注入提示词') }}</text>
              <text class="rs-time">{{ relativeTime(entry.createdAt) }}</text>
            </view>
            <text class="rs-context memory-text" user-select>{{ entry.content }}</text>
          </view>
        </template>

        <template v-else>
          <view v-if="!sessionId" class="rs-empty">
            <text class="rs-empty-title">{{ t('还没有选择会话') }}</text>
            <text class="rs-empty-hint">{{ t('从任务卡片上的「文件」进入，就能看到这个任务改过的文件。') }}</text>
          </view>
          <view v-else-if="loading && files.length === 0" class="rs-empty">
            <text class="rs-empty-title">{{ t('正在读取文件…') }}</text>
            <text class="rs-empty-hint">{{ t('只列出这个任务里新增或修改的文件。') }}</text>
          </view>
          <view v-else-if="files.length === 0 && !error" class="rs-empty">
            <text class="rs-empty-title">{{ fileEmptyTitle }}</text>
            <text class="rs-empty-hint">{{ fileEmptyHint }}</text>
          </view>

          <view v-for="file in files" :key="file.path" class="rs-card" @click="openFile(file)">
            <view class="rs-card-head">
              <text class="rs-tool-name">{{ file.name || fileName(file.path) }}</text>
              <text v-if="file.action" class="rs-tag source">{{ actionText(file) }}</text>
            </view>
            <text class="rs-context" user-select>{{ file.path }}</text>
            <view class="rs-card-foot">
              <text class="rs-role">{{ file.tool || t('工作区文件') }}</text>
              <text class="rs-open" @click.stop="openFile(file)">{{ t('打开文件') }}</text>
            </view>
          </view>
        </template>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import { LONG_TIMEOUT } from '../../lib/client.js'
import { fileActionLabel, openWebPreview } from '../../lib/files.js'
import { relativeTime } from '../../lib/format.js'
import { t, getLocale } from '../../lib/i18n.js'
import {
  applySystemBars,
  cachedSessionLinks,
  cachedSessionMemory,
  init,
  isAgentOnline,
  loadSessionKnowledge,
  loadSessionLinks,
  loadSessionMemoryDetails,
  loadMemory,
  loadSessionTools,
  request,
  store
} from '../../store/index.js'

const LINK_LIMIT = 60
const TOOL_LIMIT = 120
const KNOWLEDGE_LIMIT = 60
/** 知识库卡片只给一眼摘要，完整内容到知识库页面里看。 */
const PREVIEW_CHARS = 160
const TABS = ['links', 'tools', 'memory', 'knowledge', 'files']

export default {
  name: 'SessionResources',
  // 组件形态：页面壳只负责从 URL 取参数，这里统一处理五种分类。
  props: {
    targetSessionId: { type: String, default: '' },
    startTab: { type: String, default: '' },
    // true = 独立页面（只有一种分类，不渲染标签条）。
    standalone: { type: Boolean, default: false }
  },
  data() {
    return {
      sessionId: '',
      // links / tools / memory / knowledge / files：快捷入口各自落到对应分类。
      tab: 'links',
      links: [],
      tools: [],
      // 会话记忆：工作区里被本会话注入或在本次会话里写下的条目。
      memories: [],
      // 会话记忆为空时的兑底：这个项目的全部记忆（仍只存在电脑端）。
      memoryFallback: [],
      // 独立页面（single=1）只显示一个分类，不再渲染标签条。
      single: false,
      // 知识库按电脑端的正序返回，展示时倒序（最新一轮在最上面）。
      knowledgePairs: [],
      files: [],
      // 四个分类各记各的来源与截断状态，切换时不会串。
      linkTotal: 0,
      toolTotal: 0,
      memoryTotal: 0,
      knowledgeTotal: 0,
      fileTotal: 0,
      linkHasMore: false,
      toolHasMore: false,
      knowledgeHasMore: false,
      linkSource: 'none',
      toolSource: 'none',
      memorySource: 'none',
      knowledgeSource: 'none',
      fileSource: 'none',
      // 会话列表里没带工作区路径时，由 sessions.get 补一份。
      sessionWorkspace: '',
      mcpEnabled: true,
      loading: false,
      error: '',
      // 每个分类只加载一次；切换分类回来不必再请求。
      loaded: false,
      loadedLinks: false,
      loadedTools: false,
      loadedMemory: false,
      loadedKnowledge: false,
      loadedFiles: false,
      seq: 0
    }
  },
  computed: {
    store() {
      return store
    },
    /** 按钮配色方案：store 里万一还是空值，也要落到有定义的 accent 上，
        否则根节点挂着 `btn-scheme-undefined`，整页按钮没有配色。 */
    buttonSchemeClass() {
      const value = String(store.buttonScheme || '').trim()
      return value || 'accent'
    },
    session() {
      if (!this.sessionId) return null
      const found = store.sessions.find((item) => item.id === this.sessionId)
      if (found) return found
      if (store.currentSessionId === this.sessionId) return store.currentSession
      return null
    },
    sessionTitle() {
      return String(this.session?.title || t('未命名会话'))
    },
    /** 独立页面用分类名当标题，合并页保持「会话资源」。 */
    showTabs() {
      return !this.single
    },
    title() {
      if (!this.single) return t('会话资源')
      if (this.tab === 'links') return t('链接')
      if (this.tab === 'tools') return t('工具')
      if (this.tab === 'memory') return t('记忆')
      if (this.tab === 'knowledge') return t('知识库')
      return t('文件')
    },
    /** 会话没用到记忆时，把项目记忆整体摞上来，不让用户停在空白页。 */
    memoryRows() {
      return this.memories.length > 0 ? this.memories : this.memoryFallback
    },
    subtitle() {
      if (!this.sessionId) return t('未命名会话')
      if (this.loading) return t('{v1} · 正在读取', { v1: this.sessionTitle })
      return this.sessionTitle
    },
    current() {
      if (this.tab === 'links') return this.links
      if (this.tab === 'tools') return this.tools
      if (this.tab === 'memory') return this.memoryRows
      if (this.tab === 'knowledge') return this.pairs
      return this.files
    },
    total() {
      if (this.tab === 'links') return this.linkTotal
      if (this.tab === 'tools') return this.toolTotal
      if (this.tab === 'memory') return this.memoryTotal
      if (this.tab === 'knowledge') return this.knowledgeTotal
      return this.fileTotal
    },
    hasMore() {
      if (this.tab === 'links') return this.linkHasMore
      if (this.tab === 'tools') return this.toolHasMore
      if (this.tab === 'knowledge') return this.knowledgeHasMore
      return false
    },
    source() {
      if (this.tab === 'links') return this.linkSource
      if (this.tab === 'tools') return this.toolSource
      if (this.tab === 'memory') return this.memorySource
      if (this.tab === 'knowledge') return this.knowledgeSource
      return this.fileSource
    },
    /** 知识库按时间倒序展示：最新一轮在最上面。 */
    pairs() {
      return [...this.knowledgePairs].reverse()
    },
    workspacePath() {
      return String(
        this.sessionWorkspace || this.session?.cwd || this.session?.workspacePath || ''
      )
    },
    loadingText() {
      if (this.tab === 'links') return t('正在整理链接…')
      if (this.tab === 'tools') return t('正在读取工具…')
      if (this.tab === 'memory') return t('正在读取记忆…')
      if (this.tab === 'knowledge') return t('正在读取知识库…')
      return t('正在读取文件…')
    },
    countText() {
      if (this.tab === 'links') return t('{v1} 条链接', { v1: this.total })
      if (this.tab === 'tools') return t('{v1} 个工具', { v1: this.total })
      if (this.tab === 'memory') return t('{v1} 条记忆', { v1: this.total })
      if (this.tab === 'knowledge') return t('{v1} 轮问答', { v1: this.total })
      return t('{v1} 个文件', { v1: this.total })
    },
    /** 知识库与文件有完整的独立页面（搜索、工作区浏览），链接与工具没有。 */
    fullPageSource() {
      if (!this.sessionId) return ''
      if (this.tab === 'knowledge') return 'knowledge'
      if (this.tab === 'files') return 'files'
      return ''
    },
    /** 组件里统一的在线判断：中继连着但电脑端已退出时也算离线。 */
    online() {
      return this.store.connectionState === 'connected' && this.store.agentOnline === true
    },
    /** 离线/旧版本/读取失败各自的说明，不把空列表当成功。 */
    banner() {
      if (this.loading) return ''
      if (this.tab === 'links' && this.source === 'cache' && !this.online) {
        return t('电脑端离线，链接来自这台手机缓存的会话正文，连上电脑后会自动刷新。')
      }
      if (this.tab === 'memory' && this.source === 'cache') {
        return t('电脑端暂未响应，记忆来自这台手机上缓存的上一次读取结果。')
      }
      if (this.tab === 'tools' && this.source === 'pc' && !this.mcpEnabled) {
        return t('MCP 未启用，清单里不含 MCP 工具。')
      }
      if (this.tab === 'knowledge' && this.knowledgeSource === 'cache') {
        return t('电脑端离线，知识库来自这台手机缓存的会话正文。')
      }
      return ''
    },
    fileEmptyTitle() {
      if (this.fileSource === 'offline') return t('电脑端离线')
      if (this.fileSource === 'error') return t('读取文件列表失败')
      return t('这个任务里还没有文件')
    },
    fileEmptyHint() {
      if (this.fileSource === 'offline') return t('文件列表需要连接电脑后读取。')
      if (this.fileSource === 'error') return t('检查连接后重试。')
      return t('任务里新增或修改的文件会列在这里。')
    },
    toolEmptyTitle() {
      if (this.toolSource === 'offline') return t('电脑端离线')
      if (this.toolSource === 'unsupported') return t('电脑端版本过低')
      if (this.toolSource === 'error') return t('读取工具清单失败')
      return t('这个任务没有可用的工具')
    },
    toolEmptyHint() {
      if (this.toolSource === 'offline') return t('工具清单需要连接电脑后读取。')
      if (this.toolSource === 'unsupported') return t('升级电脑端后可以查看这个任务的工具。')
      if (this.toolSource === 'error') return t('检查连接后重试。')
      return t('工具清单来自电脑端当前生效的配置。')
    },
    memoryEmptyTitle() {
      if (this.memorySource === 'offline') return t('电脑端离线')
      if (this.memorySource === 'error') return t('读取记忆失败')
      return t('这个任务还没有用到记忆')
    },
    /** 链接页的空态：失败/离线/真的没链接要说清是哪一种，别只给一屏背景色。 */
    linkEmptyTitle() {
      if (this.error) return t('读取链接失败')
      return t('这个任务里还没有链接')
    },
    linkEmptyHint() {
      if (this.error) return t('检查连接后重试。')
      if (this.linkSource === 'cache' && !this.online) {
        return t('电脑端离线时只能读这台手机缓存过的正文，连接电脑后会自动刷新出这个任务的全部链接。')
      }
      return t('你和 Pilot 的正文里出现的 http/https 链接会收集到这里。')
    },
    memoryEmptyHint() {
      if (this.memorySource === 'offline') return t('记忆存在电脑端工作区，连上电脑后会自动刷新。')
      if (this.memorySource === 'error') return t('检查连接后重试。')
      return t('运行时会自动挑选相关记忆写进提示词，也用 remember 工具记下新事实。')
    }
  },
  mounted() {
    // 挂载阶段任何一步抛错都会让下方列表永远空白，这里兜住并给出可见文案。
    try {
      init()
      applySystemBars()
    } catch (error) {
      console.error('[pilot] 会话资源面板初始化失败', error)
    }
    this.sessionId = this.targetSessionId || store.currentSessionId || ''
    // 从某个快捷入口进来的直接停在对应分类。
    this.tab = TABS.includes(this.startTab) ? this.startTab : 'links'
    this.single = this.standalone === true
    this.loaded = true
    void this.loadCurrent().catch((error) => {
      this.loading = false
      this.error = error?.message || t('读取失败，请稍后重试。')
    })
  },
  watch: {
    /**
     * 进入这个页面的瞬间，App 往往正在回前台的探活窗口里：那一刻判成「电脑端离线」
     * 以后如果不重试，页面就会永久停在空态。链路真正就绪时补读当前分类。
     */
    'store.connectionState'(state) {
      if (state !== 'connected') return
      this.retryWhenStale()
    },
    /**
     * `agentOnline` 与 `connectionState` 不是一回事：中继连着但电脑端还没回应
     * 探活时，第一个是 false、第二个是 connected。只监听 connectionState 的话，
     * 页面会永久停在「电脑端离线」的空态——用户看到的就是“等很久还是空”。
     */
    'store.agentOnline'(online) {
      if (online) this.retryWhenStale()
    }
  },
  beforeDestroy() {
    this.seq += 1
  },
  methods: {
    /** 模板里的时间戳要相对时间，函数本身来自 lib/format.js；
        Vue 3 的模板只能访问实例上的属性，不挂到 methods 就会调出一句
        `relativeTime is not a function`，整个面板渲染失败（用户看到的空白页）。 */
    relativeTime,
    /** 链路刚恢复时补读当前分类；已经拿到电脑端结果就不重复请求。 */
    retryWhenStale() {
      if (this.loading || !isAgentOnline()) return
      if (this.source === 'pc') return
      void this.loadCurrent().catch(() => {})
    },
    async loadCurrent() {
      if (!this.sessionId) return
      if (this.tab === 'links') await this.loadLinks()
      else if (this.tab === 'tools') await this.loadTools()
      else if (this.tab === 'memory') await this.loadSessionMemory()
      else if (this.tab === 'knowledge') await this.loadKnowledge()
      else await this.loadFiles()
    },
    /** 元信息条上的「刷新」：重读当前分类，不用退出页面再进一次。 */
    retry() {
      if (this.loading) return
      this.error = ''
      void this.loadCurrent()
    },
    async loadLinks() {
      if (!this.sessionId) return
      const seq = ++this.seq
      this.error = ''
      // 先用本机缓存的会话正文上一次屏：中继「假在线」（连着但电脑端不响应）时
      // sessions.links 和 sessions.get 都要等到超时，页面不能先空十几秒。
      const cached = cachedSessionLinks(this.sessionId, { limit: LINK_LIMIT })
      if (cached.length > 0) {
        this.links = cached
        this.linkTotal = cached.length
        this.linkHasMore = false
        this.linkSource = 'cache'
      }
      this.loading = cached.length === 0
      try {
        const result = await loadSessionLinks(this.sessionId, { limit: LINK_LIMIT })
        if (seq !== this.seq) return
        this.links = Array.isArray(result?.links) ? result.links : []
        this.linkTotal = Number(result?.total) || this.links.length
        this.linkHasMore = result?.hasMore === true
        this.linkSource = result?.source || 'none'
        this.loadedLinks = true
      } catch (error) {
        if (seq !== this.seq) return
        // 请求失败不能把已经上屏的缓存也抹掉，否则又回到空白页。
        if (cached.length === 0) {
          this.links = []
          this.linkTotal = 0
          this.linkHasMore = false
        }
        this.error = t('读取链接失败，请稍后重试。')
      } finally {
        if (seq === this.seq) this.loading = false
      }
    },
    async loadTools() {
      if (!this.sessionId) return
      const seq = ++this.seq
      this.loading = true
      this.error = ''
      try {
        const result = await loadSessionTools(this.sessionId, { limit: TOOL_LIMIT })
        if (seq !== this.seq) return
        this.tools = Array.isArray(result?.tools) ? result.tools : []
        this.toolTotal = Number(result?.total) || this.tools.length
        this.toolHasMore = result?.hasMore === true
        this.toolSource = result?.source || 'none'
        this.mcpEnabled = result?.mcpEnabled !== false
        this.loadedTools = true
      } catch (error) {
        if (seq !== this.seq) return
        this.tools = []
        this.toolTotal = 0
        this.toolHasMore = false
        this.error = t('读取工具清单失败，请稍后重试。')
      } finally {
        if (seq === this.seq) this.loading = false
      }
    },
    async loadKnowledge() {
      if (!this.sessionId) return
      const seq = ++this.seq
      this.loading = true
      this.error = ''
      try {
        const result = await loadSessionKnowledge(this.sessionId, { limit: KNOWLEDGE_LIMIT })
        if (seq !== this.seq) return
        this.knowledgePairs = Array.isArray(result?.pairs) ? result.pairs : []
        this.knowledgeTotal = Number(result?.total) || this.knowledgePairs.length
        this.knowledgeHasMore = result?.hasMore === true
        this.knowledgeSource = result?.source || 'none'
        this.loadedKnowledge = true
      } catch (error) {
        if (seq !== this.seq) return
        this.knowledgePairs = []
        this.knowledgeTotal = 0
        this.knowledgeHasMore = false
        this.error = t('读取知识库失败，请稍后重试。')
      } finally {
        if (seq === this.seq) this.loading = false
      }
    },
    async loadFiles() {
      if (!this.sessionId) return
      const seq = ++this.seq
      this.loading = true
      this.error = ''
      // 文件没有本地缓存：电脑不在线时说明还没同步，而不是当作「没有文件」。
      if (!isAgentOnline()) {
        this.files = []
        this.fileTotal = 0
        this.fileSource = 'offline'
        this.loadedFiles = true
        this.loading = false
        return
      }
      try {
        const data = await request('files.session', { sessionId: this.sessionId }, LONG_TIMEOUT)
        if (seq !== this.seq) return
        this.files = (Array.isArray(data?.artifacts) ? data.artifacts : []).filter(
          (item) => item && item.path
        )
        this.fileTotal = this.files.length
        this.fileSource = 'pc'
        this.loadedFiles = true
        // 打开文件要带上工作区路径，会话里没有就去问电脑端。
        if (!this.workspacePath) void this.resolveWorkspace()
      } catch (error) {
        if (seq !== this.seq) return
        this.files = []
        this.fileTotal = 0
        this.fileSource = 'error'
        const message = String(error?.message || t('读取文件列表失败'))
        this.error = message.includes(t('手机端不支持'))
          ? t('电脑端版本过低，请先在电脑上更新 Pilot')
          : message
      } finally {
        if (seq === this.seq) this.loading = false
      }
    },
    /** 会话列表里没带工作区路径时，向电脑端补一次。 */
    async resolveWorkspace() {
      if (!this.sessionId) return
      try {
        const data = await request('sessions.get', { sessionId: this.sessionId, limit: 1 }, LONG_TIMEOUT)
        const session = data?.session || {}
        if (session.cwd || session.workspacePath) {
          this.sessionWorkspace = String(session.cwd || session.workspacePath)
        }
      } catch {
        // 补不到就留空，文件页自己也会再试一次。
      }
    },
    /**
     * 会话记忆：条目仍是工作区级的，电脑端已经把「本会话注入/写入」筛好。
     */
    async loadSessionMemory() {
      if (!this.sessionId) return
      const seq = ++this.seq
      this.error = ''
      // 记忆同样先用上次在线读到的快照上屏，再等电脑端的最新结果。
      const cached = cachedSessionMemory(this.sessionId)
      if (cached.length > 0) {
        this.memories = cached
        this.memoryTotal = cached.length
        this.memorySource = 'cache'
      }
      this.loading = cached.length === 0
      try {
        const detail = await loadSessionMemoryDetails(this.sessionId)
        if (seq !== this.seq) return
        const rows = Array.isArray(detail?.memory) ? detail.memory : []
        const source = detail?.source || 'pc'
        if (source === 'cache') {
          // 电脑端没响应，但本机有上次的快照：展示它，并说清是哪来的。
          this.memories = rows
          this.memoryTotal = rows.length
          this.memorySource = 'cache'
          this.loadedMemory = true
          return
        }
        this.memories = rows
        this.memoryTotal = rows.length
        this.memorySource = source
        this.loadedMemory = true
        // 本会话还没用到记忆时（新会话最常见），把项目记忆整体捧上来；
        // 否则用户点「记忆」永远只能看到一句空话，以为功能坏了。
        if (rows.length === 0 && isAgentOnline()) await this.loadMemoryFallback(seq)
      } catch (error) {
        if (seq !== this.seq) return
        if (cached.length > 0) {
          this.memories = cached
          this.memoryTotal = cached.length
          this.memorySource = 'cache'
          this.loadedMemory = true
          return
        }
        this.memories = []
        this.memoryFallback = []
        this.memoryTotal = 0
        this.memorySource = 'error'
        const message = String(error?.message || t('读取记忆失败'))
        this.error = message.includes(t('手机端不支持'))
          ? t('电脑端版本过低，请先在电脑上更新 Pilot')
          : message
        // 会话记忆这一条请求失败（旧版电脑端、会话已换工作区）时，
        // 项目记忆仍可能拿得到——先把它列出来，别让页面只剩一行错误。
        if (isAgentOnline()) await this.loadMemoryFallback(seq)
      } finally {
        if (seq === this.seq) this.loading = false
      }
    },
    /** 项目级记忆：只读，兜底展示用；拿不到就保持空态。 */
    async loadMemoryFallback(seq) {
      // 从任务卡片直接进记忆页时，会话对象里往往没带工作区路径，先向电脑端要一次。
      if (!this.workspacePath) await this.resolveWorkspace()
      const path = this.workspacePath
      if (!path || seq !== this.seq) return
      try {
        const rows = await loadMemory(path)
        if (seq !== this.seq) return
        this.memoryFallback = Array.isArray(rows) ? rows : []
        // 兜底列表也计入条目数，否则页面写「0 条记忆」却列着一屏内容。
        this.memoryTotal = this.memoryFallback.length
      } catch {
        if (seq !== this.seq) return
        this.memoryFallback = []
      }
    },
    setTab(tab) {
      if (!TABS.includes(tab)) return
      if (this.tab === tab) return
      this.tab = tab
      this.error = ''
      // 已经加载过的分类直接复用结果，切换不再请求。
      const loaded = {
        links: this.loadedLinks,
        tools: this.loadedTools,
        memory: this.loadedMemory,
        knowledge: this.loadedKnowledge,
        files: this.loadedFiles
      }[tab]
      if (loaded) return
      void this.loadCurrent()
    },
    /** 来源标签只在电脑端成立，页面按条目逐条翻译。 */
    sourceText(tool) {
      if (tool.source === 'mcp') return t('MCP')
      if (tool.source === 'dynamic') return t('自写')
      if (tool.source === 'control') return t('控制')
      if (tool.source === 'builtin') return t('内置')
      return t('内置')
    },
    riskText(tool) {
      if (tool.risk === 'read') return t('只读')
      if (tool.risk === 'write') return t('写文件')
      if (tool.risk === 'exec') return t('命令')
      if (tool.risk === 'control') return t('控制')
      return t('命令')
    },
    toolState(tool) {
      if (tool.enabled === false) return t('已停用')
      if (tool.approved !== true) return t('未批准，运行前需要你确认')
      return t('可用')
    },
    /** 说明：中文界面优先用电脑端带来的中文说明，没有就显示原文。 */
    toolDesc(tool) {
      if (getLocale() === 'en') return tool.description || ''
      return tool.descriptionZh || tool.description || ''
    },
    /** 记忆分类与桌面端 panel 保持同一套说法。 */
    memoryCategoryLabel(entry) {
      const category = entry?.category
      if (category === 'invariant') return t('不变量')
      if (category === 'verification') return t('验证路径')
      if (category === 'negative') return t('走不通的路')
      if (category === 'environment') return t('环境约束')
      if (category === 'preference') return t('用户偏好')
      if (category === 'decision') return t('废弃方案')
      return t('代码事实')
    },
    copyLink(link) {
      const url = String(link?.url || '')
      if (!url) return
      uni.setClipboardData({
        data: url,
        success: () => uni.showToast({ title: t('链接已复制'), icon: 'none' }),
        fail: () => uni.showToast({ title: t('复制失败'), icon: 'none' })
      })
    },
    openLink(link) {
      const url = String(link?.url || '')
      if (!url) return
      // 先在 App 内置 WebView 里预览（带标题、返回键，人不用跳出 Pilot），
      // 内置预览不可用（H5/旧版本）才交给系统浏览器，最后退回复制。
      openWebPreview(url, link?.host || link?.title || '').catch(() => {
        this.openLinkExternal(url, link)
      })
    },
    openLinkExternal(url, link) {
      // App 里交给系统浏览器；其它环境退回复制，避免点了没反应。
      try {
        if (typeof plus !== 'undefined' && plus.runtime && typeof plus.runtime.openURL === 'function') {
          plus.runtime.openURL(url)
          return
        }
      } catch {
        // ignore
      }
      if (typeof window !== 'undefined' && typeof window.open === 'function') {
        try {
          window.open(url, '_blank')
          return
        } catch {
          // ignore
        }
      }
      this.copyLink(link)
    },
    openChat() {
      if (!this.sessionId) return
      uni.navigateTo({
        url: `/pages/chat/index?id=${encodeURIComponent(this.sessionId)}`
      })
    },
    /** 知识库与文件的完整页面：搜索、工作区浏览都在那里。 */
    openFullPage() {
      if (this.fullPageSource === 'knowledge') this.openKnowledge()
      else if (this.fullPageSource === 'files') this.openFilesPage()
    },
    openKnowledge() {
      if (!this.sessionId) return
      const url = `/pages/knowledge/index?sessionId=${encodeURIComponent(this.sessionId)}&from=resources`
      uni.navigateTo({ url })
    },
    openFilesPage() {
      if (!this.sessionId) return
      uni.navigateTo({ url: `/pages/files/index?sessionId=${encodeURIComponent(this.sessionId)}` })
    },
    openFile(file) {
      if (!file?.path) return
      const query = [
        `path=${encodeURIComponent(file.path)}`,
        `name=${encodeURIComponent(file.name || '')}`,
        `action=${encodeURIComponent(file.action || '')}`,
        `workspace=${encodeURIComponent(this.workspacePath)}`
      ].join('&')
      uni.navigateTo({ url: `/pages/file/index?${query}` })
    },
    actionText(file) {
      return fileActionLabel(file?.action || file?.tool)
    },
    fileName(path) {
      return String(path || '').split(/[\\/]/).pop()
    },
    /** 卡片里只给一眼摘要，完整内容到知识库页面里看。 */
    preview(text) {
      const value = String(text || '').replace(/\s+/g, ' ').trim()
      return value.length > PREVIEW_CHARS ? `${value.slice(0, PREVIEW_CHARS)}…` : value
    },
    back() {
      try {
        const pages = getCurrentPages()
        if (pages.length > 1) {
          uni.navigateBack()
          return
        }
      } catch {
        // ignore
      }
      uni.reLaunch({ url: '/pages/sessions/index' })
    }
  }
}
</script>

<style>
.resources-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  padding: calc(var(--status-bar-height) + 20rpx) 28rpx 0;
  box-sizing: border-box;
}
/**
 * 独立页面（只有一种分类，从任务行的快捷入口进来）。
 *
 * 这里刻意不用 `height: 100vh` + `flex: 1` 的撑满写法：App 端一旦页面高度或
 * scroll-view 的 flex 高度算成 0，整屏就只剩背景色，看起来就是「空白页」
 * （用户报过链接页、记忆页进去什么都没有）。改成自然流 + 整页滚动后，
 * 内容无论容器高度算出多少都排得出来。
 */
.resources-page.is-standalone {
  height: auto;
  min-height: 100vh;
  overflow: visible;
}
.resources-page.is-standalone .rs-scroll {
  flex: none;
  height: auto;
  width: 100%;
  margin: 0;
  overflow: visible;
}
.rs-header {
  flex-shrink: 0;
}
.rs-topbar {
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 4rpx 2rpx 18rpx;
}
.rs-back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56rpx;
  height: 56rpx;
  /* 标题下面是副标题，箭头对齐第一行而不是整个两行块。 */
  align-self: flex-start;
  margin-top: -3rpx;
  margin-right: 2rpx;
  color: var(--accent-soft);
  flex-shrink: 0;
}
.rs-titles {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.rs-title {
  color: var(--text-strong);
  font-size: calc(34rpx * var(--font-scale));
  font-weight: 650;
}
.rs-subtitle {
  margin-top: 6rpx;
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rs-action {
  flex-shrink: 0;
  color: var(--accent-soft);
  font-size: calc(25rpx * var(--font-scale));
  padding: 12rpx 22rpx;
}
.rs-tabs {
  display: flex;
  gap: 10rpx;
  padding: 0 2rpx 14rpx;
}
.rs-tab {
  flex: 1;
  padding: 12rpx 0;
  border-radius: 14rpx;
  background: var(--surface);
  color: var(--muted);
  font-size: calc(24rpx * var(--font-scale));
  text-align: center;
  box-shadow: var(--control-shadow);
}
/* 链接用琥珀、工具用紫、知识用青、文件用蓝：与任务卡片上的入口色一致。 */
.rs-tab.link.active {
  background: var(--pause-soft);
  color: var(--pause);
  font-weight: 600;
}
.rs-tab.tool.active {
  background: var(--review-soft);
  color: var(--review);
  font-weight: 600;
}
.rs-tab.knowledge.active {
  background: var(--knowledge-soft);
  color: var(--knowledge);
  font-weight: 600;
}
.rs-tab.memory.active {
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 600;
}
.rs-tab.file.active {
  background: var(--file-soft);
  color: var(--file);
  font-weight: 600;
}
.rs-banner {
  margin: 0 2rpx 12rpx;
  padding: 12rpx 18rpx;
  border-radius: 12rpx;
  background: var(--pause-soft);
}
.rs-banner-text {
  color: var(--pause);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.5;
}
.rs-meta {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 0 2rpx 14rpx;
}
.rs-meta-text {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
}
.rs-meta-hint {
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
}
.rs-meta-action {
  margin-left: auto;
  flex-shrink: 0;
  padding: 4rpx 8rpx;
  color: var(--accent-soft);
  font-size: calc(21rpx * var(--font-scale));
}
/* 刷新跟着计数走（不抢右端），点击热区靠内距补足。 */
.rs-meta-refresh {
  flex-shrink: 0;
  padding: 4rpx 10rpx;
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
}
.rs-scroll {
  flex: 1;
  min-height: 0;
  /* 滚动容器会裁掉横向阴影，左右各借 28rpx 页面留白。 */
  width: calc(100% + 56rpx);
  margin: 0 -28rpx;
}
.rs-content {
  padding: 12rpx 28rpx calc(60rpx + env(safe-area-inset-bottom));
}
.rs-error {
  margin-bottom: 14rpx;
  padding: 16rpx 20rpx;
  border-radius: 14rpx;
  background: var(--stop-soft);
  color: var(--stop);
  font-size: calc(22rpx * var(--font-scale));
}
.rs-empty {
  margin-top: 30rpx;
  padding: 44rpx 30rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
  border-radius: 18rpx;
  background: var(--surface);
}
.rs-empty-title {
  color: var(--text);
  font-size: calc(27rpx * var(--font-scale));
}
.rs-empty-hint {
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.6;
  text-align: center;
}
.rs-card {
  margin-bottom: 16rpx;
  padding: 18rpx 20rpx;
  border-radius: 18rpx;
  background: var(--surface);
  box-shadow: var(--card-shadow);
}
.rs-card:active {
  background: var(--bg-soft);
}
.rs-card-head {
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-bottom: 8rpx;
}
.rs-host {
  color: var(--pause);
  font-size: calc(23rpx * var(--font-scale));
  font-weight: 600;
  max-width: 46%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rs-tool-name {
  color: var(--text-strong);
  font-size: calc(25rpx * var(--font-scale));
  font-weight: 600;
  max-width: 52%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rs-tag {
  flex-shrink: 0;
  padding: 0 12rpx;
  border-radius: 20rpx;
  font-size: calc(19rpx * var(--font-scale));
  line-height: 1.8;
}
.rs-tag.count {
  color: var(--dim);
  background: var(--bg-soft);
}
/* 来源标签（「本任务写入」）：原来 --review 字 + --review-soft 底也是同色系两档，
   深色 claude 低对比下只有 3.57:1。改成 --text-strong 字 + --bg-soft 底后
   384 个组合最低 6.71:1，视觉仍比其他标签弱一档。 */
.rs-tag.source {
  color: var(--text-strong);
  background: var(--bg-soft);
}
/* 记忆分类：主色实心胶囊 + --accent-ink 文字。原来是 --accent-soft 当底、--accent 当字，
   两者是同一色系的深浅两档（默认主题下 accent-soft 本身就是纯白），实测 384 个
   主题 × 对比度 × 饱和度 × 色卡组合全部低于 4.5:1，最低 1:1 完全看不见。
   --accent 与 --accent-ink 是每套主题成对定义的，theme.test.mjs 也守着这条 ≥4.5。 */
.rs-tag.memory {
  color: var(--accent-ink);
  background: var(--accent);
  font-weight: 600;
}
.memory-card .memory-text {
  white-space: pre-wrap;
  word-break: break-word;
}
.rs-tag.risk.risk-read {
  color: var(--resume);
  background: var(--resume-soft);
}
.rs-tag.risk.risk-write {
  color: var(--pause);
  background: var(--pause-soft);
}
.rs-tag.risk.risk-exec {
  color: var(--stop);
  background: var(--stop-soft);
}
.rs-tag.risk.risk-control {
  color: var(--review);
  background: var(--review-soft);
}
.rs-time {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
}
.rs-url {
  display: block;
  color: var(--text);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.55;
  word-break: break-all;
}
.rs-context {
  display: block;
  margin-top: 8rpx;
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.5;
}
.rs-tool-desc {
  display: block;
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.55;
}
.rs-card-foot {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 12rpx;
}
.rs-role,
.rs-tool-state {
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
}
.rs-tool-state.off {
  color: var(--stop);
}
.rs-copy,
.rs-open {
  margin-left: auto;
  color: var(--pause);
  font-size: calc(21rpx * var(--font-scale));
  padding: 4rpx 8rpx;
}
.rs-copy + .rs-open {
  margin-left: 0;
}
</style>
