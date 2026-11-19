<template>
  <view class="page select-page" :class="[{ 'theme-light': store.theme === 'light' }, 'accent-' + store.accent, 'btn-scheme-' + store.buttonScheme, 'font-' + store.fontSize, 'contrast-' + store.contrast, 'saturation-' + store.saturation]">
    <view class="topbar">
      <view class="back" @click="back"><view class="back-arrow"></view></view>
      <view class="titles">
        <text class="title">{{ t('选择复制') }}</text>
        <text class="subtitle">{{ subtitle }}</text>
      </view>
      <text class="copy-all" @click="copyAll">{{ t('复制全部') }}</text>
    </view>

    <scroll-view class="body" scroll-y>
      <view v-if="error" class="card error-card">
        <text class="error-text">{{ error }}</text>
      </view>
      <view v-else class="card text-card">
        <textarea
          class="select-text"
          :value="text"
          :maxlength="-1"
          auto-height
          :show-confirm-bar="false"
          :cursor-spacing="24"
        />
        <text class="hint">
          {{ t('长按上面的文字打开系统选择菜单，拖动选择要复制的内容后再点「复制」；也可以直接点右上角「复制全部」。') }}
        </text>
      </view>
      <view class="bottom-space"></view>
    </scroll-view>
    <app-dialog-host />
  </view>
</template>

<script>
import AppDialogHost from '../../components/app-dialog-host/app-dialog-host.vue'
import { copyText, takeSelectionText } from '../../lib/clipboard.js'
import { init, store } from '../../store/index.js'
import { t } from '../../lib/i18n.js'

export default {
  components: { AppDialogHost },
  data() {
    return {
      text: '',
      error: ''
    }
  },
  computed: {
    store() {
      return store
    },
    subtitle() {
      if (!this.text) return t("本条消息")
      return t("{v1} 个字符", { v1: this.text.length })
    }
  },
  onLoad() {
    init()
    this.text = takeSelectionText()
    if (!this.text) this.error = t("没有可复制的内容，请返回会话重新选择")
  },
  methods: {
    async copyAll() {
      if (!this.text) return
      const ok = await copyText(this.text)
      uni.showToast({
        title: ok ? t("已复制全部内容") : t("复制失败，请长按手动选择"),
        icon: 'none'
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
.select-page {
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
     标题行高 32rpx × 1.5 = 48rpx，图标框上移半个差值。 */
  align-self: flex-start;
  margin-top: -4rpx;
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
  font-size: calc(32rpx * var(--font-scale));
  font-weight: 650;
}
.subtitle {
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
}
.copy-all {
  color: var(--accent-soft);
  font-size: calc(24rpx * var(--font-scale));
  padding: 10rpx 0 10rpx 16rpx;
  flex-shrink: 0;
}
.body {
  flex: 1;
  min-height: 0;
  padding: 0 28rpx;
  box-sizing: border-box;
}
.card {
  background: var(--surface);
  border-radius: 18rpx;
  padding: 24rpx;
  margin-bottom: 18rpx;
}
.select-text {
  width: 100%;
  min-height: 60vh;
  color: var(--text);
  font-size: calc(25rpx * var(--font-scale));
  line-height: 1.68;
  font-family: monospace;
}
.hint {
  display: block;
  margin-top: 18rpx;
  padding: 12rpx 14rpx;
  border-radius: 12rpx;
  background: var(--bg-soft);
  color: var(--dim);
  font-size: calc(22rpx * var(--font-scale));
  line-height: 1.55;
}
.error-card {
  background: rgba(201, 146, 141, 0.08);
}
.error-text {
  color: var(--danger);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.55;
  word-break: break-word;
}
.bottom-space {
  height: calc(40rpx + env(safe-area-inset-bottom));
}
</style>
