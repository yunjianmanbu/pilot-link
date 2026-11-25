<template>
  <view
    v-if="visible"
    class="app-sheet-mask"
    @touchstart="onMaskPress"
    @mousedown="onMaskPress"
    @click="onMaskClick"
  >
    <view class="app-sheet" :class="{ tall }" @touchstart.stop @mousedown.stop @click.stop>
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
  data() {
    return { openedAt: 0, maskPressedAt: 0 }
  },
  watch: {
    visible: {
      immediate: true,
      handler(value) {
        // 每次打开都重新计时：这次打开之前发生的手势一律不算。
        if (value) this.openedAt = Date.now()
        this.maskPressedAt = 0
      }
    }
  },
  methods: {
    // 手指（或鼠标）在遮罩上按下；只有真按过遮罩才算用户想关闭。
    onMaskPress() {
      this.maskPressedAt = Date.now()
    },
    /**
     * 遮罩点击关闭。
     *
     * 必须自己按下过遮罩才关。手机浏览器 / WebView 在 touchend 之后才把合成
     * click 定目标：手指在汇总条上抬起那一刻弹层已经渲染出来并盖满屏幕，于是
     * 这次 click 落在遮罩上，弹层跟着一起关掉，表现成「点开闪一下就消失，再点
     * 也一样」。所以只认真正按在遮罩上的手势。
     */
    onMaskClick() {
      if (!this.maskClosable) return
      const pressedAt = this.maskPressedAt
      this.maskPressedAt = 0
      if (!pressedAt || pressedAt < this.openedAt) return
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
