import App from './App'
import { createSSRApp } from 'vue'
import { t } from './lib/i18n.js'

export function createApp() {
  const app = createSSRApp(App)
  // 模板里统一调用 t()；语言切换后由设置页重新进入首页刷新文案。
  app.config.globalProperties.t = t
  return { app }
}
