<template>
  <app-sheet
    :visible="visible"
    :title="title"
    :subtitle="subtitle"
    @close="$emit('close')"
  >
    <scroll-view
      class="app-picker-list"
      scroll-y
      :show-scrollbar="false"
      :style="{ height: listHeight }"
    >
      <view v-if="normalizedOptions.length === 0" class="app-picker-empty">
        <text class="app-picker-empty-text">{{ emptyText }}</text>
      </view>
      <view
        v-for="(option, index) in normalizedOptions"
        :key="index"
        class="app-picker-item"
        :class="{ active: index === value }"
        @click="pick(index)"
      >
        <view class="app-picker-main">
          <text class="app-picker-label">{{ option.label }}</text>
          <text v-if="option.hint" class="app-picker-hint">{{ option.hint }}</text>
        </view>
        <text class="app-picker-check">{{ index === value ? '✓' : '' }}</text>
      </view>
    </scroll-view>
  </app-sheet>
</template>

<script>
import AppSheet from '../app-sheet/app-sheet.vue'
import { t } from '../../lib/i18n.js'

export default {
  name: 'AppPicker',
  components: { AppSheet },
  props: {
    visible: { type: Boolean, default: false },
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    // 字符串或 { label, hint }；设置页的模型选项用 title，一并兼容。
    options: { type: Array, default: () => [] },
    value: { type: Number, default: -1 },
    emptyText: { type: String, default: t('暂无可选项') }
  },
  emits: ['select', 'close'],
  computed: {
    normalizedOptions() {
      return (Array.isArray(this.options) ? this.options : []).map((option) => {
        if (typeof option === 'string') return { label: option, hint: '' }
        const label = option?.label ?? option?.title ?? option?.name ?? ''
        return {
          label: String(label),
          hint: option?.hint ? String(option.hint) : ''
        }
      })
    },
    listHeight() {
      // 空列表要留出比空态提示（min-height 160rpx）更高的高度，
      // 否则 scroll-view 会把“暂无可选项”裁掉，弹框看起来一片空白。
      if (this.normalizedOptions.length === 0) return '220rpx'
      return `${Math.min(this.normalizedOptions.length, 7) * 104}rpx`
    }
  },
  methods: {
    pick(index) {
      if (index < 0 || index >= this.normalizedOptions.length) return
      this.$emit('select', index)
      this.$emit('close')
    }
  }
}
</script>

<style>
.app-picker-list {
  width: 100%;
}
.app-picker-item {
  min-height: 104rpx;
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding: 18rpx 30rpx;
  box-sizing: border-box;
}
.app-picker-item:active {
  background: var(--surface-3);
}
.app-picker-item.active {
  background: var(--accent-wash-soft);
}
.app-picker-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.app-picker-label {
  color: var(--text);
  font-size: calc(27rpx * var(--font-scale));
  line-height: 1.4;
  word-break: break-word;
}
.app-picker-item.active .app-picker-label {
  color: var(--accent-soft);
  font-weight: 600;
}
.app-picker-hint {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
  line-height: 1.45;
}
.app-picker-check {
  width: 36rpx;
  flex: none;
  color: var(--accent-soft);
  font-size: calc(28rpx * var(--font-scale));
  line-height: 1;
  text-align: right;
}
.app-picker-empty {
  min-height: 160rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 30rpx;
}
.app-picker-empty-text {
  color: var(--dim);
  font-size: calc(23rpx * var(--font-scale));
}
</style>
