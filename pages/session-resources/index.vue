<template>
  <!--
    会话资源合并页：五个分类共用一条标签条。
    任务行上的快捷入口不进来，它们各有独立页面（链接 / 工具 / 记忆 / 知识库 / 文件）。
  -->
  <view class="page-host" :class="[{ 'theme-light': store.theme === 'light' }, 'accent-' + store.accent, 'btn-scheme-' + store.buttonScheme, 'font-' + store.fontSize, 'contrast-' + store.contrast, 'saturation-' + store.saturation]">
    <session-resources
      :target-session-id="sessionId"
      :start-tab="tab"
      :standalone="false"
    />
  </view>
</template>

<script>
import SessionResources from '../../components/session-resources/session-resources.vue'
import { init, onAppShow, store } from '../../store/index.js'

export default {
  components: { SessionResources },
  data() {
    return {
      sessionId: '',
      tab: '',
      ready: false
    }
  },
  computed: {
    // 外层也挂主题 class：返回这个页面时字号/强调色立刻跟着变，不等子组件重渲染。
    store() {
      return store
    }
  },
  onLoad(options) {
    // 初始化失败不能中断 onLoad，否则 sessionId 空着、页面是白板。
    try {
      init()
    } catch (error) {
      console.error('[pilot] 资源页初始化失败', error)
    }
    // 会话 id 已经是 navigateTo 编码过的，App 端还可能再解一次；
    // decode 抛错会中断 onLoad，ready 永远为 false，页面就只剩背景色。
    let id = typeof options?.sessionId === 'string' ? options.sessionId : ''
    if (id) {
      try {
        id = decodeURIComponent(id)
      } catch {
        // 已经是解码后的原文，直接用。
      }
    }
    this.sessionId = id || store.currentSessionId || ''
    this.tab = typeof options?.tab === 'string' ? options.tab : ''
    // 参数就绪后再挂载面板，避免子组件先拿到空的 sessionId 白跑一次请求。
    this.ready = true
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
/* 外壳只负责撑满一屏并让主题变量向下继承，实际布局在 session-resources 组件里。 */
.page-host {
  height: 100vh;
  background: var(--bg);
}
</style>
