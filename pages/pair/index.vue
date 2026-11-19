<template>
  <view class="page pair-page" :class="[{ 'theme-light': store.theme === 'light' }, 'accent-' + store.accent, 'btn-scheme-' + store.buttonScheme, 'font-' + store.fontSize, 'contrast-' + store.contrast, 'saturation-' + store.saturation]">
    <view v-if="addMode" class="topbar">
      <view class="back" @click="goBack"><view class="back-arrow"></view></view>
      <text class="title">{{ t('添加电脑') }}</text>
    </view>

    <view class="pair-head">
      <view class="logo">C</view>
      <text class="pair-title">{{ addMode ? t('连接另一台电脑') : t('连接 Pilot') }}</text>
      <text class="pair-sub">{{ t('在电脑的「Pilot → 手机配对」里生成二维码，用手机扫描即可连接。') }}</text>
    </view>

    <view v-if="store.pairing && !addMode" class="card paired-card">
      <text class="card-title">{{ t('已连接{v1}', { v1: store.deviceName || t('电脑') }) }}</text>
      <text class="muted">{{ t('这台手机已经完成配对。') }}</text>
      <button class="btn primary" @click="goSessions">{{ t('进入会话列表') }}</button>
    </view>

    <view v-else class="card">
      <text class="card-title">{{ t('扫码配对') }}</text>
      <button class="btn primary big" :disabled="store.pairBusy" @click="scan">
        {{ store.pairBusy ? t('正在配对…') : t('扫描电脑上的二维码') }}
      </button>

      <view class="divider"><text>{{ t('或粘贴配对链接') }}</text></view>
      <textarea
        v-model="link"
        class="link-input"
        :placeholder="t('粘贴配对链接，例如 https://…/#p=…')"
        :maxlength="-1"
        auto-height
      />
      <view class="row-actions">
        <button class="btn ghost" @click="paste">{{ t('从剪贴板粘贴') }}</button>
        <button class="btn ghost" :disabled="!link.trim()" @click="applyLink(link)">{{ t('解析链接') }}</button>
      </view>

      <view v-if="preview" class="preview">
        <view class="preview-row">
          <text class="preview-label">{{ t('电脑') }}</text>
          <text class="preview-value">{{ preview.deviceName }}</text>
        </view>
        <view class="preview-row">
          <text class="preview-label">{{ t('中继') }}</text>
          <text class="preview-value">{{ relayHost }}</text>
        </view>
        <view class="preview-row">
          <text class="preview-label">{{ t('手机名称') }}</text>
          <input v-model="phoneName" class="preview-input" :maxlength="40" />
        </view>
        <button class="btn primary big" :disabled="store.pairBusy" @click="confirm">
          {{ store.pairBusy ? t('等待电脑确认…') : t('开始配对') }}
        </button>
        <text v-if="store.pairBusy" class="muted center">{{ t('请回到电脑上确认这次配对。') }}</text>
      </view>
    </view>

    <view v-if="errorText" class="error-box">{{ errorText }}</view>

    <view class="tips">
      <text class="tip">{{ t('· 配对后自动保持登录，App 重启也不用重新扫码。') }}</text>
      <text class="tip">{{ t('· 可以添加多台电脑，在会话页或设置里随时切换。') }}</text>
      <text class="tip">{{ t('· 只有连续 7 天完全没有使用时，才需要重新扫码。') }}</text>
      <text class="tip">{{ t('· 消息在手机与电脑之间端到端加密，中继只转发密文。') }}</text>
    </view>
    <app-dialog-host />
  </view>
</template>

<script>
import AppDialogHost from '../../components/app-dialog-host/app-dialog-host.vue'
import { pairingPayloadFromText } from '../../lib/pairing.js'
import { defaultPhoneName } from '../../lib/storage.js'
import { init, pairWithPayload, store, updatePhoneName } from '../../store/index.js'
import { t } from '../../lib/i18n.js'
import { closeSplash } from '../../lib/splash.js'

