<template>
  <!-- 主题/按钮方案 class 必须写在根节点那一行：测试按行首匹配核对，换行就丢。 -->
  <view class="page-host" :class="['accent-' + store.accent, 'btn-scheme-' + store.buttonScheme, 'font-' + store.fontSize, 'contrast-' + store.contrast, 'saturation-' + store.saturation, { 'theme-light': store.theme === 'light' }]">
    <!-- 渲染失败也要有东西看：组件抛错时 Vue 会放弃整棵子树，只剩背景色。 -->
    <view v-if="renderError" class="page-error">
      <text class="page-error-title">{{ t('页面渲染失败') }}</text>
      <text class="page-error-hint">{{ renderError }}</text>
      <text class="page-error-back" @click="back">{{ t('返回') }}</text>
    </view>

    <view v-else class="tasks-page">
      <view class="tasks-nav">
        <text class="tasks-nav-back" @click="back">‹ {{ t('返回') }}</text>
        <text class="tasks-nav-title">{{ t('全部任务') }}</text>
        <text class="tasks-nav-action" @click="reload">{{ t('刷新') }}</text>
      </view>

      <!--
        身份 + 诊断：手机上没有调试终端，这一行是唯一能截图取证的地方。
        版本告诉用户「我到底装的是哪一版」，诊断告诉双方「这次读取走到了哪一步」。
        两者都不依赖后端有没有数据，所以页面打开必有内容。
      -->
      <view class="tasks-meta">
        <text class="tasks-meta-text">{{ versionText }}</text>
        <text v-if="diagText" class="tasks-meta-text">{{ diagText }}</text>
      </view>

      <scroll-view scroll-y class="tasks-list" :show-scrollbar="false">
        <view v-if="loading" class="tasks-empty">
          <text class="tasks-empty-text">
            {{ retrying ? t('正在重新读取定时任务…') : t('正在读取定时任务…') }}
          </text>
        </view>

        <view v-else-if="offline && !groups.length" class="tasks-empty">
          <text class="tasks-empty-text">{{ t('手机和电脑没连上，暂时读不到定时任务') }}</text>
          <text class="tasks-empty-hint">
            {{ t('先确认手机和电脑都能上网；不在同一网络时，电脑端需要填中继地址才能连。') }}
          </text>
          <view class="tasks-actions">
            <text class="tasks-action" @click="reconnect">{{ t('重新连接') }}</text>
            <text class="tasks-action" @click="reload">{{ t('重新读取') }}</text>
          </view>
        </view>

        <view v-else-if="busy && !groups.length" class="tasks-empty">
          <text class="tasks-empty-text">{{ t('电脑端同时在处理别的读取，这次没取到定时任务') }}</text>
          <text class="tasks-empty-hint">{{ t('点「重新读取」再取一次就行。') }}</text>
          <view class="tasks-actions">
            <text class="tasks-action" @click="reload">{{ t('重新读取') }}</text>
          </view>
        </view>

        <view v-else-if="failed && !groups.length" class="tasks-empty">
          <text class="tasks-empty-text">{{ t('电脑端暂时没返回定时任务，稍后再点一次') }}</text>
          <text class="tasks-empty-hint">{{ t('如果一直这样，先点「重新连接」把链路重建一次。') }}</text>
          <view class="tasks-actions">
            <text class="tasks-action" @click="reconnect">{{ t('重新连接') }}</text>
            <text class="tasks-action" @click="reload">{{ t('重新读取') }}</text>
          </view>
        </view>

        <view v-else-if="!groups.length" class="tasks-empty">
          <text class="tasks-empty-text">{{ t('还没有定时任务') }}</text>
          <view class="tasks-actions">
            <text class="tasks-action" @click="reload">{{ t('重新读取') }}</text>
          </view>
        </view>

        <view v-for="group in groups" :key="group.sessionId" class="tasks-group">
          <view class="tasks-head" @click="openGroup(group)">
            <text class="tasks-head-title">{{ group.title }}</text>
            <text class="tasks-head-project">{{ group.project }}</text>
            <text class="tasks-head-count">{{ group.tasks.length }}</text>
            <text v-if="!group.missing" class="tasks-head-go">›</text>
          </view>
          <view
            v-for="task in group.tasks"
            :key="task.id"
            class="tasks-item"
            @click="openGroup(group)"
          >
            <view class="tasks-dot" :class="{ off: task.enabled === false }"></view>
            <view class="tasks-body">
              <text class="tasks-text">{{ task.content }}</text>
              <view class="tasks-meta-row">
                <text class="tasks-kind">{{ scheduleKindLabel(task) }}</text>
                <text v-if="task.enabled === false" class="tasks-tag">{{ t('已暂停') }}</text>
                <text v-else-if="task.lastStatus === 'failed'" class="tasks-tag error">
                  {{ t('上次执行失败') }}
                </text>
                <text v-else-if="scheduleTimeText(task.nextRunAt)" class="tasks-tag">
                  {{ t('下次 {v1}', { v1: scheduleTimeText(task.nextRunAt) }) }}
                </text>
              </view>
            </view>
          </view>
        </view>

        <!-- 有内容但这次没读到时也给一行回执，别让人以为看到的是最新结果。 -->
        <view v-if="groups.length && failed" class="tasks-foot" @click="reload">
          <text class="tasks-empty-hint">{{ t('这次没读到，下面是上次读到的结果；点这里再读一次') }}</text>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<script>
