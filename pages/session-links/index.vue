<template>
  <!-- 独立页面：只看这个任务里出现过的链接，点卡片在 App 内预览网页。 -->
  <view class="page-host" :class="[{ 'theme-light': store.theme === 'light' }, 'accent-' + store.accent, 'btn-scheme-' + store.buttonScheme, 'font-' + store.fontSize, 'contrast-' + store.contrast, 'saturation-' + store.saturation]">
    <!-- 渲染失败也要有东西看：组件里一旦抛错，Vue 会放弃整棵子树，
         页面就只剩背景色（用户报的「空白页」）。这里把错误顶上来。 -->
    <view v-if="renderError" class="page-error">
      <text class="page-error-title">{{ t('页面渲染失败') }}</text>
      <text class="page-error-hint">{{ renderError }}</text>
      <text class="page-error-back" @click="back">{{ t('返回') }}</text>
    </view>
    <!-- 不再用 v-if="ready" 卡一道：onLoad 里任何一步抛错都会让 ready 永远为 false，
         页面上就只剩背景色。组件自己对空 sessionId 有空态。 -->
    <session-resources v-else :target-session-id="sessionId" start-tab="links" standalone />
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
    // 初始化失败不能中断 onLoad：一旦抛错，sessionId 就没赋值，页面会是一张白板。
    try {
      init()
    } catch (error) {
      console.error('[pilot] 链接页初始化失败', error)
    }
    // 会话 id 已经是 navigateTo 编码过的，App 端还可能再解一次；
    // decode 抛错同样不能让页面停住。
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
    console.error('[pilot] 链接页渲染失败', error)
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
/* 用 min-height 而不是 height：App 端页面高度算不准时（100vh 为 0），
   height 会把整页压成一条线，用户看到的就是空白页；min-height 至少保住内容。 */
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
