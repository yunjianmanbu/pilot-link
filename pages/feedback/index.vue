<template>
  <view class="page feedback-page" :class="[{ 'theme-light': store.theme === 'light' }, 'accent-' + store.accent, 'btn-scheme-' + store.buttonScheme, 'font-' + store.fontSize, 'contrast-' + store.contrast, 'saturation-' + store.saturation]">
    <view class="topbar">
      <view class="back" @click="back"><view class="back-arrow"></view></view>
      <text class="title">{{ t('问题反馈') }}</text>
    </view>

    <template v-if="!record">
      <view class="card">
        <text class="card-title">{{ t('反馈类型') }}</text>
        <view class="kind-list">
          <view
            v-for="item in kinds"
            :key="item.value"
            class="kind-item"
            :class="{ active: kind === item.value }"
            @click="chooseKind(item.value)"
          >
            <view class="kind-text">
              <text class="kind-name">{{ item.label }}</text>
              <text class="kind-hint">{{ item.hint }}</text>
            </view>
            <text class="kind-check">{{ kind === item.value ? '✓' : '' }}</text>
          </view>
        </view>
      </view>

      <view class="card">
        <text class="card-title">{{ t('一句话概括') }}</text>
        <input
          v-model="title"
          class="text-field"
          :maxlength="titleMax"
          :placeholder="t('例如：排队任务换个会话就消失了')"
        />
        <view class="field-head">
          <text class="card-title">{{ t('具体内容') }}</text>
          <text class="counter">{{ body.length }}/{{ bodyMax }}</text>
        </view>
        <textarea
          v-model="body"
          class="text-area"
          :maxlength="bodyMax"
          :placeholder="t('做了什么、看到什么、期望是什么。附上报错文字会更好定位。')"
        />
        <view class="field-head">
          <text class="card-title">{{ t('联系方式（可选）') }}</text>
        </view>
        <input
          v-model="contact"
          class="text-field"
          :maxlength="contactMax"
          :placeholder="t('邮箱或微信号，方便回复你')"
        />
      </view>

      <text class="note">
        {{ t('反馈只保存在这台手机上，不会自动上传；提交后会生成一段文字，你可以复制后发给开发者。') }}
      </text>
      <view v-if="error" class="error-box">
        <text>{{ error }}</text>
      </view>

      <view class="actions">
        <button class="btn primary" @click="submit">{{ t('提交反馈') }}</button>
      </view>
      <button class="btn ghost history-btn" @click="openHistory">
        {{ t('查看本地反馈（{v1}）', { v1: historyCount }) }}
      </button>
    </template>

    <template v-else>
      <view class="card">
        <view class="done-head">
          <text class="done-title">{{ t('已保存这条反馈') }}</text>
          <text class="done-id">{{ record.createdAt }}</text>
        </view>
        <text class="note">
          {{ t('复制下面的文字发给开发者即可；本机也保留了这条记录。') }}
        </text>
        <textarea class="text-area copy-area" :value="reportText" disabled />
      </view>

      <view class="actions">
        <button class="btn primary" @click="copyReport">{{ t('复制反馈内容') }}</button>
        <button class="btn ghost" @click="writeAnother">{{ t('再写一条') }}</button>
      </view>
    </template>
  </view>
</template>

<script>
import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_CONTACT_MAX,
  FEEDBACK_TITLE_MAX,
  feedbackKindLabel,
  feedbackProblemText,
  formatFeedback,
  loadFeedbackRecords,
  saveFeedback
} from '../../lib/feedback.js'
import { copyText } from '../../lib/clipboard.js'
import { currentAppInfo } from '../../lib/update.js'
import { t } from '../../lib/i18n.js'
import { init, store } from '../../store/index.js'

