import App from './App'
import { createSSRApp } from 'vue'
import { t } from './lib/i18n.js'

export function createApp() {
  const app = createSSRApp(App)
  // 模板里统一调用 t()；语言切换后由设置页重新进入首页刷新文案。
  app.config.globalProperties.t = t
  return { app }
}

// #ifdef H5
/**
 * 注册 PWA 的 Service Worker。
 *
 * 只在安全上下文（HTTPS / localhost）下做：局域网 HTTP 访问时浏览器直接禁用 SW，
 * 强注册只会往控制台刷一行报错。站点根目录没有 sw.js（比如 HBuilderX 的 H5 调试
 * 服务器）时，注册失败也只是静默跳过 —— 装到主屏和离线可用是增强，不是前提。
 */
function registerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  const insecure =
    typeof window.isSecureContext === 'boolean' &&
    !window.isSecureContext &&
    location.hostname !== 'localhost' &&
    location.hostname !== '127.0.0.1'
  if (insecure) return
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .catch(() => {
        // 开发预览或旧版缓存没有 sw.js，忽略即可
      })
  })
}

registerServiceWorker()
// #endif
