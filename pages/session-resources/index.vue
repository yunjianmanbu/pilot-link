<template>
  <view class="page resources-page" :class="[{ 'theme-light': store.theme === 'light' }, 'accent-' + store.accent, 'btn-scheme-' + store.buttonScheme, 'font-' + store.fontSize, 'contrast-' + store.contrast, 'saturation-' + store.saturation]">
    <view class="rs-header">
      <view class="rs-topbar">
        <view class="rs-back" @click="back"><view class="back-arrow"></view></view>
        <view class="rs-titles">
          <text class="rs-title">{{ t('会话资源') }}</text>
          <text class="rs-subtitle">{{ subtitle }}</text>
        </view>
        <text v-if="sessionId" class="rs-action" @click="openChat">{{ t('原会话') }}</text>
      </view>

      <!-- 四个分类共用一页：任务卡片的快捷入口带 tab 参数进来，这里可以互相切换。 -->
      <view class="rs-tabs">
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
          <view v-else-if="links.length === 0 && !error" class="rs-empty">
            <text class="rs-empty-title">{{ t('这个任务里还没有链接') }}</text>
            <text class="rs-empty-hint">{{ t('你和 Pilot 的正文里出现的 http/https 链接会收集到这里。') }}</text>
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
              <text class="rs-open" @click.stop="openLink(link)">{{ t('打开链接') }}</text>
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
            <text v-if="tool.description" class="rs-tool-desc">{{ tool.description }}</text>
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
import { fileActionLabel } from '../../lib/files.js'
import { relativeTime } from '../../lib/format.js'
import { t } from '../../lib/i18n.js'
import {
  applySystemBars,
  init,
  loadSessionKnowledge,
  loadSessionLinks,
  loadSessionTools,
  onAppShow,
  request,
  store
} from '../../store/index.js'

const LINK_LIMIT = 60
const TOOL_LIMIT = 120
const KNOWLEDGE_LIMIT = 60
/** 知识库卡片只给一眼摘要，完整内容到知识库页面里看。 */
const PREVIEW_CHARS = 160
const TABS = ['links', 'tools', 'knowledge', 'files']

export default {
  data() {
    return {
      sessionId: '',
      // links / tools / knowledge / files：四个快捷入口各自落到对应分类。
      tab: 'links',
      links: [],
      tools: [],
      // 知识库按电脑端的正序返回，展示时倒序（最新一轮在最上面）。
      knowledgePairs: [],
      files: [],
      // 四个分类各记各的来源与截断状态，切换时不会串。
      linkTotal: 0,
      toolTotal: 0,
      knowledgeTotal: 0,
      fileTotal: 0,
      linkHasMore: false,
      toolHasMore: false,
      knowledgeHasMore: false,
      linkSource: 'none',
      toolSource: 'none',
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
      loadedKnowledge: false,
      loadedFiles: false,
      seq: 0
    }
  },
  computed: {
    store() {
      return store
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
    subtitle() {
      if (!this.sessionId) return t('未命名会话')
      if (this.loading) return t('{v1} · 正在读取', { v1: this.sessionTitle })
      return this.sessionTitle
    },
    current() {
      if (this.tab === 'links') return this.links
      if (this.tab === 'tools') return this.tools
      if (this.tab === 'knowledge') return this.pairs
      return this.files
    },
    total() {
      if (this.tab === 'links') return this.linkTotal
      if (this.tab === 'tools') return this.toolTotal
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
      if (this.tab === 'knowledge') return t('正在读取知识库…')
      return t('正在读取文件…')
    },
    countText() {
      if (this.tab === 'links') return t('{v1} 条链接', { v1: this.total })
      if (this.tab === 'tools') return t('{v1} 个工具', { v1: this.total })
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
    /** 离线/旧版本/读取失败各自的说明，不把空列表当成功。 */
    banner() {
      if (this.loading) return ''
      if (this.tab === 'links' && this.source === 'cache') {
        return t('电脑端离线，链接来自这台手机缓存的会话正文。')
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
    }
  },
  onLoad(options) {
    init()
    const id = typeof options?.sessionId === 'string' ? decodeURIComponent(options.sessionId) : ''
    this.sessionId = id || store.currentSessionId || ''
    // 从某个快捷入口进来的直接停在对应分类。
    this.tab = TABS.includes(options?.tab) ? options.tab : 'links'
  },
  onShow() {
    init()
    applySystemBars()
    if (!store.pairing) {
      uni.reLaunch({ url: '/pages/pair/index' })
      return
    }
    onAppShow()
    if (!this.loaded) {
      this.loaded = true
      void this.loadCurrent()
    }
  },
  onUnload() {
    this.seq += 1
  },
  methods: {
    async loadCurrent() {
      if (!this.sessionId) return
      if (this.tab === 'links') await this.loadLinks()
      else if (this.tab === 'tools') await this.loadTools()
      else if (this.tab === 'knowledge') await this.loadKnowledge()
      else await this.loadFiles()
    },
    async loadLinks() {
      if (!this.sessionId) return
      const seq = ++this.seq
      this.loading = true
      this.error = ''
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
        this.links = []
        this.linkTotal = 0
        this.linkHasMore = false
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
      if (store.connectionState !== 'connected') {
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
    setTab(tab) {
      if (!TABS.includes(tab)) return
      if (this.tab === tab) return
      this.tab = tab
      this.error = ''
      // 已经加载过的分类直接复用结果，切换不再请求。
      const loaded = {
        links: this.loadedLinks,
        tools: this.loadedTools,
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
.rs-tag.source {
  color: var(--review);
  background: var(--review-soft);
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