export default {
  data() {
    return {
      kind: 'bug',
      title: '',
      body: '',
      contact: '',
      error: '',
      record: null,
      historyCount: 0,
      titleMax: FEEDBACK_TITLE_MAX,
      bodyMax: FEEDBACK_BODY_MAX,
      contactMax: FEEDBACK_CONTACT_MAX
    }
  },
  computed: {
    store() {
      return store
    },
    kinds() {
      return [
        {
          value: 'bug',
          label: t('反馈问题'),
          hint: t('哪里报错、卡住或者和预期不一样')
        },
        {
          value: 'feature',
          label: t('提需求'),
          hint: t('希望 Pilot 增加什么能力')
        },
        {
          value: 'suggestion',
          label: t('提建议'),
          hint: t('对已有功能的使用体验有想法')
        }
      ]
    },
    reportText() {
      return this.record ? formatFeedback(this.record) : ''
    }
  },
  onLoad() {
    init()
    this.refreshHistory()
  },
  methods: {
    refreshHistory() {
      this.historyCount = loadFeedbackRecords().length
    },
    chooseKind(value) {
      this.kind = value
      this.error = ''
    },
    submit() {
      const info = currentAppInfo()
      const result = saveFeedback(
        { kind: this.kind, title: this.title, body: this.body, contact: this.contact },
        { version: info?.version || '' }
      )
      if (!result.ok) {
        this.error = feedbackProblemText(result.problem) || t('提交失败，请稍后重试。')
        return
      }
      this.error = ''
      this.record = result.record
      this.refreshHistory()
      uni.showToast({ title: feedbackKindLabel(result.record.kind), icon: 'none' })
    },
    writeAnother() {
      this.record = null
      this.title = ''
      this.body = ''
      this.contact = ''
      this.error = ''
      this.refreshHistory()
    },
    async copyReport() {
      if (!this.record) return
      const ok = await copyText(formatFeedback(this.record))
      uni.showToast({ title: ok ? t('已复制') : t('剪贴板不可用'), icon: 'none' })
    },
    openHistory() {
      // 反馈记录暂时只在设置页汇总展示，这里保留入口不做跳转，避免多开一个页面。
      const rows = loadFeedbackRecords()
      const latest = rows[0]
      uni.showModal({
        title: t('本地反馈（{v1}）', { v1: rows.length }),
        content: latest
          ? `${latest.createdAt} · ${feedbackKindLabel(latest.kind)}\n${latest.title}`
          : t('还没有提交过反馈。'),
        showCancel: false
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
      uni.reLaunch({ url: '/pages/settings/index' })
    }
  }
}
</script>

<style>
.feedback-page {
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
.kind-list {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}
.kind-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 18rpx 20rpx;
  border-radius: 16rpx;
  background: var(--surface-2, rgba(255, 255, 255, 0.03));
}
.kind-item.active {
  background: var(--accent-wash);
}
.kind-text {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.kind-name {
  color: var(--text-strong);
  font-size: calc(27rpx * var(--font-scale));
  font-weight: 600;
}
.kind-hint {
  color: var(--muted);
  font-size: calc(23rpx * var(--font-scale));
}
.kind-check {
  color: var(--accent);
  font-size: calc(28rpx * var(--font-scale));
}
.text-field {
  width: 100%;
  box-sizing: border-box;
  padding: 18rpx 20rpx;
  border-radius: 16rpx;
  background: var(--input-bg, rgba(255, 255, 255, 0.04));
  color: var(--text);
  font-size: calc(26rpx * var(--font-scale));
}
.text-area {
  width: 100%;
  box-sizing: border-box;
  min-height: 260rpx;
  padding: 18rpx 20rpx;
  border-radius: 16rpx;
  background: var(--input-bg, rgba(255, 255, 255, 0.04));
  color: var(--text);
  font-size: calc(26rpx * var(--font-scale));
  line-height: 1.6;
}
.copy-area {
  margin-top: 16rpx;
  min-height: 420rpx;
  font-size: calc(24rpx * var(--font-scale));
}
.field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 22rpx;
}
.field-head .card-title {
  margin-bottom: 12rpx;
}
.counter {
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
  margin-bottom: 12rpx;
}
.note {
  display: block;
  color: var(--muted);
  font-size: calc(23rpx * var(--font-scale));
  line-height: 1.6;
  margin-bottom: 18rpx;
}
.error-box {
  padding: 16rpx 20rpx;
  border-radius: 14rpx;
  background: var(--danger-soft, rgba(201, 146, 141, 0.12));
  color: var(--danger);
  font-size: calc(24rpx * var(--font-scale));
  margin-bottom: 18rpx;
}
.actions {
  display: flex;
  gap: 16rpx;
  margin-bottom: 18rpx;
}
.btn {
  flex: 1;
  height: var(--btn-h-lg);
  padding: 0 var(--btn-pad-lg);
  border-radius: var(--btn-radius);
  font-size: var(--btn-font-lg);
  line-height: 1.2;
  text-align: center;
}
.history-btn {
  height: var(--btn-h-md);
  font-size: var(--btn-font-md);
}
.done-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12rpx;
}
.done-title {
  color: var(--ok);
  font-size: calc(28rpx * var(--font-scale));
  font-weight: 600;
}
.done-id {
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
}
</style>