import {
  decideScheduleSheet,
  buildScheduledGroups,
  scheduleDiagText,
  scheduleKindLabel,
  scheduleTimeText
} from '../../lib/scheduled-overview.js'
import { currentAppInfo } from '../../lib/update.js'
import { t } from '../../lib/i18n.js'
import { armTapGuard, tapGuarded } from '../../lib/tap-guard.js'
import {
  hydrateScheduledCache,
  init,
  loadAllScheduled,
  onAppShow,
  reconnect,
  selectSession,
  store
} from '../../store/index.js'

export default {
  data() {
    return {
      renderError: '',
      // 读取结果：与首页弹层同一套决策，只是换成整页展示。
      rows: [],
      loading: false,
      retrying: false,
      offline: false,
      failed: false,
      busy: false,
      seq: 0,
      appInfo: null,
      loadedOnce: false
    }
  },
  computed: {
    store() {
      return store
    },
    groups() {
      return buildScheduledGroups(this.rows, store.sessions).map((group) => ({
        ...group,
        // 会话已被删掉时，标题说清楚为什么点不进去。
        title: group.missing ? t('会话已删除') : group.title,
        project: group.missing ? '' : group.project
      }))
    },
    diagText() {
      return scheduleDiagText(store.scheduledAllDiag)
    },
    versionText() {
      const info = this.appInfo
      if (!info) return `${t('版本')} —`
      const code = Number(info.versionCode) ? ` (${info.versionCode})` : ''
      return `${t('版本')} ${info.version}${code}`
    }
  },
  onLoad() {
    // 从首页点进来时，抬手后的那一次合成 click 会落在这一页上：
    // 自己再开一个窗口，不依赖首页有没有来得及 arm（例如冷启动直进本页）。
    armTapGuard(600)
    // 初始化失败不能中断 onLoad，否则这一页只剩背景色。
    try {
      init()
    } catch (error) {
      console.error('[pilot] 全部任务页初始化失败', error)
    }
    try {
      this.appInfo = currentAppInfo()
    } catch {
      this.appInfo = null
    }
    // 先用缓存铺满：冷启动或离线时也能立刻看到上次读到的任务。
    hydrateScheduledCache()
    this.rows = (store.scheduledAllGroups || []).slice()
    this.load()
  },
  onShow() {
    if (!store.pairing) {
      uni.reLaunch({ url: '/pages/pair/index' })
      return
    }
    onAppShow()
    // 从会话页返回时补一次：期间电脑端可能又排了新任务。
    if (this.loadedOnce) this.load()
  },
  /** 子组件或本页渲染抛错时不要白屏：把原因写在页面上，并留一个返回。 */
  errorCaptured(error) {
    this.renderError = String(error?.message || error || '未知错误')
    console.error('[pilot] 全部任务页渲染失败', error)
    return false
  },
  methods: {
    t,
    scheduleKindLabel,
    scheduleTimeText,
    async load() {
      const seq = ++this.seq
      hydrateScheduledCache()
      if (!this.rows.length) this.rows = (store.scheduledAllGroups || []).slice()
      this.loading = this.rows.length === 0
      this.offline = false
      this.failed = false
      this.busy = false
      try {
        let result = await loadAllScheduled()
        if (seq !== this.seq) return
        let decision = decideScheduleSheet(result, this.rows)
        // 手上一条都没有、而这次是 stale（被首页那次刷新抢占）或超时：
        // 自动再读一次，用户不必自己去点「重新读取」。
        if (decision.retry) {
          this.loading = true
          this.retrying = true
          try {
            result = await loadAllScheduled()
          } finally {
            this.retrying = false
          }
          if (seq !== this.seq) return
          decision = decideScheduleSheet(result, this.rows)
        }
        this.rows = decision.rows
        this.offline = decision.offline
        this.failed = decision.failed
        this.busy = decision.busy
      } catch (error) {
        if (seq === this.seq) {
          this.offline = false
          this.busy = false
          this.failed = this.rows.length === 0
          console.error('[pilot] 全部任务页读取失败', error)
        }
      } finally {
        if (seq === this.seq) {
          this.loading = false
          this.loadedOnce = true
        }
      }
    },
    /** 「刷新」/「重新读取」：与打开这一页走同一条链路。 */
    reload() {
      if (this.loading) return
      void this.load()
    },
    reconnect() {
      reconnect()
      setTimeout(() => this.reload(), 800)
    },
    openGroup(group) {
      // 抬手余波落到任务行上时不要把人带进会话页：用户只想看列表。
      if (tapGuarded()) return
      // 会话已被删掉时留在本页：任务内容还看得到，进去只会是一页空白。
      if (!group || group.missing) return
      const session = store.sessions.find((item) => item.id === group.sessionId)
      if (!session) return
      selectSession(session.id)
      uni.navigateTo({ url: `/pages/chat/index?id=${encodeURIComponent(session.id)}` })
    },
    back() {
      // 同里：抬手余波不应把这一页直接关掉（那又会变成“点了没反应”）。
      if (tapGuarded()) return
      try {
        if (getCurrentPages().length > 1) {
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
/* 用 min-height 而不是 height：App 端 100vh 算成 0 时，height 会把整页压成空白。 */
.page-host {
  min-height: 100vh;
  background: var(--bg);
}
.page-error {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  padding: calc(var(--status-bar-height) + 120rpx) 40rpx 40rpx;
}
.page-error-title {
  color: var(--text);
  font-size: calc(30rpx * var(--font-scale));
  font-weight: 600;
}
.page-error-hint {
  color: var(--danger, #ff6b6b);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.5;
  word-break: break-all;
}
.page-error-back {
  margin-top: 20rpx;
  align-self: flex-start;
  padding: 14rpx 34rpx;
  border-radius: 999rpx;
  background: var(--accent-soft);
  color: var(--text);
  font-size: calc(26rpx * var(--font-scale));
}

.tasks-page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  padding-top: var(--status-bar-height);
  box-sizing: border-box;
}
.tasks-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 18rpx 26rpx 12rpx;
  flex: none;
}
.tasks-nav-back,
.tasks-nav-action {
  color: var(--accent-soft);
  font-size: calc(26rpx * var(--font-scale));
  padding: 10rpx 6rpx;
}
.tasks-nav-title {
  color: var(--text-strong);
  font-size: calc(32rpx * var(--font-scale));
  font-weight: 650;
}
.tasks-meta {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  padding: 0 30rpx 14rpx;
  flex: none;
}
.tasks-meta-text {
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.4;
  word-break: break-all;
}
.tasks-list {
  flex: 1;
  min-height: 0;
  padding: 0 24rpx calc(env(safe-area-inset-bottom) + 30rpx);
  box-sizing: border-box;
}
.tasks-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 14rpx;
  padding: 60rpx 20rpx;
}
.tasks-empty-text {
  color: var(--text);
  font-size: calc(27rpx * var(--font-scale));
  line-height: 1.5;
}
.tasks-empty-hint {
  color: var(--muted);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.5;
  word-break: break-all;
}
.tasks-actions {
  display: flex;
  gap: 16rpx;
  margin-top: 6rpx;
}
.tasks-action {
  padding: 12rpx 26rpx;
  border-radius: 999rpx;
  background: var(--accent-soft);
  color: var(--text);
  font-size: calc(24rpx * var(--font-scale));
}
.tasks-group {
  margin-bottom: 18rpx;
  padding: 6rpx 0 10rpx;
  border-radius: 20rpx;
  background: var(--surface);
  box-shadow: var(--control-shadow);
  overflow: hidden;
}
.tasks-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 16rpx 20rpx 12rpx;
}
.tasks-head-title {
  flex: 1;
  min-width: 0;
  color: var(--text-strong);
  font-size: calc(27rpx * var(--font-scale));
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tasks-head-project {
  flex: none;
  max-width: 34%;
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tasks-head-count {
  flex: none;
  color: var(--accent-soft);
  font-size: calc(21rpx * var(--font-scale));
  background: var(--bg-soft);
  padding: 2rpx 12rpx;
  border-radius: 20rpx;
}
.tasks-head-go {
  flex: none;
  color: var(--muted);
  font-size: calc(26rpx * var(--font-scale));
}
.tasks-item {
  display: flex;
  align-items: flex-start;
  gap: 12rpx;
  padding: 12rpx 20rpx 14rpx;
}
.tasks-item:active {
  background: rgba(143, 168, 192, 0.1);
}
.tasks-dot {
  flex: none;
  width: 12rpx;
  height: 12rpx;
  margin-top: 12rpx;
  border-radius: 50%;
  background: var(--accent);
}
.tasks-dot.off {
  background: var(--muted);
  opacity: 0.55;
}
.tasks-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.tasks-text {
  color: var(--text);
  font-size: calc(25rpx * var(--font-scale));
  line-height: 1.45;
  word-break: break-word;
}
.tasks-meta-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10rpx;
}
.tasks-kind {
  color: var(--muted);
  font-size: calc(21rpx * var(--font-scale));
}
.tasks-tag {
  color: var(--accent-soft);
  font-size: calc(19rpx * var(--font-scale));
  background: var(--bg-soft);
  padding: 2rpx 10rpx;
  border-radius: 16rpx;
}
.tasks-tag.error {
  color: var(--danger, #ff6b6b);
}
.tasks-foot {
  padding: 8rpx 20rpx 30rpx;
}
</style>
