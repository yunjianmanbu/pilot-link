<template>
  <view class="page knowledge-page" :class="[{ 'theme-light': store.theme === 'light' }, 'accent-' + store.accent, 'btn-scheme-' + store.buttonScheme, 'font-' + store.fontSize, 'contrast-' + store.contrast, 'saturation-' + store.saturation]">
    <view class="kn-header">
      <view class="kn-topbar">
        <view class="kn-back" @click="back"><view class="back-arrow"></view></view>
        <view class="kn-titles">
          <text class="kn-title">{{ pageTitle }}</text>
          <text class="kn-subtitle">{{ subtitle }}</text>
        </view>
        <text v-if="sessionId && scope === 'session'" class="kn-action" @click="openChat">{{ t('原会话') }}</text>
      </view>

      <!-- 三档范围：本会话成对阅读，本项目/全部按消息命中检索。 -->
      <view class="kn-scopes">
        <text
          v-for="option in scopeOptions"
          :key="option.value"
          class="kn-scope"
          :class="{ active: scope === option.value }"
          @click="setScope(option.value)"
        >{{ option.label }}</text>
      </view>

      <view v-if="offline" class="kn-banner">
        <text class="kn-banner-text">{{ t('电脑端离线，当前显示这台手机上缓存的会话记录。') }}</text>
      </view>

      <view class="kn-search">
        <text class="kn-search-icon">⌕</text>
        <input
          v-model="query"
          class="kn-search-input"
          type="text"
          confirm-type="search"
          :placeholder="searchPlaceholder"
          placeholder-class="kn-placeholder"
          @confirm="runSearchNow"
        />
        <text v-if="query" class="kn-search-clear" @click="clearQuery">×</text>
      </view>

      <view class="kn-meta">
        <text v-if="loading" class="kn-meta-text">{{ t('正在整理…') }}</text>
        <text v-else-if="scope !== 'session' && query.trim()" class="kn-meta-text">
          {{ t('命中{v1}条', { v1: total }) }}
        </text>
        <text v-else-if="scope !== 'session'" class="kn-meta-text">
          {{ t('输入关键词搜索{scope}', { scope: scope === 'project' ? t('本项目') : t('全部工作区') }) }}
        </text>
        <text v-else-if="query.trim()" class="kn-meta-text">
          {{ t('命中{v1}条{v2}', { v1: total, v2: hasMore ? t('（显示最近 ') + pairs.length + t(' 条）') : '' }) }}
        </text>
        <text v-else class="kn-meta-text">
          {{ t('{v1}条指令{v2}', { v1: total, v2: hasMore ? t(' · 只显示最近 ') + pairs.length + t(' 条') : '' }) }}
        </text>
        <text v-if="source === 'cache' && !loading" class="kn-source">{{ t('本机缓存') }}</text>
      </view>
    </view>

    <scroll-view class="kn-scroll" scroll-y :show-scrollbar="false">
      <view class="kn-content">
        <view v-if="error" class="kn-error">{{ error }}</view>

        <template v-if="scope !== 'session'">
          <view v-if="!query.trim()" class="kn-empty">
            <text class="kn-empty-title">{{ t('搜索知识库') }}</text>
            <text class="kn-empty-hint">
              {{ scope === 'project' ? t('输入关键词，在这个项目的所有会话里查找。') : t('输入关键词，在所有工作区的会话里查找。') }}
            </text>
          </view>
          <view v-else-if="loading && hits.length === 0" class="kn-empty">
            <text class="kn-empty-title">{{ t('正在搜索…') }}</text>
          </view>
          <view v-else-if="hits.length === 0" class="kn-empty">
            <text class="kn-empty-title">{{ t('没有找到相关内容') }}</text>
            <text class="kn-empty-hint">{{ t('换一个关键词试试，指令和回复都会参与搜索。') }}</text>
          </view>
          <view
            v-for="(hit, index) in hits"
            :key="`${hit.sessionId || ''}-${hit.messageId || index}`"
            class="kn-hit"
            @click="jumpHit(hit)"
          >
            <view class="kn-hit-head">
              <text class="kn-badge" :class="hit.role === 'user' ? 'user' : 'assistant'">
                {{ hit.role === 'user' ? t('我的指令') : t('Pilot 回复') }}
              </text>
              <text class="kn-hit-session">{{ hit.sessionTitle || t('未命名会话') }}</text>
              <text class="kn-hit-time">{{ relativeTime(hit.createdAt) }}</text>
            </view>
            <text class="kn-hit-text" user-select>{{ hit.snippet }}</text>
            <text class="kn-hit-path">{{ hit.workspacePath }}</text>
          </view>
        </template>

        <template v-else>
          <view v-if="!sessionId" class="kn-empty">
            <text class="kn-empty-title">{{ t('还没有选择会话') }}</text>
            <text class="kn-empty-hint">{{ t('从会话页右上角的「知识」进入当前会话的知识库。') }}</text>
          </view>

          <view v-else-if="loading && displayPairs.length === 0" class="kn-empty">
            <text class="kn-empty-title">{{ t('正在整理会话…') }}</text>
            <text class="kn-empty-hint">{{ t('把每一轮指令和对应的回复配对后显示在这里。') }}</text>
          </view>

          <view v-else-if="displayPairs.length === 0" class="kn-empty">
            <text class="kn-empty-title">{{ query.trim() ? t('没有找到相关内容') : t('还没有可整理的对话') }}</text>
            <text class="kn-empty-hint">
              {{ query.trim() ? t('换一个关键词试试，指令和回复都会参与搜索。') : t('在这个会话里完成一轮对话后，指令和回复会自动整理到这里。') }}
            </text>
          </view>

          <view v-for="pair in displayPairs" :key="pair.key" class="kn-pair">
          <view class="kn-pair-head">
            <text class="kn-index">#{{ pair.index }}</text>
            <text class="kn-time">{{ pair.time }}</text>
            <text class="kn-jump" @click="jump(pair, pair.instructionId)">{{ t('定位指令') }}</text>
          </view>

          <view class="kn-block kn-prompt" @click="jump(pair, pair.instructionId)">
            <view class="kn-block-head">
              <text class="kn-badge user">{{ t('我的指令') }}</text>
              <text v-if="pair.pending" class="kn-pending">{{ t('等待回复') }}</text>
              <text v-if="pair.instructionTruncated" class="kn-pending">{{ t('内容较长') }}</text>
            </view>
            <view class="kn-block-text kn-markdown">
              <rich-text :nodes="pair.instructionNodes" />
            </view>
          </view>

          <view v-if="!pair.pending" class="kn-block kn-reply" @click="jump(pair, pair.replyId)">
            <view class="kn-block-head">
              <text class="kn-badge assistant">{{ t('Pilot 回复') }}</text>
              <text v-if="pair.replyCount > 1" class="kn-pending">{{ t('{v1}段', { v1: pair.replyCount }) }}</text>
              <text v-if="pair.replyTruncated" class="kn-pending">{{ t('内容较长') }}</text>
              <text v-if="pair.replyTime" class="kn-block-time">{{ pair.replyTime }}</text>
            </view>
            <view class="kn-block-text kn-markdown">
              <rich-text :nodes="pair.replyNodes" />
            </view>
            <text
              v-if="pair.replyClipped || pair.replyExpanded"
              class="kn-toggle"
              @click.stop="toggleReply(pair)"
            >{{ pair.replyExpanded ? t('收起') : t('展开回复') }}</text>
          </view>
          </view>
        </template>

        <view v-if="scope === 'session' && hasMore && !loading && !error" class="kn-foot">
          <text class="kn-foot-text">{{ t('更早的对话没有全部显示，直接搜索关键词可以找到它们。') }}</text>
        </view>
      </view>
    </scroll-view>

    <app-dialog-host />
  </view>
