<template>
  <!-- 独立页面：只看这个任务可用的工具。 -->
  <view class="page-host" :class="[{ 'theme-light': store.theme === 'light' }, 'accent-' + store.accent, 'btn-scheme-' + store.buttonScheme, 'font-' + store.fontSize, 'contrast-' + store.contrast, 'saturation-' + store.saturation]">
    <!-- 渲染失败也要有东西看：组件抛错时 Vue 会放弃整棵子树，只剩背景色。 -->
    <view v-if="renderError" class="page-error">
      <text class="page-error-title">{{ t('页面渲染失败') }}</text>
      <text class="page-error-hint">{{ renderError }}</text>
      <text class="page-error-back" @click="back">{{ t('返回') }}</text>
    </view>
    <!-- 不再用 v-if="ready" 卡一道：onLoad 抛错会让 ready 永远为 false，只剩背景色。 -->
    <session-resources v-else :target-session-id="sessionId" start-tab="tools" standalone />
  </view>
</template>

<script>
import SessionResources from '../../components/session-resources/session-resources.vue'
import { t } from '../../lib/i18n.js'
import { init, onAppShow, store } from '../../store/index.js'

export default {
  components: { SessionResources },
  data() {
    return { sessionId: '', ready: false, renderError: '' }
  },
  computed: {
    store() {
      return store
    }
  },
  onLoad(options) {
    // 初始化失败不能中断 onLoad，否则 sessionId 空着、页面是白板。
    try {
      init()
    } catch (error) {
      console.error('[pilot] 工具页初始化失败', error)
    }
    let id = typeof options?.sessionId === 'string' ? options.sessionId : ''
    if (id) {
      try {
        id = decodeURIComponent(id)
      } catch {
        // 已经是解码后的原文，直接用。
      }
    }
    this.sessionId = id || store.currentSessionId || ''
    this.ready = true
  },
  /** 子组件渲染抛错时不要再白屏：把原因写在页面上，并留一个返回。 */
  errorCaptured(error) {
    this.renderError = String(error?.message || error || '未知错误')
    console.error('[pilot] 工具页渲染失败', error)
    return false
  },
  methods: {
    t,
    back() {
      try {
        if (getCurrentPages().length > 1) {
          uni.navigateBack()
          return
        }
      } catch {
        // ignore
      }
      uni.reLaunch({ url: '/pages/sessions/index' })
    }
  },
  onShow() {
    if (!store.pairing) {
      uni.reLaunch({ url: '/pages/pair/index' })
      return
    }
    onAppShow()
  }
}
</script>

<style>
/* 用 min-height 而不是 height：App 端 100vh 算成 0 时，height 会把整页压成空白。 */
.page-host {
  min-height: 100vh;
  background: var(--bg);
}
.page-error {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  padding: calc(var(--status-bar-height) + 120rpx) 40rpx 40rpx;
}
.page-error-title {
  color: var(--text);
  font-size: calc(30rpx * var(--font-scale));
  font-weight: 600;
}
.page-error-hint {
  color: var(--danger, #ff6b6b);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.5;
  word-break: break-all;
}
.page-error-back {
  margin-top: 20rpx;
  align-self: flex-start;
  padding: 14rpx 34rpx;
  border-radius: 999rpx;
  background: var(--accent-soft);
  color: var(--text);
  font-size: calc(26rpx * var(--font-scale));
}
</style>
