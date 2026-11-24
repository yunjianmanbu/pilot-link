<template>
  <view class="learning-panel">
    <view class="lp-header">
      <view class="lp-panel-head">
        <text class="lp-panel-title">{{ t('自主探索学习') }}</text>
        <text class="lp-panel-subtitle">{{ workspaceLabel }}</text>
        <text
          class="lp-refresh"
          :class="{ disabled: loading || busy }"
          @click="load"
        >{{ loading ? t('读取中…') : t('刷新') }}</text>
      </view>

      <view
        v-if="workspaceOptions.length > 0"
        class="lp-project"
        @click="openWorkspacePicker"
      >
        <view class="lp-project-main">
          <text class="lp-project-label">{{ t('项目') }}</text>
          <text class="lp-project-name">{{ workspaceName }}</text>
          <text
            v-if="workspacePath && workspacePath !== workspaceName"
            class="lp-project-path"
          >{{ workspacePath }}</text>
        </view>
        <text class="lp-project-caret">▾</text>
      </view>

      <view class="lp-intro">
        <text class="lp-badge">{{ t('只读研究') }}</text>
        <text class="lp-intro-text">
          {{ t('开启后，智能体可以从白名单公开站点只读搜集资料，自己决定做什么任务，并把来源、任务和阶段成果记进工作区的学习账本。') }}
        </text>
      </view>

      <view v-if="state" class="lp-stats">
        <view class="lp-stat">
          <text class="lp-stat-value">{{ summary.sources || 0 }}</text>
          <text class="lp-stat-label">{{ t('来源') }}</text>
        </view>
        <view class="lp-stat">
          <text class="lp-stat-value">{{ summary.tasks || 0 }}</text>
          <text class="lp-stat-label">{{ t('任务') }}</text>
        </view>
        <view class="lp-stat">
          <text class="lp-stat-value">{{ summary.pending || 0 }}</text>
          <text class="lp-stat-label">{{ t('待确认') }}</text>
        </view>
        <view class="lp-stat">
          <text class="lp-stat-value">{{ formatPercent(summary.approvalRate) }}</text>
          <text class="lp-stat-label">{{ t('通过率') }}</text>
        </view>
      </view>
    </view>

    <view class="lp-scroll">
      <view class="lp-content">
        <view v-if="!connected" class="lp-empty">
          <text class="lp-empty-title">{{ t('还没有连接电脑') }}</text>
          <text class="lp-empty-hint">{{ t('连接电脑后才能设置和查看自主探索学习。') }}</text>
        </view>

        <view v-else-if="loading && !state" class="lp-empty">
          <text class="lp-empty-title">{{ t('正在读取学习状态…') }}</text>
        </view>

        <view v-else-if="!workspacePath" class="lp-empty">
          <text class="lp-empty-title">{{ t('还没有打开工作区') }}</text>
          <text class="lp-empty-hint">{{ t('先在电脑端打开一个工作区，或在会话页选择一个项目。') }}</text>
        </view>

        <view v-else-if="error && !state" class="lp-empty">
          <text class="lp-empty-title">{{ t('读取学习状态失败') }}</text>
          <text class="lp-empty-hint">{{ error }}</text>
          <button class="btn ghost small-btn lp-retry" @click="load">{{ t('重试') }}</button>
        </view>

        <view v-else-if="!state" class="lp-empty">
          <text class="lp-empty-title">{{ t('没有读取到学习状态') }}</text>
          <text class="lp-empty-hint">{{ t('请点刷新重试。') }}</text>
          <button class="btn ghost small-btn lp-retry" @click="load">{{ t('重试') }}</button>
        </view>

        <template v-else>
          <view v-if="error" class="lp-error" @click="error = ''">
            <text class="lp-error-text">{{ error }}</text>
          </view>

          <view class="lp-card">
            <view class="lp-card-head">
              <view class="lp-card-heading">
                <text class="lp-card-title">{{ t('自主探索学习') }}</text>
                <text class="lp-card-hint">
                  {{ enabled ? t('已开启：智能体可以自己选题并只读查资料。') : t('已关闭：智能体不会发起任何网络读取。') }}
                </text>
              </view>
              <view class="lp-toggle-wrap" @click="toggleEnabled">
                <view class="lp-toggle" :class="{ on: enabled, disabled: busy === 'toggle' }">
                  <view class="lp-toggle-knob"></view>
                </view>
                <text class="lp-toggle-label" :class="{ on: enabled }">{{ enabled ? t('已开启') : t('已关闭') }}</text>
              </view>
            </view>
            <text class="lp-safety">
              {{ t('请求只允许 GET/HEAD，且只能访问白名单主机；本机、内网和云元数据地址一律拒绝。抓到的内容只落在工作区，上传、提交、发布、推送类命令会被拒绝。') }}
            </text>
            <text class="lp-note">
              {{ t('每个阶段成果都要你确认才算完成；智能体不能把自己的成果标成已通过。') }}
            </text>
          </view>

          <view class="lp-card">
            <view class="lp-card-head">
              <view class="lp-card-heading">
                <text class="lp-card-title">{{ t('学习来源白名单') }}</text>
                <text class="lp-card-hint">{{ t('每行一个主机名；留空时使用内置公开站点。') }}</text>
              </view>
            </view>
            <textarea
              v-model="hostsDraft"
              class="lp-textarea"
              :disabled="busy !== '' || !connected"
              :placeholder="defaultHosts.join('\n')"
              :maxlength="4000"
            />
            <text class="lp-note">
              {{ t('默认白名单：{v1}', { v1: defaultHostsText }) }}
            </text>
            <text class="lp-note">
              {{ t('实际生效：{v1}', { v1: effectiveHostsText }) }}
            </text>
            <view class="lp-actions">
              <button
                class="btn ghost small-btn"
                :disabled="busy !== '' || !connected"
                @click="useDefaultHosts"
              >{{ t('填入默认白名单') }}</button>
              <button
                class="btn primary small-btn"
                :disabled="busy !== '' || !connected || !hostsDirty"
                @click="saveHosts"
              >{{ busy === 'hosts' ? t('保存中…') : t('保存白名单') }}</button>
            </view>
          </view>

          <view class="lp-card">
            <view class="lp-card-head">
              <view class="lp-card-heading">
                <text class="lp-card-title">{{ t('学习账本') }}</text>
                <text class="lp-card-hint">
                  {{ t('最近 {v1} 条 / 共 {v2} 条', { v1: entries.length, v2: entryTotal }) }}
                </text>
              </view>
            </view>
            <view v-if="!entries.length" class="lp-empty-inline">
              {{ t('还没有学习记录。开启后在会话里给它一个方向，或让它自己选题。') }}
            </view>
            <view v-else class="lp-ledger">
              <view v-for="entry in entries" :key="entry.id" class="lp-entry">
                <view class="lp-entry-top">
                  <text class="lp-entry-kind" :class="entry.kind">{{ entryKindLabel(entry) }}</text>
                  <text class="lp-entry-time">{{ formatWhen(entry.at) }}</text>
                </view>
                <text class="lp-entry-title">{{ entryTitle(entry) }}</text>
                <text v-if="entryMeta(entry)" class="lp-entry-meta">{{ entryMeta(entry) }}</text>
                <text v-if="entry.note" class="lp-entry-note">{{ entry.note }}</text>
              </view>
            </view>
            <text class="lp-note ledger-path">
              {{ t('完整账本保存在工作区 {v1}，不会上传。', { v1: ledgerPath }) }}
            </text>
          </view>

          <view class="lp-card">
            <view class="lp-card-head">
              <view class="lp-card-heading">
                <text class="lp-card-title">{{ t('下一轮建议') }}</text>
                <text class="lp-card-hint">{{ t('根据学习账本自动汇总，供下一轮参考。') }}</text>
              </view>
            </view>
            <view v-if="focus.length" class="lp-focus-list">
              <view v-for="item in focus" :key="item" class="lp-focus">
                <text class="lp-focus-dot">•</text>
                <text class="lp-focus-text">{{ item }}</text>
              </view>
            </view>
            <text v-else class="lp-empty-inline">{{ t('暂时没有需要调整的地方。') }}</text>
          </view>

          <view class="lp-card">
            <view class="lp-card-head">
              <view class="lp-card-heading">
                <text class="lp-card-title">{{ t('怎么开始') }}</text>
              </view>
            </view>
            <text class="lp-hint">
              {{ t('开启后，在会话里给它一个方向，它会按白名单自己查资料、自己决定下一步；没有方向时也可以让它自己选题。') }}
            </text>
            <text class="lp-hint">
              {{ t('阶段成果会用待确认状态记入账本，你在会话里点头后才算完成。') }}
            </text>
          </view>

          <view class="lp-bottom-gap"></view>
        </template>
      </view>
    </view>

    <app-sheet
      :visible="workspacePickerVisible"
      :title="t('选择项目空间')"
      :subtitle="t('共 {v1} 个项目', { v1: workspaceOptions.length })"
      @close="workspacePickerVisible = false"
    >
      <scroll-view
        scroll-y
        class="lp-picker-list"
        :style="{ height: workspaceListHeight }"
        :show-scrollbar="false"
      >
        <view
          v-for="item in workspaceOptions"
          :key="item.path"
          class="lp-picker-item"
          :class="{ active: item.path === workspacePath }"
          @click="chooseWorkspace(item.path)"
        >
          <view class="lp-picker-main">
            <text class="lp-picker-name">{{ item.name }}</text>
            <text class="lp-picker-path">{{ item.path }}</text>
          </view>
          <text class="lp-picker-check">{{ item.path === workspacePath ? '✓' : '' }}</text>
        </view>
      </scroll-view>
    </app-sheet>
  </view>
