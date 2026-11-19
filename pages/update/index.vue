<template>
  <view class="page update-page" :class="[{ 'theme-light': store.theme === 'light' }, 'accent-' + store.accent, 'btn-scheme-' + store.buttonScheme, 'font-' + store.fontSize, 'contrast-' + store.contrast, 'saturation-' + store.saturation]">
    <view class="topbar">
      <view class="back" @click="back"><view class="back-arrow"></view></view>
      <text class="title">{{ t('应用更新') }}</text>
    </view>

    <view class="hero">
      <text class="hero-eyebrow">{{ t('发现新版本') }}</text>
      <view class="hero-version-row">
        <text class="hero-version">v{{ latestVersion }}</text>
        <text v-if="latestVersion" class="hero-arrow">→</text>
        <text v-if="latestVersion" class="hero-from">{{ t('当前 v{v1}', { v1: currentVersion }) }}</text>
      </view>
      <text class="hero-sub">
        {{ isWgt
          ? t('本次是资源包热更：只替换前端页面与逻辑，安装后 App 会自动重启；配对信息和设置都会保留。')
          : t('覆盖安装会保留配对信息和设置；下载过程中可以退出本页，进度会在后台继续。') }}
      </text>
      <view class="status-pill" :class="state.status">
        <text class="status-dot"></text>
        <text class="status-text">{{ statusTitle }}</text>
      </view>
    </view>

    <view class="card progress-card" :class="state.status">
      <view class="progress-head">
        <text class="progress-title">{{ progressTitle }}</text>
        <text v-if="showPercent" class="progress-percent">{{ progressPercent }}%</text>
      </view>
      <view class="progress-track">
        <view class="progress-fill" :style="{ width: progressWidth }"></view>
      </view>
      <text class="progress-meta">{{ statusMeta }}</text>
      <view v-if="busy" class="progress-tip">
        <text class="progress-tip-text">{{ t('退出本页或切到后台，下载仍会继续。') }}</text>
      </view>
    </view>

    <view v-if="notes" class="card">
      <text class="card-title">{{ t('更新内容') }}</text>
      <text class="notes-text">{{ notes }}</text>
    </view>

    <view class="actions">
      <button v-if="showDownload" class="btn primary" @click="download">
        {{ downloadSize ? t('下载更新 v{v1}（{v2}）', { v1: latestVersion, v2: downloadSize }) : t('下载更新 v{v1}', { v1: latestVersion }) }}
      </button>
      <button v-if="showRetry" class="btn primary" @click="retry">{{ t('重试下载') }}</button>
      <button v-if="showInstall" class="btn primary" @click="install">
        {{ isWgt ? t('重启并应用更新') : state.installerOpened ? t('再次打开安装程序') : t('立即安装') }}
      </button>
      <button v-if="showCancel" class="btn ghost" @click="cancel">{{ t('取消下载') }}</button>
      <button class="btn ghost" @click="openChangelogRecord">{{ t('版本更新记录') }}</button>
      <button class="btn ghost" @click="openBrowser">{{ t('用浏览器下载') }}</button>
    </view>

    <text class="note">
      {{ t('浏览器下载会打开下载站，可手动保存 APK 后安装。应用内下载会先校验安装包 SHA-256，再交给系统安装器。') }}
    </text>

    <app-dialog
      :visible="leaveDialogVisible"
      :title="t('仍在下载更新')"
      message="退出本页后下载会在后台继续，完成后会提示安装。"
      :cancel-text="t('留在本页')"
      :confirm-text="t('退出')"
      icon="↓"
      @confirm="confirmLeave"
      @cancel="leaveDialogVisible = false"
      @close="leaveDialogVisible = false"
    />
    <app-dialog-host />
  </view>
</template>

<script>
import AppDialog from '../../components/app-dialog/app-dialog.vue'
import AppDialogHost from '../../components/app-dialog-host/app-dialog-host.vue'
import {
  canSelfUpdate,
  cancelUpdateDownload,
  currentAppInfo,
  formatUpdateBytes,
  getLastUpdateManifest,
  getUpdateDownloadState,
  installDownloadedUpdate,
  openChangelogPage as openChangelogRecordExternal,
  openUpdateDownloadPage,
  retryUpdateDownload,
  startUpdateDownload,
  subscribeUpdateDownload
} from '../../lib/update.js'
import { init, store } from '../../store/index.js'
import { t } from '../../lib/i18n.js'

