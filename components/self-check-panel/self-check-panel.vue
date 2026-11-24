<template>
  <view class="self-check-panel">
    <view class="sc-header">
      <view class="sc-panel-head">
        <text class="sc-panel-title">{{ t('内视') }}</text>
        <text class="sc-panel-subtitle">{{ stampText }}</text>
        <text
          class="sc-panel-refresh"
          :class="{ disabled: loading }"
          @click="load"
        >{{ loading ? t('读取中…') : t('刷新') }}</text>
      </view>

      <!-- 内视只读：不接收路径、不建会话、不改任何文件。 -->
      <view class="sc-intro">
        <text class="sc-intro-text">
          {{ t('内视只读采样电脑端正在运行的服务：模型接入、审批、沙箱、自写工具、MCP、插件、存储、定时任务、反馈、更新与体检。每项只给「正常 / 注意 / 未启用 / 异常」和真实取值，采不到就报异常。') }}
        </text>
      </view>
    </view>

    <view v-if="error" class="sc-error">{{ error }}</view>

    <view class="sc-body">
      <view v-if="!connected" class="sc-empty">
        <text class="sc-empty-title">{{ t('连接电脑后才能运行内视。') }}</text>
        <text class="sc-empty-hint">{{ t('内视读的是电脑端进程里的实时状态，没有连接时没有可展示的数据。') }}</text>
      </view>

      <view v-else-if="loading && !report" class="sc-empty">
        <text class="sc-empty-title">{{ t('正在采样…') }}</text>
        <text class="sc-empty-hint">{{ t('采样通常在 1 秒内结束。') }}</text>
      </view>

      <view v-else-if="!report" class="sc-empty">
        <text class="sc-empty-title">{{ t('还没有内视结果') }}</text>
        <text class="sc-empty-hint">{{ t('点右上角「刷新」立即采样一次。') }}</text>
      </view>

      <template v-else>
        <view class="sc-stats">
          <view class="sc-stat" :class="{ 'is-broken': report.counts.broken > 0 }">
            <text class="sc-stat-value">{{ report.counts.broken }}</text>
            <text class="sc-stat-label">{{ t('异常') }}</text>
          </view>
          <view class="sc-stat" :class="{ 'is-warn': report.counts.warn > 0 }">
            <text class="sc-stat-value">{{ report.counts.warn }}</text>
            <text class="sc-stat-label">{{ t('注意') }}</text>
          </view>
          <view class="sc-stat">
            <text class="sc-stat-value">{{ report.counts.off }}</text>
            <text class="sc-stat-label">{{ t('未启用') }}</text>
          </view>
          <view class="sc-stat">
            <text class="sc-stat-value">{{ report.counts.ok }}</text>
            <text class="sc-stat-label">{{ t('正常') }}</text>
          </view>
        </view>

        <text class="sc-meta">{{ metaText }}</text>

        <view v-for="section in sections" :key="section.group" class="sc-section">
          <text class="sc-section-title">{{ groupText(section.group) }}</text>
          <view
            v-for="item in section.items"
            :key="item.id"
            class="sc-item"
            :class="statusClass(item.status)"
          >
            <view class="sc-item-head">
              <text class="sc-item-title">{{ item.title }}</text>
              <text class="sc-badge" :class="statusClass(item.status)">{{ t(statusLabel(item.status)) }}</text>
            </view>
            <text v-if="item.detail" class="sc-item-detail">{{ item.detail }}</text>
            <text
              v-for="(fact, index) in item.facts"
              :key="index"
              class="sc-fact"
            >{{ fact }}</text>
            <text v-if="item.hint" class="sc-hint">{{ t('下一步：{v1}', { v1: item.hint }) }}</text>
          </view>
        </view>

        <view class="sc-actions">
          <button class="btn ghost small-btn" :disabled="loading" @click="copyReport">
            {{ t('复制报告') }}
          </button>
          <button class="btn ghost small-btn" :disabled="loading" @click="copyTroubles">
            {{ t('只复制异常项') }}
          </button>
        </view>
        <text class="sc-footer">
          {{ t('内视只读：不会创建会话，也不会改动电脑上的任何文件。') }}
        </text>
      </template>
    </view>
  </view>
</template>

<script>
import { copyText } from '../../lib/clipboard.js'
import { t } from '../../lib/i18n.js'
import {
  groupSelfCheck,
  groupText,
  normalizeSelfCheck,
  reportStamp,
  reportToText,
  statusClass,
  statusLabel,
  summarizeCounts
} from '../../lib/self-check.js'
import { init, loadSelfCheck, store } from '../../store/index.js'

/** 只复制需要处理的项：异常与注意。 */
function troublesOnly(report) {
  if (!report) return ''
  const items = report.items.filter((item) => item.status === 'broken' || item.status === 'warn')
  if (items.length === 0) return t('没有异常项。')
  return reportToText({ ...report, items })
}

