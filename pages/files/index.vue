<template>
  <view class="page files-page" :class="[{ 'theme-light': store.theme === 'light' }, 'accent-' + store.accent, 'btn-scheme-' + store.buttonScheme, 'font-' + store.fontSize, 'contrast-' + store.contrast, 'saturation-' + store.saturation]">
    <view class="topbar">
      <view class="back" @click="back"><view class="back-arrow"></view></view>
      <view class="titles">
        <text class="title">{{ tab === 'workspace' ? t('工作区文件') : t('生成文件') }}</text>
        <text class="subtitle">{{ subtitle }}</text>
      </view>
      <text class="refresh" @click="refreshCurrent">{{ t('刷新') }}</text>
    </view>

    <!-- 会话文件只看本次产物；工作区标签浏览整个项目目录。 -->
    <view class="tabs">
      <text
        class="tab"
        :class="{ active: tab === 'session' }"
        @click="switchTab('session')"
      >{{ t('会话文件') }}</text>
      <text
        class="tab"
        :class="{ active: tab === 'workspace' }"
        @click="switchTab('workspace')"
      >{{ t('工作区') }}</text>
    </view>

    <scroll-view class="list" scroll-y>
      <template v-if="tab === 'session'">
        <view v-if="loading && !files.length" class="state">
          <text class="state-text">{{ t('正在读取文件列表…') }}</text>
        </view>
        <view v-else-if="error" class="state error" @click="load">
          <text class="state-text">{{ error }}</text>
          <text class="state-action">{{ t('点击重试') }}</text>
        </view>
        <view v-else-if="!files.length" class="state">
          <text class="empty-title">{{ t('还没有生成文件') }}</text>
          <text class="empty-hint">
            {{ t('让 Pilot 写文件、生成报告后，文件会出现在这里，可以直接在手机上预览。') }}
          </text>
        </view>

        <view
          v-for="file in files"
          :key="file.path"
          class="file-row"
          @click="open(file)"
        >
          <view class="file-badge" :class="kindOf(file)">{{ badge(file) }}</view>
          <view class="file-main">
            <text class="file-name">{{ file.name }}</text>
            <text class="file-meta">{{ metaLabel(file) }}</text>
            <text class="file-path">{{ file.path }}</text>
          </view>
          <text class="file-go">›</text>
        </view>

        <view v-if="files.length" class="list-hint">
          {{ t('只显示当前会话写过且写入成功的文件；文本、图片和 HTML 可直接预览，Word/PPT/Excel/PDF 会下载后用手机上的应用打开。') }}
        </view>
      </template>

      <template v-else>
        <view class="ws-bar">
          <text v-if="workspaceDir" class="ws-up" @click="workspaceUp">{{ t('↑ 上一级') }}</text>
          <text class="ws-dir">/{{ workspaceDir || '' }}</text>
        </view>
        <view v-if="workspaceLoading && !workspaceNodes.length" class="state">
          <text class="state-text">{{ t('正在读取目录…') }}</text>
        </view>
        <view v-else-if="workspaceError" class="state error" @click="loadWorkspace()">
          <text class="state-text">{{ workspaceError }}</text>
          <text class="state-action">{{ t('点击重试') }}</text>
        </view>
        <view v-else-if="!workspaceRows.length" class="state">
          <text class="empty-title">{{ t('这个目录是空的') }}</text>
          <text class="empty-hint">{{ t('换个目录看看，或者回到会话让 Pilot 生成文件。') }}</text>
        </view>

        <view
          v-for="node in workspaceRows"
          :key="node.path"
          class="file-row"
          @click="openNode(node)"
        >
          <view class="file-badge" :class="node.type === 'dir' ? 'dir' : kindOf(node)">{{ nodeBadge(node) }}</view>
          <view class="file-main">
            <text class="file-name">{{ node.name }}</text>
            <text class="file-meta">{{ nodeMeta(node) }}</text>
            <text class="file-path">{{ node.path }}</text>
          </view>
          <text class="file-go">›</text>
        </view>

        <view v-if="workspaceRows.length" class="list-hint">
          {{ t('只读浏览：点文件即可预览，修改仍要在电脑端进行。') }}
        </view>
      </template>
      <view class="list-bottom"></view>
    </scroll-view>
    <app-dialog-host />
  </view>
</template>

<script>
import AppDialogHost from '../../components/app-dialog-host/app-dialog-host.vue'
import { LONG_TIMEOUT } from '../../lib/client.js'
import { fileActionLabel, fileBadge, fileKind } from '../../lib/files.js'
import { init, request, store } from '../../store/index.js'
import { t } from '../../lib/i18n.js'

