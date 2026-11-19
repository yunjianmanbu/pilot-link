<template>
  <view class="page connect-page" :class="[{ 'theme-light': store.theme === 'light' }, 'accent-' + store.accent, 'btn-scheme-' + store.buttonScheme, 'font-' + store.fontSize, 'contrast-' + store.contrast, 'saturation-' + store.saturation]">
    <view class="topbar">
      <view class="back" @click="back"><view class="back-arrow"></view></view>
      <text class="title">{{ t('连接另一台手机') }}</text>
    </view>

    <view class="intro">
      <text class="intro-title">{{ t('用另一台手机扫码连接') }}</text>
      <text class="intro-sub">{{ t('用另一台手机扫描下方二维码，即可连接到同一台电脑。') }}</text>
    </view>

    <view v-if="loading" class="state-card">
      <text class="state-title">{{ t('正在生成二维码…') }}</text>
      <text class="state-sub">{{ t('二维码只在这台手机上显示。') }}</text>
    </view>

    <view v-else-if="error" class="error-box">
      <text class="error-text">{{ error }}</text>
      <button class="btn ghost small-btn" @click="load">{{ t('重试') }}</button>
    </view>

    <view v-else-if="qr" class="card qr-card">
      <text class="card-title">{{ t('扫描二维码连接') }}</text>
      <view class="qr-frame">
        <image
          class="qr-image"
          :src="qr.qrDataUrl"
          mode="aspectFit"
          :show-menu-by-longpress="false"
        />
      </view>
      <text class="qr-device">{{ store.deviceName || t('电脑') }}</text>
      <text class="qr-expire" :class="{ expired }">{{ expireText }}</text>
      <text v-if="qr.mode === 'lan'" class="qr-warn">
        {{ t('当前电脑没有配置云端中继，另一台手机需要和电脑处在同一局域网。') }}
      </text>
      <button class="btn ghost small-btn" @click="load">{{ t('刷新二维码') }}</button>
    </view>

    <view class="card safety-card">
      <text class="card-title">{{ t('仅限本人使用') }}</text>
      <text class="tip">{{ t('· 二维码包含一次性配对凭证，只在你自己的手机上展示。请勿截图、录屏或发送给他人。') }}</text>
      <text class="tip">{{ t('· 新手机扫码后会立即连接这台电脑；当前手机不会自动断开，需要移除旧设备时请在电脑端「手机配对」里操作。') }}</text>
      <text class="tip">{{ t('· 二维码短时间内有效，使用一次后立刻失效；过期后点「刷新二维码」重新生成。') }}</text>
    </view>
  </view>
</template>

<script>
import { t } from '../../lib/i18n.js'
import {
  applySystemBars,
  createConnectQr,
  init,
  onAppShow,
  store
} from '../../store/index.js'

export default {
  data() {
    return {
      loading: false,
      error: '',
      qr: null,
      now: Date.now(),
      clock: null
    }
  },
  computed: {
    store() {
      return store
    },
    expired() {
      const at = Date.parse(String(this.qr?.expiresAt || ''))
      return Number.isFinite(at) && at <= this.now
    },
    expireText() {
      const at = Date.parse(String(this.qr?.expiresAt || ''))
      if (!Number.isFinite(at)) return ''
      const remaining = Math.max(0, at - this.now)
      if (remaining <= 0) return t('二维码已过期，请刷新')
      const minutes = Math.floor(remaining / 60_000)
      const seconds = Math.floor((remaining % 60_000) / 1000)
      return t('{v1}:{v2} 后过期', {
        v1: minutes,
        v2: String(seconds).padStart(2, '0')
      })
    }
  },
  onLoad() {
    init()
    if (store.pairing) void this.load()
  },
  onShow() {
    init()
    applySystemBars()
    if (!store.pairing) {
      uni.reLaunch({ url: '/pages/pair/index' })
      return
    }
    onAppShow()
    this.startClock()
    if (!this.qr && !this.loading && !this.error) void this.load()
  },
  onHide() {
    this.stopClock()
  },
  onUnload() {
    this.stopClock()
    // 换机凭证没有保存价值，离开页面就丢弃。
    this.qr = null
  },
  methods: {
    t,
    startClock() {
      this.stopClock()
      this.clock = setInterval(() => {
        this.now = Date.now()
      }, 1000)
    },
    stopClock() {
      if (!this.clock) return
      clearInterval(this.clock)
      this.clock = null
    },
    async load() {
      if (this.loading) return
      this.loading = true
      this.error = ''
      this.qr = null
      try {
        this.qr = await createConnectQr()
      } catch (error) {
        this.error = this.friendlyError(error)
      } finally {
        this.loading = false
      }
    },
    friendlyError(error) {
      const message = String(error?.message || '').slice(0, 300)
      if (/不支持该操作|不支持手机/.test(message)) {
        return t('这台电脑的 Pilot 版本较旧，不支持生成换机二维码。请先在电脑上安装新版 Pilot。')
      }
      return message || t('生成连接二维码失败')
    },
    back() {
      const pages = getCurrentPages()
      if (Array.isArray(pages) && pages.length > 1) {
        uni.navigateBack()
      } else {
        uni.reLaunch({ url: '/pages/settings/index' })
      }
    }
  }
}
</script>

<style>
.connect-page {
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
.intro {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  margin: 18rpx 0 30rpx;
}
.intro-title {
  color: var(--text-strong);
  font-size: calc(34rpx * var(--font-scale));
  font-weight: 650;
}
.intro-sub {
  margin-top: 14rpx;
  color: var(--muted);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.6;
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
  margin-bottom: 16rpx;
}
.qr-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.qr-frame {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 560rpx;
  height: 560rpx;
  max-width: 100%;
  padding: 20rpx;
  box-sizing: border-box;
  border-radius: 20rpx;
  /* 固定白底保证识别率，不跟随深色/浅色主题。 */
  background: #ffffff;
  overflow: hidden;
}
.qr-image {
  width: 100%;
  height: 100%;
  pointer-events: none;
  user-select: none;
}
.qr-device {
  margin-top: 20rpx;
  color: var(--text);
  font-size: calc(26rpx * var(--font-scale));
  font-weight: 600;
}
.qr-expire {
  margin: 8rpx 0 20rpx;
  color: var(--muted);
  font-size: calc(23rpx * var(--font-scale));
}
.qr-expire.expired {
  color: var(--danger);
}
.qr-warn {
  max-width: 560rpx;
  margin-bottom: 18rpx;
  color: var(--warn);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.55;
  text-align: center;
}
.state-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 70rpx 26rpx;
  margin-bottom: 22rpx;
  background: var(--surface);
  border-radius: 22rpx;
}
.state-title {
  color: var(--text);
  font-size: calc(28rpx * var(--font-scale));
  font-weight: 600;
}
.state-sub {
  margin-top: 12rpx;
  color: var(--muted);
  font-size: calc(23rpx * var(--font-scale));
}
.error-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18rpx;
  padding: 32rpx 26rpx;
  margin-bottom: 22rpx;
  background: var(--surface);
  border-radius: 22rpx;
}
.error-text {
  color: #c9928d;
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.6;
  text-align: center;
}
.safety-card .card-title {
  margin-bottom: 10rpx;
}
.tip {
  display: block;
  margin-top: 10rpx;
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.6;
}
</style>
