<template>
  <view v-if="visible" class="app-sheet-mask" @click="onMaskClick">
    <view class="app-sheet" :class="{ tall }" @click.stop>
      <view class="app-sheet-grip"></view>
      <view class="app-sheet-head">
        <view class="app-sheet-heading">
          <text class="app-sheet-title">{{ title }}</text>
          <text v-if="subtitle" class="app-sheet-subtitle">{{ subtitle }}</text>
        </view>
        <view class="app-sheet-close" @click="$emit('close')">
          <text class="app-sheet-close-text">{{ closeText }}</text>
        </view>
      </view>
      <view class="app-sheet-body">
        <slot />
      </view>
      <view v-if="$slots.footer" class="app-sheet-foot">
        <slot name="footer" />
      </view>
    </view>
  </view>
</template>

<script>
import { t } from '../../lib/i18n.js'
export default {
  name: 'AppSheet',
  props: {
    visible: { type: Boolean, default: false },
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    closeText: { type: String, default: t("关闭") },
    tall: { type: Boolean, default: false },
    maskClosable: { type: Boolean, default: true }
  },
  emits: ['close'],
  methods: {
    onMaskClick() {
      if (!this.maskClosable) return
      this.$emit('close')
    }
  }
}
</script>

<style>
.app-sheet-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 1100;
  display: flex;
  align-items: flex-end;
  background: var(--overlay);
  backdrop-filter: blur(8rpx);
  animation: app-sheet-fade 180ms ease-out both;
}
.app-sheet {
  width: 100%;
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 34rpx 34rpx 0 0;
  background: var(--surface-float);
  box-shadow: var(--float-shadow);
  padding-bottom: calc(env(safe-area-inset-bottom) + 14rpx);
  box-sizing: border-box;
  animation: app-sheet-up 240ms cubic-bezier(0.2, 0.9, 0.25, 1) both;
}
.app-sheet.tall {
  height: 82vh;
}
.app-sheet-grip {
  width: 76rpx;
  height: 8rpx;
  margin: 14rpx auto 2rpx;
  border-radius: 8rpx;
  background: var(--border);
  flex: none;
}
.app-sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  padding: 20rpx 30rpx 18rpx;
  flex: none;
}
.app-sheet-heading {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.app-sheet-title {
  color: var(--text-strong);
  font-size: calc(33rpx * var(--font-scale));
  font-weight: 650;
  line-height: 1.3;
}
.app-sheet-subtitle {
  color: var(--muted);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.45;
}
.app-sheet-close {
  flex: none;
  min-width: 92rpx;
  height: 56rpx;
  padding: 0 18rpx;
  border-radius: 28rpx;
  background: var(--surface-3);
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
.app-sheet-close:active {
  opacity: 0.72;
}
.app-sheet-close-text {
  color: var(--muted);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1;
}
.app-sheet-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.app-sheet-foot {
  flex: none;
  padding: 16rpx 30rpx 4rpx;
}
@keyframes app-sheet-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes app-sheet-up {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}
</style>