export default {
  components: { AppDialog, AppDialogHost },
  data() {
    return {
      latest: getLastUpdateManifest(),
      state: getUpdateDownloadState(),
      current: currentAppInfo(),
      unsubscribe: null,
      leaveDialogVisible: false
    }
  },
  computed: {
    store() {
      return store
    },
    latestVersion() {
      return this.latest?.version || this.state.version || ''
    },
    currentVersion() {
      return this.current?.version || t("未知")
    },
    notes() {
      return this.latest?.notes || ''
    },
    isWgt() {
      return (this.latest?.kind || this.state.kind) === 'wgt'
    },
    /** 待下载体积：wgt 只有几百 KB，显示出来能明显降低用户放弃率。 */
    downloadSize() {
      return formatUpdateBytes(this.state.total || this.latest?.size || 0)
    },
    progressPercent() {
      if (this.state.status === 'verifying' || this.state.status === 'ready') return 100
      return Math.max(0, Math.min(100, Number(this.state.progress) || 0))
    },
    progressWidth() {
      return `${this.progressPercent}%`
    },
    showPercent() {
      return this.state.status !== 'idle' || this.latest
    },
    busy() {
      return this.state.status === 'downloading' || this.state.status === 'verifying'
    },
    showDownload() {
      return Boolean(this.latest) && this.state.status === 'idle' && canSelfUpdate()
    },
    showRetry() {
      return this.state.status === 'error' && Boolean(this.latest || this.state.version)
    },
    showInstall() {
      return this.state.status === 'ready'
    },
    showCancel() {
      return this.state.status === 'downloading' || this.state.status === 'verifying'
    },
    statusTitle() {
      const status = this.state.status
      if (status === 'downloading') return t("正在下载")
      if (status === 'verifying') return t("正在校验")
      if (status === 'ready') return t("等待安装")
      if (status === 'installing') return t("正在安装")
      if (status === 'error') return t("下载失败")
      return t("可更新")
    },
    progressTitle() {
      const status = this.state.status
      if (status === 'downloading') {
        return this.isWgt
          ? t("正在下载资源更新 v{v1}", { v1: this.state.version || this.latestVersion || '' })
          : t("正在下载更新 v{v1}", { v1: this.state.version || this.latestVersion || '' })
      }
      if (status === 'verifying') return this.isWgt ? t("正在校验资源包完整性") : t("正在校验安装包完整性")
      if (status === 'ready') return this.isWgt ? t("更新包已下载并校验完成") : t("安装包已下载并校验完成")
      if (status === 'installing') return this.isWgt ? t("正在应用更新") : t("正在打开系统安装程序")
      if (status === 'error') return t("更新下载未完成")
      return t("准备下载 v{v1}", { v1: this.latestVersion || '' })
    },
    statusMeta() {
      const status = this.state.status
      if (status === 'downloading') {
        const received = formatUpdateBytes(this.state.received)
        const total = formatUpdateBytes(this.state.total)
        if (received && total) return `${received} / ${total}`
        if (received) return t("已下载 {v1}", { v1: received })
        return t("正在连接下载服务器…")
      }
      if (status === 'verifying') return t("校验通过后即可安装，请稍候…")
      if (status === 'ready') return this.isWgt ? t("安装后会重启应用，配对信息和设置都会保留。") : t("覆盖安装会保留配对信息和设置。")
      if (status === 'installing') {
        return this.isWgt ? t("正在解压资源包，随后会自动重启。") : t("请按系统提示完成安装，完成后重新打开 App。")
      }
      if (status === 'error') {
        return t("{v1}。可以重试，或改用浏览器下载。", { v1: this.state.error || t('下载失败') })
      }
      return t("点击「下载更新」开始，下载过程中可以退出本页。")
    }
  },
  onLoad() {
    init()
    this.current = currentAppInfo()
    this.latest = getLastUpdateManifest()
    this.unsubscribe = subscribeUpdateDownload((state) => {
      this.state = state
    })
    // 从「发现新版本」确认进入时自动开始下载，页面直接显示进度条。
    if (this.latest && this.state.status === 'idle' && canSelfUpdate()) {
      startUpdateDownload(this.latest)
    }
  },
  onUnload() {
    if (typeof this.unsubscribe === 'function') this.unsubscribe()
    this.unsubscribe = null
  },
  methods: {
    download() {
      if (this.latest) startUpdateDownload(this.latest)
    },
    retry() {
      if (!retryUpdateDownload() && this.latest) startUpdateDownload(this.latest)
    },
    install() {
      installDownloadedUpdate()
    },
    cancel() {
      cancelUpdateDownload()
    },
    openBrowser() {
      openUpdateDownloadPage()
    },
    openChangelogRecord() {
      openChangelogRecordExternal()
    },
    back() {
      if (!this.busy) {
        this.leave()
        return
      }
      this.leaveDialogVisible = true
    },
    confirmLeave() {
      this.leaveDialogVisible = false
      this.leave()
    },
    leave() {
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
.update-page {
  padding: calc(var(--status-bar-height) + 20rpx) 28rpx 80rpx;
  box-sizing: border-box;
}
.topbar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 10rpx 0 26rpx;
}
.back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56rpx;
  height: 56rpx;
  margin-right: 2rpx;
  color: var(--accent-soft);
  flex-shrink: 0;
}
.title {
  color: var(--text-strong);
  font-size: calc(36rpx * var(--font-scale));
  font-weight: 650;
}
.hero {
  position: relative;
  overflow: hidden;
  border-radius: 26rpx;
  padding: 34rpx 30rpx;
  margin-bottom: 22rpx;
  background: linear-gradient(145deg, var(--surface-2) 0%, var(--surface) 55%, var(--bg) 100%);
}
.theme-light .hero {
  background: linear-gradient(145deg, var(--surface) 0%, var(--surface-2) 60%, var(--bg-soft) 100%);
}
.hero-eyebrow {
  display: block;
  color: var(--accent-soft);
  font-size: calc(23rpx * var(--font-scale));
  letter-spacing: 2rpx;
  margin-bottom: 12rpx;
}
.hero-version-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 14rpx;
}
.hero-version {
  color: var(--text-strong);
  font-size: calc(58rpx * var(--font-scale));
  font-weight: 720;
  line-height: 1.15;
}
.hero-arrow {
  color: var(--muted);
  font-size: calc(34rpx * var(--font-scale));
}
.hero-from {
  color: var(--muted);
  font-size: calc(25rpx * var(--font-scale));
}
.hero-sub {
  display: block;
  color: var(--muted);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.6;
  margin-top: 16rpx;
}
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 10rpx;
  margin-top: 22rpx;
  padding: 8rpx 20rpx;
  border-radius: 999rpx;
  background: rgba(143, 168, 192, 0.16);
}
.status-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: var(--accent-soft);
}
.status-pill.downloading .status-dot,
.status-pill.verifying .status-dot {
  background: var(--warn);
}
.status-pill.ready .status-dot {
  background: var(--ok);
}
.status-pill.error .status-dot {
  background: var(--danger);
}
.status-text {
  color: var(--text);
  font-size: calc(23rpx * var(--font-scale));
  font-weight: 600;
}
.card {
  background: var(--surface);
  border-radius: 22rpx;
  padding: 26rpx;
  margin-bottom: 22rpx;
}
.card-title {
  display: block;
  color: var(--text);
  font-size: calc(28rpx * var(--font-scale));
  font-weight: 600;
  margin-bottom: 14rpx;
}
.progress-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16rpx;
  margin-bottom: 16rpx;
}
.progress-title {
  color: var(--text);
  font-size: calc(28rpx * var(--font-scale));
  font-weight: 600;
}
.progress-percent {
  color: var(--accent-soft);
  font-size: calc(30rpx * var(--font-scale));
  font-weight: 700;
}
.progress-track {
  height: 14rpx;
  border-radius: 999rpx;
  background: var(--surface-3);
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--accent-gradient);
  transition: width 0.25s ease;
}
.progress-card.ready .progress-fill {
  background: linear-gradient(90deg, #98b79e, #98b79e);
}
.progress-card.error .progress-fill {
  background: linear-gradient(90deg, #c9928d, #c9928d);
}
.progress-meta {
  display: block;
  color: var(--muted);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.6;
  margin-top: 16rpx;
}
.progress-tip {
  margin-top: 14rpx;
  padding: 12rpx 14rpx;
  border-radius: 12rpx;
  background: var(--bg-soft);
}
.progress-tip-text {
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
}
.notes-text {
  display: block;
  color: var(--text);
  font-size: calc(25rpx * var(--font-scale));
  line-height: 1.7;
  white-space: pre-wrap;
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 18rpx;
  margin-top: 8rpx;
}
.actions .btn {
  width: 100%;
  height: var(--btn-h-lg);
  padding: 0 var(--btn-pad-lg);
  font-size: var(--btn-font-lg);
}
.note {
  display: block;
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.65;
  margin-top: 22rpx;
}
</style>
