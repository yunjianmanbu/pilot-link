<template>
  <view v-if="visible" class="app-dialog-mask" @click="onMaskClick">
    <view class="app-dialog" :class="{ danger }" @click.stop>
      <view v-if="icon" class="app-dialog-icon" :class="{ danger }">
        <text class="app-dialog-icon-text">{{ icon }}</text>
      </view>
      <text class="app-dialog-title">{{ title }}</text>
      <text v-if="message" class="app-dialog-message">{{ message }}</text>
      <view v-if="$slots.default" class="app-dialog-extra">
        <slot />
      </view>
      <view class="app-dialog-actions">
        <button
          v-if="cancelText"
          class="app-dialog-btn ghost"
          :disabled="busy"
          @click="$emit('cancel')"
        >
          {{ cancelText }}
        </button>
        <button
          class="app-dialog-btn main"
          :class="{ danger }"
          :disabled="busy"
          @click="$emit('confirm')"
        >
          {{ busy ? busyText : confirmText }}
        </button>
      </view>
    </view>
  </view>
</template>

<script>
import { t } from '../../lib/i18n.js'
export default {
  name: 'AppDialog',
  props: {
    visible: { type: Boolean, default: false },
    title: { type: String, default: '' },
    message: { type: String, default: '' },
    icon: { type: String, default: '' },
    cancelText: { type: String, default: t("取消") },
    confirmText: { type: String, default: t("确定") },
    busyText: { type: String, default: t("处理中…") },
    busy: { type: Boolean, default: false },
    danger: { type: Boolean, default: false },
    maskClosable: { type: Boolean, default: true }
  },
  emits: ['confirm', 'cancel', 'close'],
  methods: {
    onMaskClick() {
      if (!this.maskClosable || this.busy) return
      this.$emit('close')
    }
  }
}
</script>

<style>
.app-dialog-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40rpx 36rpx;
  box-sizing: border-box;
  background: var(--overlay);
  backdrop-filter: blur(10rpx);
  animation: app-dialog-fade 180ms ease-out both;
}
.app-dialog {
  width: 100%;
  max-width: 620rpx;
  padding: 44rpx 36rpx 28rpx;
  border-radius: 32rpx;
  background:
    linear-gradient(180deg, var(--surface-sheen), transparent 36%),
    var(--surface-float);
  box-shadow: var(--float-shadow);
  box-sizing: border-box;
  animation: app-dialog-pop 220ms cubic-bezier(0.2, 0.9, 0.25, 1.08) both;
}
.app-dialog-icon {
  width: 84rpx;
  height: 84rpx;
  margin: 0 auto 22rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-wash);
}
.app-dialog-icon.danger {
  background: rgba(201, 146, 141, 0.12);
}
.app-dialog-icon-text {
  color: var(--accent-soft);
  font-size: calc(38rpx * var(--font-scale));
  line-height: 1;
}
.app-dialog-icon.danger .app-dialog-icon-text {
  color: var(--danger);
}
.app-dialog-title {
  display: block;
  color: var(--text-strong);
  font-size: calc(34rpx * var(--font-scale));
  font-weight: 650;
  line-height: 1.35;
  text-align: center;
}
.app-dialog-message {
  display: block;
  max-height: 44vh;
  overflow-y: auto;
  margin-top: 18rpx;
  color: var(--muted);
  font-size: calc(26rpx * var(--font-scale));
  line-height: 1.7;
  text-align: center;
  word-break: break-word;
  white-space: pre-line;
}
.app-dialog-extra {
  margin-top: 24rpx;
}
.app-dialog-actions {
  display: flex;
  gap: 16rpx;
  margin-top: 40rpx;
}
.app-dialog-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  height: var(--btn-h-lg);
  margin: 0;
  padding: 0 var(--btn-pad-sm);
  border: none;
  border-radius: var(--btn-radius-lg);
  font-size: var(--btn-font-lg);
  font-weight: 600;
  line-height: 1.2;
}
.app-dialog-btn::after {
  border: none;
}
.app-dialog-btn.ghost {
  background: var(--btn-secondary-bg, var(--surface-3));
  color: var(--btn-secondary-fg, var(--text));
  border: var(--btn-secondary-border, 1rpx solid transparent);
}
.app-dialog-btn.main {
  background: var(--btn-primary-bg, var(--accent-gradient));
  color: var(--btn-primary-fg, var(--accent-ink));
  border: var(--btn-primary-border, 1rpx solid transparent);
  box-shadow: var(--btn-primary-shadow, 0 10rpx 28rpx var(--accent-glow));
}
.app-dialog-btn.main.danger {
  background: var(--btn-danger-strong-bg, linear-gradient(135deg, #c9928d, #a15a55));
  color: var(--btn-danger-strong-fg, #ffffff);
  border: var(--btn-danger-strong-border, 1rpx solid transparent);
  box-shadow: var(--btn-danger-strong-shadow, none);
}
.app-dialog-btn[disabled] {
  opacity: 0.6;
}
.app-dialog-btn:active {
  transform: scale(0.985);
}
@keyframes app-dialog-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes app-dialog-pop {
  from {
    opacity: 0;
    transform: translateY(16rpx) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
