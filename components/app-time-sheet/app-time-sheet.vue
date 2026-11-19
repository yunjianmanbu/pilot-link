<template>
  <app-sheet
    :visible="visible"
    :title="title"
    :subtitle="subtitle"
    @close="$emit('close')"
  >
    <view class="time-sheet-preview">
      <text class="time-sheet-value">{{ hourText }}:{{ minuteText }}</text>
      <text class="time-sheet-caption">{{ t('每天在这个时间执行') }}</text>
    </view>

    <view class="time-sheet-columns">
      <scroll-view
        class="time-sheet-col"
        scroll-y
        :show-scrollbar="false"
        :scroll-into-view="hourAnchor"
      >
        <view
          v-for="hour in hours"
          :id="`time-hour-${hour}`"
          :key="`hour-${hour}`"
          class="time-sheet-cell"
          :class="{ active: hour === selectedHour }"
          @click="selectedHour = hour"
        >{{ pad(hour) }}</view>
      </scroll-view>
      <scroll-view
        class="time-sheet-col"
        scroll-y
        :show-scrollbar="false"
        :scroll-into-view="minuteAnchor"
      >
        <view
          v-for="minute in minutes"
          :id="`time-minute-${minute}`"
          :key="`minute-${minute}`"
          class="time-sheet-cell"
          :class="{ active: minute === selectedMinute }"
          @click="selectedMinute = minute"
        >{{ pad(minute) }}</view>
      </scroll-view>
    </view>

    <template #footer>
      <view class="time-sheet-actions">
        <button class="time-sheet-btn ghost" @click="$emit('close')">{{ cancelText }}</button>
        <button class="time-sheet-btn main" @click="confirm">{{ confirmText }}</button>
      </view>
    </template>
  </app-sheet>
</template>

<script>
import AppSheet from '../app-sheet/app-sheet.vue'
import { t } from '../../lib/i18n.js'
import { formatTimeOfDay, normalizeTimeOfDay, parseTimeOfDay } from '../../lib/time-of-day.js'

export default {
  name: 'AppTimeSheet',
  components: { AppSheet },
  props: {
    visible: { type: Boolean, default: false },
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    value: { type: String, default: '09:00' },
    cancelText: { type: String, default: t('取消') },
    confirmText: { type: String, default: t('确定') }
  },
  emits: ['confirm', 'close'],
  data() {
    return {
      selectedHour: 9,
      selectedMinute: 0,
      hourAnchor: '',
      minuteAnchor: '',
      hours: Array.from({ length: 24 }, (_, index) => index),
      minutes: Array.from({ length: 60 }, (_, index) => index)
    }
  },
  computed: {
    hourText() {
      return this.pad(this.selectedHour)
    },
    minuteText() {
      return this.pad(this.selectedMinute)
    }
  },
  watch: {
    visible(value) {
      if (value) this.resetSelection()
    },
    value(value) {
      if (!this.visible) return
      const parsed = parseTimeOfDay(value)
      if (!parsed) return
      this.selectedHour = parsed.hour
      this.selectedMinute = parsed.minute
    }
  },
  methods: {
    pad(value) {
      return String(Number(value) || 0).padStart(2, '0')
    },
    resetSelection() {
      const parsed = parseTimeOfDay(normalizeTimeOfDay(this.value))
      this.selectedHour = parsed ? parsed.hour : 9
      this.selectedMinute = parsed ? parsed.minute : 0
      // 让两列滚到当前值。先清空再在下一帧设置，重复打开同一个时间也会重新定位。
      this.hourAnchor = ''
      this.minuteAnchor = ''
      this.$nextTick(() => {
        this.hourAnchor = `time-hour-${this.selectedHour}`
        this.minuteAnchor = `time-minute-${this.selectedMinute}`
      })
    },
    confirm() {
      this.$emit('confirm', formatTimeOfDay(this.selectedHour, this.selectedMinute))
      this.$emit('close')
    }
  }
}
</script>

<style>
.time-sheet-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
  padding: 4rpx 30rpx 20rpx;
}
.time-sheet-value {
  color: var(--text-strong);
  font-size: calc(68rpx * var(--font-scale));
  font-weight: 650;
  line-height: 1.1;
  letter-spacing: 4rpx;
  font-variant-numeric: tabular-nums;
}
.time-sheet-caption {
  color: var(--dim);
  font-size: calc(21rpx * var(--font-scale));
}
.time-sheet-columns {
  display: flex;
  gap: 14rpx;
  height: 420rpx;
  margin: 0 30rpx;
}
.time-sheet-col {
  flex: 1;
  height: 420rpx;
  border-radius: 18rpx;
  background: var(--bg-soft);
  box-sizing: border-box;
  overflow: hidden;
}
.time-sheet-cell {
  height: 84rpx;
  line-height: calc(84rpx * var(--font-scale));
  text-align: center;
  color: var(--muted);
  font-size: calc(27rpx * var(--font-scale));
  font-variant-numeric: tabular-nums;
}
.time-sheet-cell:active {
  background: var(--surface-3);
}
.time-sheet-cell.active {
  color: var(--accent-soft);
  font-weight: 650;
  background: var(--accent-wash);
}
.time-sheet-actions {
  display: flex;
  gap: 16rpx;
}
.time-sheet-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 1;
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
.time-sheet-btn::after {
  border: none;
}
.time-sheet-btn.ghost {
  background: var(--btn-secondary-bg, var(--surface-3));
  color: var(--btn-secondary-fg, var(--text));
  border: var(--btn-secondary-border, 1rpx solid transparent);
}
.time-sheet-btn.main {
  background: var(--btn-primary-bg, var(--accent-gradient));
  color: var(--btn-primary-fg, var(--accent-ink));
  border: var(--btn-primary-border, 1rpx solid transparent);
  box-shadow: var(--btn-primary-shadow, 0 10rpx 28rpx var(--accent-glow));
}
.time-sheet-btn:active {
  transform: scale(0.985);
}
</style>