export default {
  components: { AppDialogHost },
  data() {
    return {
      addMode: false,
      link: '',
      preview: null,
      phoneName: defaultPhoneName(),
      error: ''
    }
  },
  computed: {
    store() {
      return store
    },
    errorText() {
      return this.error || store.pairError || ''
    },
    relayHost() {
      if (!this.preview) return ''
      const match = /^(?:wss?|https?):\/\/([^/?#]+)/i.exec(this.preview.relayUrl)
      return match ? match[1] : this.preview.relayUrl
    }
  },
  onLoad(options) {
    this.addMode = String(options?.add || '') === '1'
    init()
    this.error = store.pairError || ''
    this.parseHash()
  },
  onReady() {
    // 配对页是未配对时的首页，渲染完成后最后关一次启动图。
    closeSplash()
  },
  methods: {
    parseHash() {
      if (typeof location === 'undefined') return
      const href = String(location.href || '')
      const marker = href.indexOf('#p=')
      if (marker < 0) return
      this.applyLink(href.slice(marker))
    },
    applyLink(text) {
      this.error = ''
      try {
        this.preview = pairingPayloadFromText(text)
        this.phoneName = this.phoneName || defaultPhoneName()
        if (typeof location !== 'undefined' && location.hash) {
          try {
            history.replaceState(null, '', location.pathname)
          } catch {
            // ignore
          }
        }
      } catch (error) {
        this.preview = null
        this.error = error?.message || String(error)
      }
    },
    scan() {
      this.error = ''
      try {
        uni.scanCode({
          onlyFromCamera: false,
          scanType: ['qrCode'],
          success: (result) => {
            const text = result?.result || result?.path || ''
            if (!text) {
              this.error = t("没有识别到二维码内容")
              return
            }
            this.link = text
            this.applyLink(text)
          },
          fail: (error) => {
            this.error = error?.errMsg?.includes('cancel')
              ? ''
              : t("当前环境不支持扫码，请粘贴配对链接")
          }
        })
      } catch {
        this.error = t("当前环境不支持扫码，请粘贴配对链接")
      }
    },
    paste() {
      try {
        uni.getClipboardData({
          success: (result) => {
            const text = String(result?.data || '').trim()
            if (!text) {
              this.error = t("剪贴板是空的")
              return
            }
            this.link = text
            this.applyLink(text)
          },
          fail: () => {
            this.error = t("读取剪贴板失败，请手动粘贴")
          }
        })
      } catch {
        this.error = t("读取剪贴板失败，请手动粘贴")
      }
    },
    async confirm() {
      if (!this.preview || store.pairBusy) return
      this.error = ''
      updatePhoneName(this.phoneName)
      const ok = await pairWithPayload(this.preview)
      if (!ok) {
        this.error = store.pairError || t("配对失败，请重新生成二维码再试")
        return
      }
      uni.showToast({ title: this.addMode ? t("已添加电脑") : t("配对成功"), icon: 'none' })
      if (this.addMode) {
        setTimeout(() => this.goBack(), 500)
        return
      }
      uni.reLaunch({ url: '/pages/sessions/index' })
    },
    goSessions() {
      uni.reLaunch({ url: '/pages/sessions/index' })
    },
    goBack() {
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
.pair-page {
  /* 自定义导航栏：为系统状态栏留出高度，H5 下变量为 0。 */
  padding: calc(var(--status-bar-height) + 20rpx) 28rpx 80rpx;
  box-sizing: border-box;
}
/* 与设置页、更新页保持同一套标题栏样式。 */
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
.pair-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 40rpx;
}
.logo {
  width: 112rpx;
  height: 112rpx;
  border-radius: 28rpx;
  background: var(--accent-gradient);
  color: var(--accent-ink);
  font-size: calc(54rpx * var(--font-scale));
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pair-title {
  margin-top: 28rpx;
  color: var(--text-strong);
  font-size: calc(40rpx * var(--font-scale));
  font-weight: 600;
}
.pair-sub {
  margin-top: 14rpx;
  color: var(--muted);
  font-size: calc(26rpx * var(--font-scale));
  line-height: 1.6;
  text-align: center;
}
.card {
  background: var(--surface);
  border-radius: 24rpx;
  padding: 30rpx;
  margin-bottom: 24rpx;
}
.card-title {
  display: block;
  color: var(--text);
  font-size: calc(30rpx * var(--font-scale));
  font-weight: 600;
  margin-bottom: 24rpx;
}
.paired-card {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}
.big {
  height: 92rpx;
  line-height: calc(92rpx * var(--font-scale));
  font-size: calc(30rpx * var(--font-scale));
}
.divider {
  display: flex;
  align-items: center;
  gap: 18rpx;
  margin: 32rpx 0 22rpx;
  color: var(--dim);
  font-size: calc(24rpx * var(--font-scale));
}
.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1rpx;
  background: var(--line);
}
.link-input {
  width: 100%;
  box-sizing: border-box;
  min-height: 130rpx;
  padding: 20rpx;
  background: var(--input-bg);
  border-radius: 16rpx;
  color: var(--text);
  font-size: calc(25rpx * var(--font-scale));
  line-height: 1.5;
}
.row-actions {
  display: flex;
  gap: 18rpx;
  margin-top: 20rpx;
}
.row-actions .btn {
  flex: 1;
  height: var(--btn-h-md);
  font-size: var(--btn-font-md);
}
.preview {
  margin-top: 30rpx;
  padding: 20rpx 22rpx;
  border-radius: 16rpx;
  background: var(--bg-soft);
}
.preview-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  padding: 12rpx 0;
}
.preview-label {
  color: var(--muted);
  font-size: calc(26rpx * var(--font-scale));
  width: 140rpx;
  flex-shrink: 0;
}
.preview-value {
  color: var(--text);
  font-size: calc(26rpx * var(--font-scale));
  flex: 1;
  text-align: right;
  word-break: break-all;
}
.preview-input {
  flex: 1;
  text-align: right;
  color: var(--text);
  font-size: calc(26rpx * var(--font-scale));
  background: transparent;
}
.preview .big {
  margin-top: 22rpx;
}
.center {
  display: block;
  text-align: center;
  margin-top: 16rpx;
}
.error-box {
  margin: 0 0 24rpx;
  padding: 20rpx 24rpx;
  border-radius: 16rpx;
  background: rgba(201, 146, 141, 0.12);
  color: #c9928d;
  font-size: calc(25rpx * var(--font-scale));
  line-height: 1.55;
}
.theme-light .error-box {
  color: #a15a55;
}
.tips {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  padding: 6rpx 8rpx;
}
.tip {
  color: var(--dim);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.55;
}
</style>