</template>

<script>
import AppDialogHost from '../../components/app-dialog-host/app-dialog-host.vue'
import { messageTime, relativeTime } from '../../lib/format.js'
import { highlightMarkdownNodes, sortKnowledgePairsNewestFirst } from '../../lib/knowledge.js'
import { renderMarkdown } from '../../lib/markdown.js'
import {
  applySystemBars,
  init,
  loadSessionKnowledge,
  onAppShow,
  searchKnowledge,
  store
} from '../../store/index.js'
import { t } from '../../lib/i18n.js'

const SEARCH_DELAY_MS = 260
const PAIR_LIMIT = 60
const REPLY_PREVIEW_CHARS = 600

export default {
  components: { AppDialogHost },
  data() {
    return {
      sessionId: '',
      fromChat: false,
      // 本会话成对阅读；本项目/全部改为消息命中检索。
      scope: 'session',
      hits: [],
      query: '',
      // 结果高亮用发起请求时的关键词，避免输入过程中高亮和结果错位。
      searchedQuery: '',
      pairs: [],
      total: 0,
      hasMore: false,
      source: 'none',
      loading: false,
      error: '',
      expanded: {},
      searchSeq: 0,
      searchTimer: null,
      loaded: false
    }
  },
  computed: {
    store() {
      return store
    },
    offline() {
      return !store.agentOnline || store.connectionState !== 'connected'
    },
    session() {
      if (!this.sessionId) return null
      const found = store.sessions.find((item) => item.id === this.sessionId)
      if (found) return found
      if (store.currentSessionId === this.sessionId) return store.currentSession
      return null
    },
    sessionTitle() {
      return String(this.session?.title || t("未命名会话"))
    },
    markdownTheme() {
      return store.theme === 'light' ? 'light' : 'dark'
    },
    projectPath() {
      return String(this.session?.workspacePath || store.currentSession?.workspacePath || '')
    },
    projectLabel() {
      const path = this.projectPath.replace(/[\\/]+$/, '')
      const parts = path.split(/[\\/]/).filter(Boolean)
      return parts[parts.length - 1] || path || t("当前项目")
    },
    pageTitle() {
      if (this.scope === 'project') return t("项目知识库")
      if (this.scope === 'all') return t("全部知识库")
      return t("会话知识库")
    },
    searchPlaceholder() {
      if (this.scope === 'project') return t("搜索本项目的指令和回复")
      if (this.scope === 'all') return t("搜索全部工作区的指令和回复")
      return t("搜索本次会话的指令和回复")
    },
    scopeOptions() {
      return [
        { value: 'session', label: t("本会话") },
        { value: 'project', label: t("本项目") },
        { value: 'all', label: t("全部") }
      ]
    },
    subtitle() {
      if (this.scope === 'project') {
        return t("{v1} · 项目搜索", { v1: this.projectLabel })
      }
      if (this.scope === 'all') return t("全部工作区 · 搜索")
      if (!this.sessionId) return t("从会话页进入")
      if (this.loading && this.pairs.length === 0) return t("{v1} · 正在整理", { v1: this.sessionTitle })
      if (this.query.trim()) return t("{v1} · 搜索", { v1: this.sessionTitle })
      return t("{v1} · {v2} 条指令", { v1: this.sessionTitle, v2: this.total })
    },
    displayPairs() {
      const needle = this.searchedQuery
      // 知识库按时间倒序：最新一轮在最上面，与电脑端面板保持一致。
      return sortKnowledgePairsNewestFirst(this.pairs).map((pair) => {
        const reply = String(pair.reply || '')
        const expanded = this.expanded[pair.key] === true
        let text = reply
        let clipped = false
        if (!expanded && reply.length > REPLY_PREVIEW_CHARS) {
          const at = needle ? reply.toLowerCase().indexOf(needle.toLowerCase()) : -1
          if (at > REPLY_PREVIEW_CHARS - 140) {
            const start = Math.max(0, at - 180)
            text = `…${reply.slice(start, start + REPLY_PREVIEW_CHARS)}`
          } else {
            text = reply.slice(0, REPLY_PREVIEW_CHARS)
          }
          clipped = true
        }
        const theme = this.markdownTheme
        return {
          ...pair,
          time: messageTime(pair.instructionAt),
          replyTime: messageTime(pair.replyAt),
          pending: !reply,
          // 知识库是阅读视图：指令和回复都按 Markdown 渲染，搜索命中直接标在节点里。
          instructionNodes: highlightMarkdownNodes(
            renderMarkdown(pair.instruction, { theme }),
            needle
          ),
          replyNodes: highlightMarkdownNodes(renderMarkdown(text, { theme }), needle),
          replyClipped: clipped,
          replyExpanded: expanded
        }
      })
    }
  },
  watch: {
    query() {
      this.scheduleSearch()
    }
  },
  onLoad(options) {
    init()
    const id = typeof options?.sessionId === 'string' ? decodeURIComponent(options.sessionId) : ''
    this.sessionId = id || store.currentSessionId || ''
    this.fromChat = options?.from === 'chat'
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
    clearTimeout(this.searchTimer)
    this.searchTimer = null
    this.searchSeq += 1
  },
  methods: {
    async loadPairs() {
      if (!this.sessionId) return
      const seq = ++this.searchSeq
      const needle = this.query.trim()
      this.loading = true
      this.error = ''
      try {
        const result = await loadSessionKnowledge(this.sessionId, {
          query: needle,
          limit: PAIR_LIMIT
        })
        if (seq !== this.searchSeq) return
        this.pairs = Array.isArray(result?.pairs) ? result.pairs : []
        this.total = Number(result?.total) || this.pairs.length
        this.hasMore = result?.hasMore === true
        this.source = result?.source || 'none'
        this.searchedQuery = needle
      } catch (error) {
        if (seq !== this.searchSeq) return
        this.pairs = []
        this.total = 0
        this.hasMore = false
        this.source = 'none'
        this.error = error?.message || String(error)
      } finally {
        if (seq === this.searchSeq) this.loading = false
      }
    },
    async loadCurrent() {
      if (this.scope === 'session') return this.loadPairs()
      return this.loadHits()
    },
    async loadHits() {
      const needle = this.query.trim()
      if (!needle) {
        this.hits = []
        this.total = 0
        this.hasMore = false
        this.source = 'none'
        this.loading = false
        this.error = ''
        return
      }
      if (this.scope === 'project' && !this.projectPath) {
        this.hits = []
        this.total = 0
        this.loading = false
        this.error = t("当前会话没有工作区，无法按项目搜索。")
        return
      }
      const seq = ++this.searchSeq
      this.loading = true
      this.error = ''
      try {
        const result = await searchKnowledge(needle, {
          limit: PAIR_LIMIT,
          filter: this.scope === 'project' ? { workspacePath: this.projectPath } : {}
        })
        if (seq !== this.searchSeq) return
        this.hits = Array.isArray(result?.hits) ? result.hits : []
        this.total = this.hits.length
        this.hasMore = false
        this.source = result?.source || 'none'
        this.searchedQuery = needle
      } catch (error) {
        if (seq !== this.searchSeq) return
        this.hits = []
        this.total = 0
        this.source = 'none'
        this.error = error?.message || String(error)
      } finally {
        if (seq === this.searchSeq) this.loading = false
      }
    },
    setScope(value) {
      const next = value === 'project' || value === 'all' ? value : 'session'
      if (next === this.scope) return
      this.scope = next
      this.hits = []
      this.pairs = []
      this.total = 0
      this.hasMore = false
      this.source = 'none'
      this.error = ''
      this.expanded = {}
      clearTimeout(this.searchTimer)
      this.searchTimer = null
      this.searchSeq += 1
      void this.loadCurrent()
    },
    scheduleSearch() {
      clearTimeout(this.searchTimer)
      this.searchTimer = null
      this.expanded = {}
      // 输入一变就让在途请求作废，避免旧关键词的结果短暂覆盖新结果。
      this.searchSeq += 1
      if (this.scope === 'session' && !this.sessionId) return
      if (!this.query.trim() && this.scope !== 'session') {
        this.hits = []
        this.total = 0
        this.loading = false
        this.error = ''
        return
      }
      this.loading = true
      this.searchTimer = setTimeout(() => {
        this.searchTimer = null
        void this.loadCurrent()
      }, SEARCH_DELAY_MS)
    },
    runSearchNow() {
      clearTimeout(this.searchTimer)
      this.searchTimer = null
      void this.loadCurrent()
    },
    clearQuery() {
      this.query = ''
    },
    toggleReply(pair) {
      this.expanded = { ...this.expanded, [pair.key]: !this.expanded[pair.key] }
    },
    jump(pair, messageId) {
      const id = String(messageId || '')
      if (!id || !this.sessionId) return
      if (this.fromChat) {
        try {
          const channel = this.getOpenerEventChannel?.()
          if (channel && typeof channel.emit === 'function') {
            channel.emit('focusMessage', id)
            uni.navigateBack()
            return
          }
        } catch {
          // 事件通道不可用时退回普通跳转。
        }
      }
      uni.navigateTo({
        url: `/pages/chat/index?id=${encodeURIComponent(
          this.sessionId
        )}&focus=${encodeURIComponent(id)}`
      })
    },
    jumpHit(hit) {
      const sessionId = String(hit?.sessionId || '')
      const messageId = String(hit?.messageId || '')
      if (!sessionId) return
      if (this.fromChat && sessionId === this.sessionId && messageId) {
        try {
          const channel = this.getOpenerEventChannel?.()
          if (channel && typeof channel.emit === 'function') {
            channel.emit('focusMessage', messageId)
            uni.navigateBack()
            return
          }
        } catch {
          // 事件通道不可用时退回普通跳转。
        }
      }
      const focus = messageId ? `&focus=${encodeURIComponent(messageId)}` : ''
      uni.navigateTo({
        url: `/pages/chat/index?id=${encodeURIComponent(sessionId)}${focus}`
      })
    },
    openChat() {
      if (!this.sessionId) return
      try {
        const pages = getCurrentPages()
        const previous = pages.length > 1 ? pages[pages.length - 2] : null
        if (previous?.route === 'pages/chat/index') {
          uni.navigateBack()
          return
        }
      } catch {
        // ignore
      }
      uni.navigateTo({
        url: `/pages/chat/index?id=${encodeURIComponent(this.sessionId)}`
      })
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
.knowledge-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  padding: calc(var(--status-bar-height) + 20rpx) 28rpx 0;
  box-sizing: border-box;
}
.kn-header {
  flex-shrink: 0;
}
.kn-topbar {
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 4rpx 2rpx 18rpx;
}
.kn-back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56rpx;
  height: 56rpx;
  /* 标题下面是副标题，箭头要对齐第一行而不是整个两行块。
     标题行高 34rpx × 1.5 = 51rpx，图标框上移半个差值。 */
  align-self: flex-start;
  margin-top: -3rpx;
  margin-right: 2rpx;
  color: var(--accent-soft);
  flex-shrink: 0;
}
.kn-titles {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.kn-title {
  color: var(--text-strong);
  font-size: calc(34rpx * var(--font-scale));
  font-weight: 650;
}
.kn-subtitle {
  margin-top: 6rpx;
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kn-action {
  flex-shrink: 0;
  color: var(--accent-soft);
  font-size: calc(25rpx * var(--font-scale));
  padding: 12rpx 22rpx;
  border-radius: 999rpx;
  background: var(--surface);
  box-shadow: var(--control-shadow);
}
.kn-scopes {
  display: flex;
  gap: 10rpx;
  padding: 0 2rpx 16rpx;
}
.kn-scope {
  flex: 1;
  padding: 12rpx 0;
  border-radius: 14rpx;
  background: var(--surface);
  color: var(--muted);
  font-size: calc(24rpx * var(--font-scale));
  text-align: center;
  box-shadow: var(--control-shadow);
}
.kn-scope.active {
  background: var(--knowledge-soft);
  color: var(--knowledge);
  font-weight: 600;
}
.kn-hit {
  margin-bottom: 18rpx;
  padding: 18rpx 20rpx;
  border-radius: 18rpx;
  background: var(--surface);
  box-shadow: var(--card-shadow);
}
.kn-hit:active {
  background: var(--hover);
}
.kn-hit-head {
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-bottom: 10rpx;
}
.kn-hit-session {
  flex: 1;
  min-width: 0;
  color: var(--text);
  font-size: calc(22rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kn-hit-time {
  flex: none;
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
}
.kn-hit-text {
  display: block;
  color: var(--muted);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}
.kn-hit-path {
  display: block;
  margin-top: 10rpx;
  color: var(--dim);
  font-size: calc(19rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kn-banner {
  margin-bottom: 16rpx;
  padding: 16rpx 20rpx;
  border-radius: 14rpx;
  background: var(--pause-soft);
}
.kn-banner-text {
  color: var(--text);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.5;
}
.kn-search {
  display: flex;
  align-items: center;
  gap: 12rpx;
  height: 82rpx;
  padding: 0 20rpx;
  border-radius: 20rpx;
  background: var(--input-bg);
  box-sizing: border-box;
}
.kn-search-icon {
  color: var(--muted);
  font-size: calc(30rpx * var(--font-scale));
  line-height: 1;
  flex-shrink: 0;
}
.kn-search-input {
  flex: 1;
  min-width: 0;
  color: var(--text);
  font-size: calc(27rpx * var(--font-scale));
}
.kn-placeholder {
  color: var(--dim);
}
.kn-search-clear {
  color: var(--muted);
  font-size: calc(34rpx * var(--font-scale));
  line-height: 1;
  padding: 4rpx 8rpx;
  flex-shrink: 0;
}
.kn-meta {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 16rpx 4rpx 14rpx;
}
.kn-meta-text {
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kn-source {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--pause);
  font-size: calc(20rpx * var(--font-scale));
  background: var(--pause-soft);
  border-radius: 20rpx;
  padding: 2rpx 12rpx;
}
.kn-scroll {
  flex: 1;
  min-height: 0;
  /* 滚动容器会裁掉横向阴影，向左右借 28rpx 页面留白；宽度同步加宽，
     否则只向左偏移，右侧会空出一条。内容再用内边距放回原位。 */
  width: calc(100% + 56rpx);
  margin: 0 -28rpx;
}
.kn-content {
  /* 顶部留白让第一张卡片的上方光晕有地方画。 */
  padding: 12rpx 28rpx calc(60rpx + env(safe-area-inset-bottom));
}
.kn-error {
  margin-bottom: 14rpx;
  padding: 16rpx 20rpx;
  border-radius: 14rpx;
  background: var(--stop-soft);
  color: var(--stop);
  font-size: calc(22rpx * var(--font-scale));
}
.kn-empty {
  margin-top: 30rpx;
  padding: 44rpx 30rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
  border-radius: 18rpx;
  background: var(--surface);
}
.kn-empty-title {
  color: var(--text);
  font-size: calc(27rpx * var(--font-scale));
}
.kn-empty-hint {
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.6;
  text-align: center;
}
.kn-pair {
  margin-bottom: 20rpx;
  border-radius: 20rpx;
  background: var(--surface);
  box-shadow: var(--card-shadow);
  overflow: hidden;
}
.kn-pair-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 14rpx 20rpx;
  background: var(--bg-soft);
}
.kn-index {
  color: var(--knowledge);
  font-size: calc(21rpx * var(--font-scale));
  font-weight: 600;
}
.kn-time {
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
}
.kn-jump {
  margin-left: auto;
  color: var(--knowledge);
  font-size: calc(21rpx * var(--font-scale));
  padding: 4rpx 8rpx;
}
.kn-block {
  padding: 18rpx 20rpx;
}
.kn-block + .kn-block {
  padding-top: 22rpx;
}
.kn-block:active {
  background: var(--hover);
}
.kn-block-head {
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-bottom: 10rpx;
}
.kn-badge {
  font-size: calc(19rpx * var(--font-scale));
  line-height: 1.7;
  padding: 0 12rpx;
  border-radius: 20rpx;
}
.kn-badge.user {
  color: var(--knowledge);
  background: var(--knowledge-soft);
}
.kn-badge.assistant {
  color: var(--accent-soft);
  background: var(--accent-wash);
}
.kn-pending {
  color: var(--dim);
  font-size: calc(19rpx * var(--font-scale));
}
.kn-block-time {
  margin-left: auto;
  color: var(--dim);
  font-size: calc(19rpx * var(--font-scale));
}
.kn-block-text {
  color: var(--muted);
  font-size: calc(25rpx * var(--font-scale));
  line-height: 1.68;
  word-break: break-word;
  white-space: pre-wrap;
}
.kn-prompt .kn-block-text {
  color: var(--text-strong);
}
.kn-markdown {
  white-space: normal;
}
.kn-markdown rich-text {
  font-size: calc(25rpx * var(--font-scale));
  line-height: 1.68;
  word-break: break-word;
}
.kn-toggle {
  display: inline-block;
  margin-top: 12rpx;
  color: var(--accent-soft);
  font-size: calc(22rpx * var(--font-scale));
  padding: 4rpx 0;
}
.kn-hl {
  color: var(--accent-soft);
  background: rgba(143, 168, 192, 0.18);
  border-radius: 4rpx;
  font-weight: 600;
}
.kn-foot {
  padding: 10rpx 8rpx 20rpx;
}
.kn-foot-text {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.6;
}
</style>