</template>

<script>
import AppSheet from '../app-sheet/app-sheet.vue'
import { formatBytes, relativeTime } from '../../lib/format.js'
import { t } from '../../lib/i18n.js'
import {
  init,
  loadLearningState,
  saveLearningSettings,
  store
} from '../../store/index.js'

function baseName(path) {
  const parts = String(path || '').replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || String(path || '')
}

export default {
  components: { AppSheet },
  data() {
    return {
      loading: false,
      busy: '',
      error: '',
      state: null,
      workspacePath: '',
      hostsDraft: '',
      workspacePickerVisible: false
    }
  },
  computed: {
    store() {
      return store
    },
    connected() {
      return store.connectionState === 'connected'
    },
    enabled() {
      return this.state?.enabled === true
    },
    summary() {
      const summary = this.state?.summary
      return summary && typeof summary === 'object' ? summary : {}
    },
    focus() {
      return Array.isArray(this.summary.focus) ? this.summary.focus : []
    },
    entries() {
      return Array.isArray(this.state?.entries) ? this.state.entries : []
    },
    entryTotal() {
      return Number(this.state?.entryTotal) || 0
    },
    ledgerPath() {
      return this.state?.ledger || '.pilot/learning/ledger.jsonl'
    },
    defaultHosts() {
      return Array.isArray(this.state?.defaultHosts) ? this.state.defaultHosts : []
    },
    effectiveHosts() {
      return Array.isArray(this.state?.effectiveHosts) ? this.state.effectiveHosts : []
    },
    defaultHostsText() {
      return this.defaultHosts.join('、') || t('无')
    },
    effectiveHostsText() {
      return this.effectiveHosts.join('、') || t('无')
    },
    hostsDirty() {
      const configured = Array.isArray(this.state?.hosts) ? this.state.hosts : []
      return this.normalizeDraft(this.hostsDraft).join('\n') !== configured.join('\n')
    },
    workspaceOptions() {
      const seen = new Map()
      for (const session of store.sessions) {
        if (!session?.workspacePath) continue
        const path = session.workspacePath
        if (!seen.has(path)) seen.set(path, session.workspaceName || baseName(path))
      }
      for (const path of store.roots || []) {
        if (path && !seen.has(path)) seen.set(path, baseName(path))
      }
      if (this.workspacePath && !seen.has(this.workspacePath)) {
        seen.set(this.workspacePath, baseName(this.workspacePath))
      }
      return [...seen].map(([path, name]) => ({ path, name }))
    },
    workspaceName() {
      const found = this.workspaceOptions.find((item) => item.path === this.workspacePath)
      return found?.name || baseName(this.workspacePath)
    },
    workspaceLabel() {
      return this.workspaceName || t('尚未打开工作区')
    },
    workspaceListHeight() {
      const rows = Math.min(Math.max(this.workspaceOptions.length, 1), 8)
      return `${rows * 116}rpx`
    }
  },
  watch: {
    connected(next) {
      if (next) void this.load()
    },
    workspaceOptions(next) {
      // 首屏可能在 workspaces.list 回来之前打开：拿到工作区后自动补一次。
      if (this.workspacePath || next.length === 0) return
      this.ensureWorkspace()
      void this.load()
    }
  },
  mounted() {
    init()
    if (store.pairing) {
      this.ensureWorkspace()
      void this.load()
    }
  },
  methods: {
    t,
    ensureWorkspace() {
      if (this.workspacePath) return
      this.workspacePath =
        store.currentSession?.workspacePath ||
        store.sessions?.[0]?.workspacePath ||
        store.roots?.[0] ||
        ''
    },
    async load() {
      if (this.loading) return
      if (!this.connected) {
        this.error = t('电脑连接已断开，请回到会话页重连后重试')
        return
      }
      this.ensureWorkspace()
      if (!this.workspacePath) {
        this.state = null
        this.error = ''
        return
      }
      this.loading = true
      this.error = ''
      try {
        const next = await loadLearningState(this.workspacePath)
        this.state = next || this.state
        this.syncHostsDraft()
      } catch (error) {
        this.error = this.friendlyError(error, t('读取学习状态失败'))
      } finally {
        this.loading = false
      }
    },
    friendlyError(error, fallback) {
      const message = String(error?.message || fallback || '').slice(0, 200)
      if (/不支持该操作|不支持手机/.test(message)) {
        return t('这台电脑的 Pilot 版本较旧，不支持在手机上控制自主探索学习。请先在电脑上安装新版 Pilot。')
      }
      return message
    },
    syncHostsDraft() {
      const hosts = Array.isArray(this.state?.hosts) ? this.state.hosts : []
      this.hostsDraft = hosts.join('\n')
    },
    normalizeDraft(value) {
      return String(value || '')
        .split(/\r?\n|,/)
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean)
    },
    async applySettings(payload, key, fallback) {
      if (this.busy || !this.connected || !this.workspacePath) return
      this.busy = key
      this.error = ''
      try {
        const next = await saveLearningSettings(this.workspacePath, payload)
        if (next) {
          this.state = next
          this.syncHostsDraft()
        }
      } catch (error) {
        this.error = this.friendlyError(error, fallback)
      } finally {
        this.busy = ''
      }
    },
    toggleEnabled() {
      if (this.busy || !this.state) return
      const payload = { enabled: !this.enabled }
      // 开关和未保存的白名单一起提交，避免切换开关时丢掉刚编辑的主机。
      if (this.hostsDirty) payload.hosts = this.normalizeDraft(this.hostsDraft)
      void this.applySettings(payload, 'toggle', t('保存学习设置失败'))
    },
    saveHosts() {
      if (this.busy || !this.hostsDirty) return
      void this.applySettings(
        { hosts: this.normalizeDraft(this.hostsDraft) },
        'hosts',
        t('保存白名单失败')
      )
    },
    useDefaultHosts() {
      if (this.busy) return
      this.hostsDraft = this.defaultHosts.join('\n')
    },
    openWorkspacePicker() {
      if (this.busy) return
      this.workspacePickerVisible = true
    },
    chooseWorkspace(path) {
      this.workspacePickerVisible = false
      if (!path || path === this.workspacePath) return
      this.workspacePath = path
      this.state = null
      this.hostsDraft = ''
      void this.load()
    },
    formatWhen(value) {
      const time = Date.parse(String(value || ''))
      return Number.isFinite(time) ? relativeTime(time) : ''
    },
    formatPercent(value) {
      const number = Number(value)
      if (!Number.isFinite(number) || number <= 0) return '0%'
      return `${Math.round(Math.max(0, Math.min(1, number)) * 100)}%`
    },
    entryKindLabel(entry) {
      if (entry?.kind === 'source') return t('来源')
      if (entry?.kind === 'task') return t('任务')
      if (entry?.kind === 'outcome') return t('阶段成果')
      return t('记录')
    },
    verdictLabel(verdict) {
      if (verdict === 'approved') return t('已通过')
      if (verdict === 'rejected') return t('已拒绝')
      if (verdict === 'pending') return t('待确认')
      return t('未裁决')
    },
    entryTitle(entry) {
      if (entry?.kind === 'source') return entry.url || entry.host || t('未记录来源')
      if (entry?.kind === 'task') return entry.title || entry.goal || t('未命名任务')
      if (entry?.kind === 'outcome') return this.verdictLabel(entry.verdict)
      return entry?.id || t('记录')
    },
    entryMeta(entry) {
      if (entry?.kind === 'source') {
        const parts = []
        if (entry.host) parts.push(entry.host)
        if (entry.path) parts.push(entry.path)
        if (Number.isFinite(Number(entry.bytes))) parts.push(formatBytes(entry.bytes))
        return parts.join(' · ')
      }
      if (entry?.kind === 'task') {
        return entry.goal && entry.title ? entry.goal : entry.sourceId ? t('来源 {v1}', { v1: entry.sourceId }) : ''
      }
      if (entry?.kind === 'outcome') {
        const parts = []
        if (entry.taskId) parts.push(t('任务 {v1}', { v1: entry.taskId }))
        if (Number.isFinite(Number(entry.quality))) {
          parts.push(t('质量 {v1}', { v1: Number(entry.quality).toFixed(2) }))
        }
        return parts.join(' · ')
      }
      return ''
    }
  }
}
</script>

