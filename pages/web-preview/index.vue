<template>
  <!--
    内置网页预览：一个真实的页面（不是 plus.webview.create 的游离 WebView）。
    这样它在 uni-app 的页面栈里，标题栏返回键走的是 navigateBack，
    必然回到打开它的那一页（会话 / 链接页），而不是掉回会话列表。
  -->
  <view class="preview-host" :class="[{ 'theme-light': store.theme === 'light' }, 'accent-' + store.accent, 'btn-scheme-' + store.buttonScheme, 'font-' + store.fontSize, 'contrast-' + store.contrast, 'saturation-' + store.saturation]">
    <web-view v-if="url" class="preview-body" :src="url" @error="onError" />
    <view v-else class="preview-fallback">
      <text class="preview-fallback-title">{{ t('没有可预览的地址') }}</text>
      <text class="preview-fallback-hint">{{ t('回到上一页重新点一次链接。') }}</text>
    </view>
  </view>
</template>

<script>
import { t } from '../../lib/i18n.js'
import { isWebLink } from '../../lib/files.js'
import { init, store } from '../../store/index.js'

export default {
  data() {
    return {
      url: '',
      title: ''
    }
  },
  computed: {
    // 主题与按钮方案要跟其余页面同一套变量，否则预览失败时的提示文字没有颜色。
    store() {
      return store
    }
  },
  onLoad(options) {
    try {
      init()
    } catch (error) {
      // 预览页不依赖连接状态，初始化失败也不能挡住网页加载。
      console.error('[pilot] 预览页初始化失败', error)
    }
    const raw = decodeParam(options?.url)
    const name = decodeParam(options?.title)
    this.title = name
    // 只认 http/https：URL 参数是外部传进来的，不能拿它开任意 scheme。
    if (!isWebLink(raw)) {
      uni.showToast({ title: t('只支持打开网页链接'), icon: 'none' })
      setTimeout(() => this.back(), 800)
      return
    }
    this.url = raw
    if (name) {
      try {
        uni.setNavigationBarTitle({ title: name.slice(0, 40) })
      } catch {
        // 标题设置失败不影响预览本身。
      }
    }
  },
  methods: {
    t,
    onError() {
      uni.showToast({ title: t('网页加载失败，可以点右上角用浏览器打开'), icon: 'none' })
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
      uni.reLaunch({ url: '/pages/sessions/index' })
    }
  }
}

/** 参数可能是编码过的，也可能已经被 App 端解过一次；解不开就用原文。 */
function decodeParam(value) {
  const text = typeof value === 'string' ? value : ''
  if (!text) return ''
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}
</script>

<style>
.preview-host {
  width: 100%;
  /* 预览页开着原生导航栏（带返回箭头）：页面高度由窗口撑开，不用 100vh，
     多算一条导航栏高度会把底部内容推出屏幕。 */
  min-height: 100%;
  background: #000000;
}
.preview-body {
  width: 100%;
  height: 100vh;
}
.preview-fallback {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  padding: 60rpx 40rpx;
}
.preview-fallback-title {
  color: var(--text);
  font-size: calc(28rpx * var(--font-scale));
  font-weight: 600;
}
.preview-fallback-hint {
  color: var(--muted);
  font-size: calc(22rpx * var(--font-scale));
}
</style>
