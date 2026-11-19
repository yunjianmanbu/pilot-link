<template>
  <view class="page manual-page" :class="[{ 'theme-light': store.theme === 'light' }, 'accent-' + store.accent, 'btn-scheme-' + store.buttonScheme, 'font-' + store.fontSize, 'contrast-' + store.contrast, 'saturation-' + store.saturation]">
    <view class="topbar">
      <view class="back" @click="back"><view class="back-arrow"></view></view>
      <text class="title">{{ t('使用手册') }}</text>
    </view>

    <view class="manual-hero">
      <text class="manual-eyebrow">{{ t('Pilot 使用手册') }}</text>
      <text class="manual-title">{{ t('从第一次配对到日常任务，一页看完。') }}</text>
      <text class="manual-sub">{{ t('桌面端与手机端的完整操作说明，已随 App 内置，离线也能看。') }}</text>
    </view>

    <view class="manual-card">
      <rich-text :nodes="nodes" />
    </view>

    <text class="manual-note">
      {{ t('手册内容随版本更新；如果与当前界面不一致，以界面上的实际按钮为准。') }}
    </text>

    <view class="manual-actions">
      <button class="btn primary" @click="openFeedback">{{ t('问题反馈 / 提需求 / 提建议') }}</button>
      <button class="btn ghost" @click="back">{{ t('返回帮助') }}</button>
    </view>
  </view>
</template>

<script>
import { MANUAL_IMAGES, MANUAL_MARKDOWN } from '../../lib/manual-content.js'
import { renderMarkdown } from '../../lib/markdown.js'
import { t } from '../../lib/i18n.js'
import { init, store } from '../../store/index.js'

export default {
  data() {
    return {}
  },
  computed: {
    store() {
      return store
    },
    nodes() {
      return renderMarkdown(MANUAL_MARKDOWN, {
        theme: store.theme === 'light' ? 'light' : 'dark',
        allowImages: true,
        resolveImage: (src) => MANUAL_IMAGES[src] || ''
      })
    }
  },
  onLoad() {
    init()
  },
  methods: {
    openFeedback() {
      uni.navigateTo({ url: '/pages/feedback/index' })
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
      uni.reLaunch({ url: '/pages/settings/index' })
    }
  }
}
</script>

<style>
.manual-page {
  padding: calc(var(--status-bar-height) + 20rpx) 28rpx 80rpx;
  box-sizing: border-box;
}
.topbar {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-bottom: 24rpx;
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
.manual-hero {
  padding: 8rpx 4rpx 22rpx;
}
.manual-eyebrow {
  display: block;
  color: var(--muted);
  font-size: calc(24rpx * var(--font-scale));
  letter-spacing: 1rpx;
  margin-bottom: 10rpx;
}
.manual-title {
  display: block;
  color: var(--text-strong);
  font-size: calc(40rpx * var(--font-scale));
  font-weight: 650;
  line-height: 1.35;
  margin-bottom: 12rpx;
}
.manual-sub {
  display: block;
  color: var(--muted);
  font-size: calc(26rpx * var(--font-scale));
  line-height: 1.6;
}
.manual-card {
  background: var(--surface);
  border-radius: 22rpx;
  padding: 26rpx;
  margin-bottom: 22rpx;
  overflow: hidden;
}
.manual-note {
  display: block;
  color: var(--dim);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.6;
  padding: 0 6rpx 22rpx;
}
.manual-actions {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}
</style>