export default {
  components: { AppDialogHost },
  data() {
    return {
      sessionId: '',
      sessionTitle: '',
      workspacePath: '',
      files: [],
      loading: true,
      error: '',
      tab: 'session',
      workspaceNodes: [],
      workspaceLoading: false,
      workspaceError: '',
      workspaceDir: '',
      workspaceSeq: 0
    }
  },
  computed: {
    store() {
      return store
    },
    subtitle() {
      if (this.tab === 'workspace') {
        return this.workspaceDir
          ? `/${this.workspaceDir}`
          : t("工作区根目录")
      }
      if (this.sessionTitle) return this.sessionTitle
      return this.files.length ? t("{v1} 个文件", { v1: this.files.length }) : t("当前会话")
    },
    workspaceRows() {
      // 目录排在文件前面，再按名称排序，远程浏览时更容易找到入口。
      return [...this.workspaceNodes].sort((left, right) => {
        if (left.type !== right.type) return left.type === 'dir' ? -1 : 1
        return String(left.name || '').localeCompare(String(right.name || ''))
      })
    }
  },
  onLoad(options) {
    init()
    this.sessionId = options?.sessionId
      ? decodeURIComponent(options.sessionId)
      : store.currentSessionId
    const session =
      store.currentSession ||
      store.sessions.find((item) => item.id === this.sessionId) ||
      null
    this.sessionTitle = session?.title || ''
    this.workspacePath = session?.cwd || session?.workspacePath || ''
    void this.load()
  },
  methods: {
    actionLabel: fileActionLabel,
    badge: fileBadge,
    kindOf(file) {
      return fileKind(file?.name || file?.path)
    },
    switchTab(tab) {
      const next = tab === 'workspace' ? 'workspace' : 'session'
      if (next === this.tab) return
      this.tab = next
      if (next === 'workspace' && !this.workspaceNodes.length && !this.workspaceLoading) {
        void this.loadWorkspace()
      }
    },
    refreshCurrent() {
      if (this.tab === 'workspace') void this.loadWorkspace()
      else void this.load()
    },
    async loadWorkspace(directory = this.workspaceDir) {
      if (this.workspaceLoading) return
      if (!this.workspacePath) {
        await this.resolveWorkspace().catch(() => undefined)
      }
      if (!this.workspacePath) {
        this.workspaceError = t("当前任务没有工作区")
        return
      }
      if (store.connectionState !== 'connected') {
        this.workspaceError = t("电脑连接已断开，请回到会话页重连后重试")
        return
      }
      const seq = ++this.workspaceSeq
      this.workspaceLoading = true
      this.workspaceError = ''
      try {
        const data = await request(
          'files.list',
          { workspacePath: this.workspacePath, directory: directory || '.' },
          LONG_TIMEOUT
        )
        if (seq !== this.workspaceSeq) return
        this.workspaceNodes = Array.isArray(data?.nodes) ? data.nodes.filter(Boolean) : []
        const current = String(data?.directory || '')
        this.workspaceDir = current === '.' ? '' : current
      } catch (error) {
        if (seq !== this.workspaceSeq) return
        this.workspaceNodes = []
        this.workspaceError = String(error?.message || t("读取目录失败"))
      } finally {
        if (seq === this.workspaceSeq) this.workspaceLoading = false
      }
    },
    workspaceUp() {
      if (!this.workspaceDir) return
      const parent = this.workspaceDir.split('/').slice(0, -1).join('/')
      void this.loadWorkspace(parent)
    },
    openNode(node) {
      if (!node?.path) return
      if (node.type === 'dir') {
        void this.loadWorkspace(node.path)
        return
      }
      this.openWorkspaceFile(node)
    },
    openWorkspaceFile(node) {
      if (!node?.path) return
      const query = [
        `path=${encodeURIComponent(node.path)}`,
        `name=${encodeURIComponent(node.name || '')}`,
        'action=',
        `workspace=${encodeURIComponent(this.workspacePath || '')}`
      ].join('&')
      uni.navigateTo({ url: `/pages/file/index?${query}` })
    },
    nodeBadge(node) {
      if (node?.type === 'dir') return t("目录")
      return fileBadge({ name: node?.name, path: node?.path })
    },
    nodeMeta(node) {
      if (node?.type === 'dir') return t("文件夹")
      return this.sizeLabel(node?.size)
    },
    sizeLabel(size) {
      const bytes = Number(size)
      if (!Number.isFinite(bytes) || bytes <= 0) return ''
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    },
    metaLabel(file) {
      const parts = [fileActionLabel(file?.action)]
      if (file?.tool) parts.push(file.tool)
      return parts.filter(Boolean).join(' · ')
    },
    async load() {
      if (this.loadingRequest) return
      if (!this.sessionId) {
        this.loading = false
        this.error = t("缺少会话 ID，请返回会话后重试")
        return
      }
      if (store.connectionState !== 'connected') {
        this.loading = false
        this.error = t("电脑连接已断开，请回到会话页重连后重试")
        return
      }
      this.loadingRequest = true
      this.loading = true
      this.error = ''
      try {
        const data = await request('files.session', { sessionId: this.sessionId }, LONG_TIMEOUT)
        const artifacts = Array.isArray(data?.artifacts) ? data.artifacts : []
        this.files = artifacts.filter((item) => item && item.path)
        if (!this.workspacePath) await this.resolveWorkspace()
      } catch (error) {
        const message = String(error?.message || t("读取文件列表失败"))
        this.error = message.includes(t("手机端不支持"))
          ? t("电脑端版本过低，请先在电脑上更新 Pilot")
          : message
      } finally {
        this.loadingRequest = false
        this.loading = false
      }
    },
    async resolveWorkspace() {
      const session =
        store.currentSession?.id === this.sessionId ? store.currentSession : null
      if (session?.cwd || session?.workspacePath) {
        this.workspacePath = session.cwd || session.workspacePath
        return
      }
      const data = await request(
        'sessions.get',
        { sessionId: this.sessionId, limit: 1 },
        LONG_TIMEOUT
      )
      this.workspacePath = data?.session?.workspacePath || ''
    },
    open(file) {
      if (!file?.path) return
      const query = [
        `path=${encodeURIComponent(file.path)}`,
        `name=${encodeURIComponent(file.name || '')}`,
        `action=${encodeURIComponent(file.action || '')}`,
        `workspace=${encodeURIComponent(this.workspacePath || '')}`
      ].join('&')
      uni.navigateTo({ url: `/pages/file/index?${query}` })
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
.files-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
}
.topbar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: calc(var(--status-bar-height) + 20rpx) 28rpx 26rpx;
  flex-shrink: 0;
}
.back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56rpx;
  height: 56rpx;
  /* 标题下面是副标题，箭头要对齐第一行而不是整个两行块。
     标题行高 36rpx × 1.5 = 54rpx，图标框上移半个差值。 */
  align-self: flex-start;
  margin-top: -1rpx;
  margin-right: 2rpx;
  color: var(--accent-soft);
  flex-shrink: 0;
}
.titles {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.title {
  color: var(--text-strong);
  font-size: calc(36rpx * var(--font-scale));
  font-weight: 650;
}
.subtitle {
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.refresh {
  color: var(--file);
  font-size: calc(24rpx * var(--font-scale));
  padding: 10rpx 0 10rpx 16rpx;
  flex-shrink: 0;
}
.tabs {
  display: flex;
  gap: 12rpx;
  padding: 0 28rpx 18rpx;
  flex-shrink: 0;
}
.tab {
  flex: 1;
  padding: 14rpx 0;
  border-radius: 14rpx;
  background: var(--surface);
  color: var(--muted);
  font-size: calc(25rpx * var(--font-scale));
  text-align: center;
  box-shadow: var(--control-shadow);
}
.tab.active {
  background: var(--file-soft);
  color: var(--file);
  font-weight: 600;
}
.list {
  flex: 1;
  min-height: 0;
  padding: 0 28rpx;
  box-sizing: border-box;
}
.ws-bar {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 2rpx 4rpx 16rpx;
}
.ws-up {
  flex: none;
  color: var(--accent-soft);
  font-size: calc(23rpx * var(--font-scale));
  padding: 8rpx 14rpx;
  border-radius: 12rpx;
  background: var(--surface);
}
.ws-dir {
  flex: 1;
  min-width: 0;
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
.file-badge.dir {
  background: var(--pause-soft);
  color: var(--pause);
}
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14rpx;
  padding: 90rpx 30rpx;
  text-align: center;
}
.state.error .state-text {
  color: var(--stop);
}
.state-text {
  color: var(--muted);
  font-size: calc(25rpx * var(--font-scale));
  line-height: 1.6;
}
.state-action {
  color: var(--accent-soft);
  font-size: calc(24rpx * var(--font-scale));
}
.empty-title {
  color: var(--text);
  font-size: calc(29rpx * var(--font-scale));
  font-weight: 600;
}
.empty-hint {
  color: var(--muted);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.65;
  max-width: 560rpx;
}
.file-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 22rpx 22rpx;
  margin-bottom: 14rpx;
  background: var(--surface);
  border-radius: 18rpx;
}
.file-row:active {
  background: var(--surface-2);
}
.file-badge {
  width: 84rpx;
  height: 84rpx;
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: calc(21rpx * var(--font-scale));
  font-weight: 700;
  letter-spacing: 1rpx;
  background: var(--file-soft);
  color: var(--file);
  flex-shrink: 0;
}
.file-badge.markdown,
.file-badge.text {
  background: var(--resume-soft);
  color: var(--resume);
}
.file-badge.image {
  background: var(--pause-soft);
  color: var(--pause);
}
.file-badge.video,
.file-badge.audio {
  background: var(--resume-soft);
  color: var(--resume);
}
.file-badge.document {
  background: var(--review-soft);
  color: var(--review);
}
.file-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.file-name {
  color: var(--text-strong);
  font-size: calc(27rpx * var(--font-scale));
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-meta {
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
}
.file-path {
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-go {
  color: var(--file);
  font-size: calc(38rpx * var(--font-scale));
  flex-shrink: 0;
}
.list-hint {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.6;
  text-align: center;
  padding: 12rpx 20rpx 0;
}
.list-bottom {
  height: calc(40rpx + env(safe-area-inset-bottom));
}
</style>