<style scoped>
.learning-panel {
  display: block;
  padding: 0;
}
.lp-header {
  flex: none;
}
.lp-panel-head {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
  padding: 4rpx 0 14rpx;
}
.lp-panel-title {
  color: var(--text-strong);
  font-size: calc(30rpx * var(--font-scale));
  font-weight: 650;
  line-height: 1.35;
}
.lp-panel-subtitle {
  flex: 1;
  min-width: 0;
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lp-refresh {
  flex: none;
  padding: 8rpx 14rpx;
  border-radius: 12rpx;
  background: var(--surface);
  color: var(--accent-soft);
  font-size: calc(23rpx * var(--font-scale));
}
.lp-refresh.disabled {
  color: var(--dim);
  opacity: 0.7;
}
.lp-project {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 14rpx 18rpx;
  border-radius: 16rpx;
  background: var(--surface);
  box-shadow: var(--control-shadow);
}
.lp-project-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.lp-project-label {
  color: var(--dim);
  font-size: calc(19rpx * var(--font-scale));
}
.lp-project-name {
  color: var(--text-strong);
  font-size: calc(25rpx * var(--font-scale));
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lp-project-path {
  color: var(--muted);
  font-size: calc(20rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lp-project-caret {
  flex: none;
  color: var(--accent-soft);
  font-size: calc(24rpx * var(--font-scale));
}
.lp-intro {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  margin-top: 14rpx;
  padding: 16rpx 20rpx;
  border-radius: 16rpx;
  background: var(--surface);
  box-shadow: var(--control-shadow);
}
.lp-badge {
  align-self: flex-start;
  padding: 3rpx 12rpx;
  border-radius: 999rpx;
  background: var(--accent-wash-soft);
  color: var(--accent-soft);
  font-size: calc(19rpx * var(--font-scale));
  line-height: 1.4;
}
.lp-intro-text {
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.6;
}
.lp-stats {
  display: flex;
  gap: 10rpx;
  margin: 14rpx 0 12rpx;
}
.lp-stat {
  flex: 1;
  min-width: 0;
  padding: 12rpx 10rpx;
  border-radius: 14rpx;
  background: var(--surface);
  text-align: center;
}
.lp-stat-value {
  display: block;
  color: var(--text-strong);
  font-size: calc(30rpx * var(--font-scale));
  font-weight: 650;
  line-height: 1.2;
}
.lp-stat-label {
  display: block;
  margin-top: 4rpx;
  color: var(--dim);
  font-size: calc(19rpx * var(--font-scale));
}
.lp-scroll {
  display: block;
  width: 100%;
  margin: 0;
}
.lp-content {
  padding: 8rpx 0 calc(40rpx + env(safe-area-inset-bottom));
}
.lp-card {
  margin-bottom: 16rpx;
  padding: 20rpx 22rpx;
  border-radius: 18rpx;
  background: var(--surface);
  box-shadow: var(--control-shadow);
}
.lp-card-head {
  display: flex;
  align-items: flex-start;
  gap: 12rpx;
}
.lp-card-heading {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.lp-card-title {
  color: var(--text-strong);
  font-size: calc(27rpx * var(--font-scale));
  font-weight: 650;
  line-height: 1.35;
}
.lp-card-hint {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.55;
}
.lp-toggle-wrap {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10rpx;
}
.lp-toggle {
  width: 78rpx;
  height: 44rpx;
  border-radius: 999rpx;
  background: var(--surface-3);
  position: relative;
  transition: background 0.2s ease;
}
.lp-toggle.on {
  background: var(--accent-wash-strong);
}
.lp-toggle.disabled {
  opacity: 0.5;
}
.lp-toggle-knob {
  position: absolute;
  top: 4rpx;
  left: 4rpx;
  width: 34rpx;
  height: 34rpx;
  border-radius: 50%;
  background: #ffffff;
  transition: transform 0.2s ease;
}
.lp-toggle.on .lp-toggle-knob {
  transform: translateX(34rpx);
}
.lp-toggle-label {
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
}
.lp-toggle-label.on {
  color: var(--accent-soft);
}
.lp-safety {
  display: block;
  margin-top: 14rpx;
  padding: 14rpx 16rpx;
  border-radius: 14rpx;
  background: var(--bg-soft);
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.62;
}
.lp-note,
.lp-hint {
  display: block;
  margin-top: 12rpx;
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.6;
  word-break: break-word;
}
.lp-hint {
  color: var(--muted);
}
.lp-textarea {
  width: 100%;
  min-height: 210rpx;
  margin-top: 14rpx;
  padding: 16rpx 18rpx;
  border-radius: 14rpx;
  background: var(--input-bg);
  color: var(--text);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.55;
  box-sizing: border-box;
}
.lp-actions {
  display: flex;
  gap: 12rpx;
  margin-top: 16rpx;
}
.lp-actions .btn {
  flex: 1;
  margin: 0;
}
.lp-empty,
.lp-empty-inline {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  padding: 40rpx 20rpx;
  text-align: center;
}
.lp-empty-title {
  color: var(--text);
  font-size: calc(26rpx * var(--font-scale));
  font-weight: 600;
}
.lp-empty-hint {
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.6;
}
.lp-empty-inline {
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.6;
  padding: 26rpx 10rpx;
}
.lp-retry {
  margin-top: 12rpx;
}
.lp-error {
  margin-bottom: 12rpx;
  padding: 14rpx 18rpx;
  border-radius: 14rpx;
  background: var(--stop-soft);
}
.lp-error-text {
  color: var(--stop);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.55;
}
.lp-ledger {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  margin-top: 14rpx;
}
.lp-entry {
  padding: 14rpx 16rpx;
  border-radius: 14rpx;
  background: var(--surface-3);
}
.lp-entry-top {
  display: flex;
  align-items: center;
  gap: 10rpx;
}
.lp-entry-kind {
  flex: none;
  padding: 2rpx 10rpx;
  border-radius: 8rpx;
  background: var(--accent-wash-soft);
  color: var(--accent-soft);
  font-size: calc(19rpx * var(--font-scale));
  line-height: 1.5;
}
.lp-entry-kind.task {
  background: var(--pause-soft);
  color: var(--pause);
}
.lp-entry-kind.outcome {
  background: var(--resume-soft);
  color: var(--resume);
}
.lp-entry-time {
  margin-left: auto;
  flex: none;
  color: var(--dim);
  font-size: calc(20rpx * var(--font-scale));
}
.lp-entry-title {
  display: block;
  margin-top: 8rpx;
  color: var(--text-strong);
  font-size: calc(24rpx * var(--font-scale));
  font-weight: 600;
  line-height: 1.5;
  word-break: break-word;
}
.lp-entry-meta {
  display: block;
  margin-top: 6rpx;
  color: var(--muted);
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1.5;
  word-break: break-all;
}
.lp-entry-note {
  display: block;
  margin-top: 8rpx;
  color: var(--text);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.6;
  word-break: break-word;
}
.ledger-path {
  margin-top: 14rpx;
}
.lp-focus-list {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  margin-top: 14rpx;
}
.lp-focus {
  display: flex;
  align-items: flex-start;
  gap: 8rpx;
}
.lp-focus-dot {
  flex: none;
  color: var(--accent-soft);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.55;
}
.lp-focus-text {
  flex: 1;
  min-width: 0;
  color: var(--text);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.62;
  word-break: break-word;
}
.lp-bottom-gap {
  height: 30rpx;
}
.lp-picker-list {
  padding: 0 30rpx;
  box-sizing: border-box;
}
.lp-picker-item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 18rpx 20rpx;
  margin-bottom: 10rpx;
  border-radius: 14rpx;
  background: var(--surface);
}
.lp-picker-item.active {
  background: var(--accent-wash-soft);
}
.lp-picker-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.lp-picker-name {
  color: var(--text);
  font-size: calc(26rpx * var(--font-scale));
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lp-picker-path {
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lp-picker-check {
  flex: none;
  color: var(--accent-soft);
  font-size: calc(26rpx * var(--font-scale));
  font-weight: 700;
}
</style>