export default {
  data() {
    return {
      // 初值必须是 false：load() 用 loading 防重复请求，初值 true 会让首屏直接返回。
      loading: false,
      error: '',
      report: null
    }
  },
  computed: {
    store() {
      return store
    },
    connected() {
      return store.connectionState === 'connected'
    },
    sections() {
      return groupSelfCheck(this.report?.items)
    },
    stampText() {
      if (!this.report) return t('只读采样电脑端状态')
      return t('采样于 {v1}', { v1: reportStamp(this.report.at) })
    },
    metaText() {
      if (!this.report) return ''
      const parts = [summarizeCounts(this.report.counts)]
      if (this.report.version) parts.push(`Pilot ${this.report.version}`)
      if (this.report.durationMs > 0) parts.push(t('用时 {v1} ms', { v1: this.report.durationMs }))
      return parts.join(' · ')
    }
  },
  mounted() {
    init()
    void this.load()
  },
  methods: {
    t,
    statusLabel,
    statusClass,
    groupText,
    async load() {
      if (this.loading) return
      if (!this.connected) {
        this.error = t('电脑连接已断开，请回到会话页重连后重试')
        return
      }
      this.loading = true
      this.error = ''
      try {
        const raw = await loadSelfCheck()
        const next = normalizeSelfCheck(raw)
        this.report = next || this.report
        if (!next) this.error = t('没有读到内视结果')
      } catch (error) {
        const message = String(error?.message || t('内视失败')).slice(0, 160)
        this.error = message
      } finally {
        this.loading = false
      }
    },
    async copyReport() {
      const text = reportToText(this.report)
      const ok = await copyText(text)
      uni.showToast({ title: ok ? t('已复制') : t('复制失败'), icon: 'none' })
    },
    async copyTroubles() {
      const ok = await copyText(troublesOnly(this.report))
      uni.showToast({ title: ok ? t('已复制') : t('复制失败'), icon: 'none' })
    }
  }
}
</script>

<style scoped>
.self-check-panel {
  display: block;
  padding: 0;
}
.sc-header {
  flex: none;
}
.sc-panel-head {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
  padding: 4rpx 2rpx 14rpx;
}
.sc-panel-title {
  color: var(--text);
  font-size: calc(30rpx * var(--font-scale));
  font-weight: 600;
}
.sc-panel-subtitle {
  flex: 1;
  min-width: 0;
  color: var(--muted);
  font-size: calc(20rpx * var(--font-scale));
}
.sc-panel-refresh {
  flex-shrink: 0;
  color: var(--accent-soft);
  font-size: calc(23rpx * var(--font-scale));
  padding: 10rpx 2rpx 10rpx 16rpx;
}
.sc-panel-refresh.disabled {
  opacity: 0.45;
}
.sc-intro {
  padding: 0 2rpx 16rpx;
}
.sc-intro-text {
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.6;
}
.sc-error {
  flex: none;
  margin: 0 2rpx 14rpx;
  padding: 14rpx 18rpx;
  border-radius: 14rpx;
  background: rgba(255, 107, 107, 0.12);
  color: #ff8a8a;
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.5;
}
.sc-body {
  display: block;
  padding-bottom: 40rpx;
}
.sc-empty {
  padding: 80rpx 10rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14rpx;
}
.sc-empty-title {
  color: var(--text);
  font-size: calc(26rpx * var(--font-scale));
}
.sc-empty-hint {
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
  text-align: center;
  line-height: 1.6;
}
.sc-stats {
  display: flex;
  gap: 10rpx;
  margin: 6rpx 0 6rpx;
}
.sc-stat {
  flex: 1;
  padding: 16rpx 8rpx;
  border-radius: 16rpx;
  background: var(--surface);
  border: 1rpx solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4rpx;
}
.sc-stat.is-broken {
  border-color: rgba(255, 107, 107, 0.5);
}
.sc-stat.is-warn {
  border-color: rgba(255, 196, 0, 0.45);
}
.sc-stat-value {
  color: var(--text);
  font-size: calc(32rpx * var(--font-scale));
  font-weight: 600;
}
.sc-stat-label {
  color: var(--muted);
  font-size: calc(20rpx * var(--font-scale));
}
.sc-meta {
  display: block;
  padding: 14rpx 2rpx 4rpx;
  color: var(--muted);
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1.5;
}
.sc-section {
  margin-top: 18rpx;
}
.sc-section-title {
  display: block;
  padding: 6rpx 2rpx 10rpx;
  color: var(--accent-soft);
  font-size: calc(19rpx * var(--font-scale));
  letter-spacing: 1rpx;
  text-transform: uppercase;
}
.sc-item {
  padding: 18rpx 20rpx;
  margin-bottom: 12rpx;
  border-radius: 16rpx;
  background: var(--surface);
  border: 1rpx solid var(--border);
  border-left-width: 6rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}
.sc-item.is-broken {
  border-left-color: #ff6b6b;
}
.sc-item.is-warn {
  border-left-color: #ffc400;
}
.sc-item.is-off {
  border-left-color: rgba(140, 140, 150, 0.7);
}
.sc-item.is-ok {
  border-left-color: rgba(60, 200, 120, 0.8);
}
.sc-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}
.sc-item-title {
  flex: 1;
  min-width: 0;
  color: var(--text);
  font-size: calc(25rpx * var(--font-scale));
  font-weight: 600;
}
.sc-badge {
  flex-shrink: 0;
  padding: 3rpx 12rpx;
  border-radius: 999rpx;
  font-size: calc(19rpx * var(--font-scale));
}
.sc-badge.is-broken {
  background: rgba(255, 107, 107, 0.16);
  color: #ff8a8a;
}
.sc-badge.is-warn {
  background: rgba(255, 196, 0, 0.16);
  color: #ffcf4d;
}
.sc-badge.is-off {
  background: rgba(140, 140, 150, 0.16);
  color: var(--muted);
}
.sc-badge.is-ok {
  background: rgba(60, 200, 120, 0.14);
  color: #5cd48f;
}
.sc-item-detail {
  color: var(--text);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.55;
}
.sc-fact {
  color: var(--muted);
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1.5;
  word-break: break-all;
}
.sc-hint {
  color: var(--accent-soft);
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1.5;
}
.sc-actions {
  display: flex;
  gap: 12rpx;
  margin: 20rpx 0 12rpx;
}
.sc-footer {
  display: block;
  padding: 4rpx 2rpx 40rpx;
  color: var(--muted);
  font-size: calc(20rpx * var(--font-scale));
  line-height: 1.6;
}
</style>
