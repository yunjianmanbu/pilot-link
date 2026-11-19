<template>
  <view class="launch" :class="[{ 'theme-light': store.theme === 'light' }, 'accent-' + store.accent, 'btn-scheme-' + store.buttonScheme, 'font-' + store.fontSize, 'contrast-' + store.contrast, 'saturation-' + store.saturation]">
    <image class="logo" src="/static/icons/192.png" mode="aspectFit" />
    <text class="name">Pilot Link</text>
    <text class="hint">{{ hint }}</text>
    <app-dialog-host />
  </view>
</template>

<script>
import AppDialogHost from '../../components/app-dialog-host/app-dialog-host.vue'
import { init, needsPair, store } from '../../store/index.js'
import { t } from '../../lib/i18n.js'
import { closeSplash } from '../../lib/splash.js'

export default {
  components: { AppDialogHost },
  data() {
    return { hint: t("正在启动…") }
  },
  computed: {
    store() {
      return store
    }
  },
  onLoad() {
    // 兜底定时器先挂上：init() 抛异常时也必须能离开启动页，否则会停在深色页面上（黑屏）。
    this.leaving = false
    this.paired = null
    this.leaveTimer = setTimeout(() => this.leave(), 1500)
    try {
      init()
      this.paired = !needsPair()
      this.hint = this.paired ? t("正在连接你的电脑…") : t("需要先扫码配对")
    } catch (err) {
      console.error('[pilot] 启动页初始化失败', err)
      this.paired = null
    }
  },
  onShow() {
    // 从后台回来时如果还停在启动页（上次跳转被系统拦了），重新走一次跳转。
    if (!this.leaving && this.leaveTimer === null) {
      this.leave()
    }
  },
  onReady() {
    // 必须等首帧渲染完成再 reLaunch：启动图的自动关闭依赖首页渲染完成事件，
    // 在 onLoad 里立刻切走会让启动图等不到该事件，一直盖在界面上（表现为黑屏，
    // 切后台再回前台时运行时会强制移除启动图，所以看起来「恢复」了）。
    setTimeout(() => this.leave(), 120)
  },
  onUnload() {
    if (this.leaveTimer) {
      clearTimeout(this.leaveTimer)
      this.leaveTimer = null
    }
  },
  methods: {
    leave() {
      if (this.leaving) return
      this.leaving = true
      if (this.leaveTimer) {
        clearTimeout(this.leaveTimer)
        this.leaveTimer = null
      }
      // 启动页已经渲染完成，先关掉启动图再切页，避免启动图等不到渲染回调而一直盖着。
      closeSplash()
      const url = this.paired === false ? '/pages/pair/index' : '/pages/sessions/index'
      uni.reLaunch({
        url,
        // reLaunch 在个别 ROM/低内存时会失败，失败后兜底用 redirectTo，绝不能停在启动页。
        fail: () => {
          uni.redirectTo({ url })
        }
      })
    }
  }
}
</script>

<style>
.launch {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  color: var(--text);
}
.logo {
  width: 148rpx;
  height: 148rpx;
  border-radius: 34rpx;
  box-shadow: 0 18rpx 48rpx rgba(143, 168, 192, 0.28);
}
.name {
  margin-top: 32rpx;
  color: var(--text-strong);
  font-size: calc(40rpx * var(--font-scale));
  font-weight: 600;
}
.hint {
  margin-top: 16rpx;
  color: var(--muted);
  font-size: calc(26rpx * var(--font-scale));
}
</style>
