<script>
import { applySystemBars, init, onAppHide, onAppShow } from './store/index.js'
import { autoCheckUpdate } from './lib/update.js'
import { sweepFileCache } from './lib/file-cache.js'
import { closeSplash, installSplashGuard } from './lib/splash.js'

let updateTimer = null
let cancelSplashGuard = null
let startupErrorHooked = false

/** 任何启动期 JS 异常都不能让启动图一直挡在界面上。 */
function hookStartupErrors() {
  if (startupErrorHooked) return
  startupErrorHooked = true
  try {
    if (typeof uni === 'undefined') return
    if (typeof uni.onError === 'function') uni.onError(() => closeSplash())
    if (typeof uni.onUnhandledRejection === 'function') {
      uni.onUnhandledRejection(() => closeSplash())
    }
  } catch {
    // 没有这些接口的宿主（H5 旧版）直接跳过。
  }
}

/** 初始化失败也要让 App 继续走：页面自己会显示错误状态，不能停在黑屏。 */
function safeInit() {
  try {
    init()
  } catch (err) {
    console.error('[pilot] 启动初始化失败', err)
    closeSplash()
  }
}

/** 启动时清掉超过保存天数没看的文件缓存；失败只记日志，不影响启动。 */
function sweepDownloadCache() {
  try {
    void sweepFileCache().catch((err) => console.error('[pilot] 清理文件缓存失败', err))
  } catch (err) {
    console.error('[pilot] 清理文件缓存失败', err)
  }
}

export default {
  onLaunch() {
    // 先挂启动图兜底再初始化：init() 内部任何异常都不能导致兜底没挂上。
    // 关闭会在 300ms / 1000ms / 2500ms / 5000ms 各试一次，冷启动慢的机型也能关掉。
    if (!cancelSplashGuard) {
      cancelSplashGuard = installSplashGuard()
    }
    hookStartupErrors()
    safeInit()
    sweepDownloadCache()
  },
  onShow() {
    // 从后台回到前台先清启动图，再做其它事：早期版本把 init 放在前面，一旦
    // init 抛错就再也不会执行到关闭，表现为“切后台再回来才恢复”的黑屏。
    closeSplash()
    safeInit()
    onAppShow()
    // 部分 ROM 在回到前台后会重置状态栏/导航栏配色，这里再对齐一次。
    applySystemBars()
    // 等启动页跳转完成后再静默检查更新（内部做 30 分钟节流，H5 自动跳过）。
    if (!updateTimer) {
      updateTimer = setTimeout(() => {
        updateTimer = null
        void autoCheckUpdate()
      }, 3000)
    }
  },
  onHide() {
    onAppHide()
  }
}
</script>

<style>
/* 深色是默认主题；.theme-light 覆盖同一组变量，页面根节点切换 class 即可。 */
page,
:root {
  /* 字号设置：标准为 1；大/特大只改这一个乘数，所有字体声明统一走 calc。 */
  --font-scale: 1;
  --bg: #000000;
  --bg-2: #0a0a0a;
  /* 页面画布与悬浮层：页面底色单独一层，弹窗/弹层用比卡片再高一档的
     --surface-float 浮起来；--hover 是半透明叠色，换主题不用改 :hover。 */
  --page: #000000;
  --bg-elevated: #121212;
  --surface-float: #2a2a2a;
  --surface-sheen: rgba(255, 255, 255, 0.045);
  --float-shadow: 0 24rpx 60rpx rgba(0, 0, 0, 0.6);
  --hover: rgba(255, 255, 255, 0.06);
  --hover-strong: rgba(255, 255, 255, 0.1);
  --bg-soft: #242424;
  --surface: #1a1a1a;
  --surface-2: #242424;
  --surface-3: #2f2f2f;
  --border: transparent;
  --border-soft: transparent;
  /* 分隔线/表格行/空态虚线框专用：--border 永远透明，不能用它画单边线。 */
  --line: rgba(255, 255, 255, 0.1);
  --line-strong: rgba(255, 255, 255, 0.2);
  --text: #ffffff;
  --text-strong: #ffffff;
  --muted: #c0c0c0;
  --dim: #adadad;
  --accent: #ffffff;
  --accent-ink: #000000;
  --accent-ink-wash: rgba(0, 0, 0, 0.1);
  --accent-soft: #ffffff;
  --accent-wash-strong: rgba(255, 255, 255, 0.65);
  --accent-wash: rgba(255, 255, 255, 0.14);
  --accent-wash-soft: rgba(255, 255, 255, 0.08);
  --accent-line: rgba(255, 255, 255, 0.45);
  --accent-line-soft: rgba(255, 255, 255, 0.28);
  --accent-glow: rgba(255, 255, 255, 0.26);
  --ok: #98b79e;
  --ok-soft: #c8dccd;
  --warn: #c9ab7c;
  --danger: #c9928d;
  /* 功能色与主题色分开：知识、文件、暂停、停止、继续各有稳定颜色。 */
  --knowledge: #a7c3c4;
  --knowledge-soft: rgba(167, 195, 196, 0.14);
  --file: #8fa8c0;
  --file-soft: rgba(143, 168, 192, 0.14);
  --pause: #c9ab7c;
  --pause-soft: rgba(201, 171, 124, 0.14);
  --pause-line: rgba(201, 171, 124, 0.32);
  --stop: #c9928d;
  --stop-soft: rgba(201, 146, 141, 0.14);
  --stop-line: rgba(201, 146, 141, 0.32);
  --resume: #98b79e;
  --resume-soft: rgba(152, 183, 158, 0.14);
  --review: #b0a5c0;
  --review-soft: rgba(176, 165, 192, 0.14);
  --input-bg: #080808;
  --overlay: rgba(0, 0, 0, 0.72);
  --shadow: 0 20rpx 50rpx rgba(0, 0, 0, 0.55);
  /* 卡片阴影分四层：贴边轮廓、顶部受光、四周光晕、下方投影。列表滚动容器
     会把超出自身宽度的阴影裁掉，只有横向也留出光晕，卡片两侧才有过渡。
     深色页面接近纯黑，黑色阴影画不出边界，所以先用 2rpx 白色描边勾出
     清晰的边缘，再用内阴影在顶部压一道受光，最后叠一层漫射光晕。 */
  --card-shadow: 0 0 0 2rpx rgba(255, 255, 255, 0.16),
    inset 0 2rpx 0 rgba(255, 255, 255, 0.06), 0 0 18rpx rgba(255, 255, 255, 0.07),
    0 12rpx 32rpx rgba(0, 0, 0, 0.55);
  --control-shadow: 0 6rpx 18rpx rgba(0, 0, 0, 0.28);
  --input-shadow: 0 4rpx 14rpx rgba(0, 0, 0, 0.3);
  --accent-gradient: linear-gradient(135deg, #ffffff, #bdbdbd);
  /* 控件尺度：按钮只允许使用这几档，避免各页面各写一套高度与圆角。 */
  --btn-h-xs: 48rpx;
  --btn-h-sm: 64rpx;
  --btn-h-md: 72rpx;
  --btn-h-lg: 80rpx;
  --btn-h-xl: 88rpx;
  --btn-font-xs: calc(21rpx * var(--font-scale));
  --btn-font-sm: calc(23rpx * var(--font-scale));
  --btn-font-md: calc(25rpx * var(--font-scale));
  --btn-font-lg: calc(27rpx * var(--font-scale));
  --btn-pad-xs: 14rpx;
  --btn-pad-sm: 20rpx;
  --btn-pad-md: 26rpx;
  --btn-pad-lg: 32rpx;
  --btn-radius-sm: 12rpx;
  --btn-radius: 16rpx;
  --btn-radius-lg: 20rpx;
  --btn-radius-pill: 999rpx;
  --btn-gap: 16rpx;
  --btn-press-scale: 0.985;
  background: var(--page);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue',
    'Microsoft YaHei', sans-serif;
  font-size: calc(28rpx * var(--font-scale));
  line-height: 1.5;
}
/* 字号只放大文字：页面根节点挂 font-large / font-xlarge，控件尺度不变。 */
.font-large {
  --font-scale: 1.12;
}
.font-xlarge {
  --font-scale: 1.25;
}
.theme-light {
  --bg: #ffffff;
  --bg-2: #f5f5f5;
  /* 浅色页面底色压到灰阶，白卡片和白弹窗才有东西可浮。 */
  --page: #f2f2f2;
  --bg-elevated: #ffffff;
  --surface-float: #ffffff;
  --surface-sheen: rgba(255, 255, 255, 0);
  --float-shadow: 0 22rpx 54rpx rgba(0, 0, 0, 0.14);
  --hover: rgba(0, 0, 0, 0.05);
  --hover-strong: rgba(0, 0, 0, 0.085);
  --bg-soft: #f5f5f5;
  --surface: #ffffff;
  --surface-2: #f5f5f5;
  --surface-3: #ebebeb;
  --border: transparent;
  --border-soft: transparent;
  /* 浅色下分隔线反过来用黑线，否则白线在白纸上什么都看不见。 */
  --line: rgba(0, 0, 0, 0.1);
  --line-strong: rgba(0, 0, 0, 0.2);
  --text: #000000;
  --text-strong: #000000;
  --muted: #5a5a5a;
  --dim: #686868;
  --accent: #000000;
  --accent-ink: #ffffff;
  --accent-ink-wash: rgba(255, 255, 255, 0.16);
  --accent-soft: #000000;
  --accent-wash-strong: rgba(0, 0, 0, 0.65);
  --accent-wash: rgba(0, 0, 0, 0.1);
  --accent-wash-soft: rgba(0, 0, 0, 0.06);
  --accent-line: rgba(0, 0, 0, 0.45);
  --accent-line-soft: rgba(0, 0, 0, 0.28);
  --accent-glow: rgba(0, 0, 0, 0.22);
  --ok: #4f7257;
  --ok-soft: #3f5c46;
  --warn: #8a6a35;
  --danger: #a15a55;
  --knowledge: #4d7474;
  --knowledge-soft: rgba(77, 116, 116, 0.1);
  --file: #4f6b85;
  --file-soft: rgba(79, 107, 133, 0.1);
  --pause: #8a6a35;
  --pause-soft: rgba(138, 106, 53, 0.1);
  --pause-line: rgba(138, 106, 53, 0.32);
  --stop: #a15a55;
  --stop-soft: rgba(161, 90, 85, 0.1);
  --stop-line: rgba(161, 90, 85, 0.32);
  --resume: #4f7257;
  --resume-soft: rgba(79, 114, 87, 0.1);
  --review: #6f6382;
  --review-soft: rgba(111, 99, 130, 0.1);
  --input-bg: #f7f7f7;
  --overlay: rgba(0, 0, 0, 0.3);
  --shadow: 0 20rpx 50rpx rgba(0, 0, 0, 0.14);
  --card-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.04), 0 0 18rpx rgba(0, 0, 0, 0.06),
    0 12rpx 30rpx rgba(0, 0, 0, 0.07);
  --control-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.05);
  --input-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.05);
  --accent-gradient: linear-gradient(135deg, #000000, #333333);
}

/* 所有卡片共用一套三层投影：会话、知识、聊天、设置、更新、配对、反馈、
   文件与进化页保持同一层级，阴影向四周伸出，不再只有正下方有投影。 */
.card,
.evo-card,
.file-row,
.hero {
  box-shadow: var(--card-shadow);
}

/* 返回按钮统一用 CSS 画长箭头。字体里的 ← 在基线上有固定偏移，换字号或
   系统字体后会和标题对不齐；固定尺寸的容器里把横线和箭头头部按 50%
   居中，整个图标就落在标题的中线上。容器本身作为点击区。

   箭头头部是 content-box：width/height 之外还要加两侧边框才是实际的
   高度，所以 margin-top 取「(边长 + 边框) / 2」的整数，不能只按 width
   的一半算。分数 rpx 在 App 端会各自取整，横线和头部就会差半个像素。 */
.back-arrow {
  position: relative;
  display: block;
  width: 36rpx;
  height: 36rpx;
  /* 汉字字形的视觉中心比行盒中心略低，图标跟着下移 1px 才和标题齐平。 */
  margin-top: 2rpx;
  color: inherit;
}
.back-arrow::before {
  content: '';
  position: absolute;
  left: 1rpx;
  top: 50%;
  width: 34rpx;
  height: 4rpx;
  margin-top: -2rpx;
  border-radius: 2rpx;
  background: currentColor;
}
.back-arrow::after {
  content: '';
  position: absolute;
  /* 头部 14rpx + 4rpx 边框 = 18rpx 的边框盒；旋转后顶点落在横线起点。 */
  left: 4rpx;
  top: 50%;
  width: 14rpx;
  height: 14rpx;
  margin-top: -9rpx;
  border-left: 4rpx solid currentColor;
  border-bottom: 4rpx solid currentColor;
  transform: rotate(45deg);
  transform-origin: center;
}

/* 主题配色与电脑端预设一致；默认 graphite 保持纯黑白，其余每套都会给
   页面、卡片、输入框和边框铺一层同色系浅底，切换后整个界面一起变。 */
.accent-pine {
  --accent: #7bc6a1;
  --accent-ink: #11221a;
  --accent-ink-wash: rgba(17, 34, 26, 0.1);
  --accent-soft: #a3dbbf;
  --accent-wash-strong: rgba(123, 198, 161, 0.65);
  --accent-wash: rgba(123, 198, 161, 0.16);
  --accent-wash-soft: rgba(123, 198, 161, 0.1);
  --accent-line: rgba(123, 198, 161, 0.5);
  --accent-line-soft: rgba(123, 198, 161, 0.32);
  --accent-glow: rgba(123, 198, 161, 0.3);
  --accent-gradient: linear-gradient(135deg, #8dc9ab, #50be87);
  --bg: #020302;
  --bg-2: #0c1511;
  --page: #030504;
  --bg-elevated: #141d19;
  --surface-float: #2c3b33;
  --bg-soft: #26352d;
  --surface: #1c2b23;
  --surface-2: #26352d;
  --surface-3: #314038;
  --border: transparent;
  --border-soft: transparent;
  --input-bg: #030504;
}
.theme-light.accent-pine {
  --accent: #317754;
  --accent-ink: #ffffff;
  --accent-ink-wash: rgba(255, 255, 255, 0.16);
  --accent-soft: #2c5e45;
  --accent-wash-strong: rgba(49, 119, 84, 0.65);
  --accent-wash: rgba(49, 119, 84, 0.12);
  --accent-wash-soft: rgba(49, 119, 84, 0.07);
  --accent-line: rgba(49, 119, 84, 0.5);
  --accent-line-soft: rgba(49, 119, 84, 0.32);
  --accent-glow: rgba(49, 119, 84, 0.24);
  --accent-gradient: linear-gradient(135deg, #3c8661, #286c4a);
  --bg: #f8faf9;
  --bg-2: #ffffff;
  --page: #f3f7f5;
  --bg-elevated: #ffffff;
  --surface-float: #ffffff;
  --bg-soft: #f8faf9;
  --surface: #ffffff;
  --surface-2: #f8faf9;
  --surface-3: #edf3f0;
  --border: transparent;
  --border-soft: transparent;
  --input-bg: #fafcfb;
}

.accent-indigo {
  --accent: #859ad6;
  --accent-ink: #111522;
  --accent-ink-wash: rgba(17, 21, 34, 0.1);
  --accent-soft: #b0bfe8;
  --accent-wash-strong: rgba(133, 154, 214, 0.65);
  --accent-wash: rgba(133, 154, 214, 0.16);
  --accent-wash-soft: rgba(133, 154, 214, 0.1);
  --accent-line: rgba(133, 154, 214, 0.5);
  --accent-line-soft: rgba(133, 154, 214, 0.32);
  --accent-glow: rgba(133, 154, 214, 0.3);
  --accent-gradient: linear-gradient(135deg, #97a8d8, #5878d0);
  --bg: #020203;
  --bg-2: #0c0e14;
  --page: #030405;
  --bg-elevated: #1c1f2c;
  --surface-float: #2c2f3c;
  --bg-soft: #262936;
  --surface: #1c1f2c;
  --surface-2: #262936;
  --surface-3: #313441;
  --border: transparent;
  --border-soft: transparent;
  --input-bg: #030405;
}
.theme-light.accent-indigo {
  --accent: #344d93;
  --accent-ink: #ffffff;
  --accent-ink-wash: rgba(255, 255, 255, 0.16);
  --accent-soft: #314477;
  --accent-wash-strong: rgba(52, 77, 147, 0.65);
  --accent-wash: rgba(52, 77, 147, 0.12);
  --accent-wash-soft: rgba(52, 77, 147, 0.07);
  --accent-line: rgba(52, 77, 147, 0.5);
  --accent-line-soft: rgba(52, 77, 147, 0.32);
  --accent-glow: rgba(52, 77, 147, 0.24);
  --accent-gradient: linear-gradient(135deg, #3f59a2, #2b4488);
  --bg: #f8f9fb;
  --bg-2: #ffffff;
  --page: #f3f4f9;
  --bg-elevated: #ffffff;
  --surface-float: #ffffff;
  --bg-soft: #f8f9fb;
  --surface: #ffffff;
  --surface-2: #f8f9fb;
  --surface-3: #eef0f6;
  --border: transparent;
  --border-soft: transparent;
  --input-bg: #fafbfc;
}

.accent-clay {
  --accent: #d19c75;
  --accent-ink: #221811;
  --accent-ink-wash: rgba(34, 24, 17, 0.1);
  --accent-soft: #e3bca1;
  --accent-wash-strong: rgba(209, 156, 117, 0.65);
  --accent-wash: rgba(209, 156, 117, 0.16);
  --accent-wash-soft: rgba(209, 156, 117, 0.1);
  --accent-line: rgba(209, 156, 117, 0.5);
  --accent-line-soft: rgba(209, 156, 117, 0.32);
  --accent-glow: rgba(209, 156, 117, 0.3);
  --accent-gradient: linear-gradient(135deg, #d3a788, #cb7f48);
  --bg: #030202;
  --bg-2: #150f0a;
  --page: #050403;
  --bg-elevated: #241c16;
  --surface-float: #342c26;
  --bg-soft: #2e2620;
  --surface: #241c16;
  --surface-2: #2e2620;
  --surface-3: #39312b;
  --border: transparent;
  --border-soft: transparent;
  --input-bg: #050403;
}
.theme-light.accent-clay {
  --accent: #8f5932;
  --accent-ink: #ffffff;
  --accent-ink-wash: rgba(255, 255, 255, 0.16);
  --accent-soft: #744c2f;
  --accent-wash-strong: rgba(143, 89, 50, 0.65);
  --accent-wash: rgba(143, 89, 50, 0.12);
  --accent-wash-soft: rgba(143, 89, 50, 0.07);
  --accent-line: rgba(143, 89, 50, 0.5);
  --accent-line-soft: rgba(143, 89, 50, 0.32);
  --accent-glow: rgba(143, 89, 50, 0.24);
  --accent-gradient: linear-gradient(135deg, #9e663d, #844f2a);
  --bg: #fbf9f8;
  --bg-2: #ffffff;
  --page: #f8f5f3;
  --bg-elevated: #ffffff;
  --surface-float: #ffffff;
  --bg-soft: #fbf9f8;
  --surface: #ffffff;
  --surface-2: #fbf9f8;
  --surface-3: #f5f1ee;
  --border: transparent;
  --border-soft: transparent;
  --input-bg: #fcfbfa;
}

.accent-ocean {
  --accent: #66b3d6;
  --accent-ink: #111d22;
  --accent-ink-wash: rgba(17, 29, 34, 0.1);
  --accent-soft: #95cbe4;
  --accent-wash-strong: rgba(102, 179, 214, 0.65);
  --accent-wash: rgba(102, 179, 214, 0.16);
  --accent-wash-soft: rgba(102, 179, 214, 0.1);
  --accent-line: rgba(102, 179, 214, 0.5);
  --accent-line-soft: rgba(102, 179, 214, 0.32);
  --accent-glow: rgba(102, 179, 214, 0.3);
  --accent-gradient: linear-gradient(135deg, #79b9d7, #39a0d0);
  --bg: #020303;
  --bg-2: #0a1417;
  --page: #030405;
  --bg-elevated: #1a282d;
  --surface-float: #2a383d;
  --bg-soft: #243237;
  --surface: #1a282d;
  --surface-2: #243237;
  --surface-3: #2f3d42;
  --border: transparent;
  --border-soft: transparent;
  --input-bg: #030405;
}
.theme-light.accent-ocean {
  --accent: #206788;
  --accent-ink: #ffffff;
  --accent-ink-wash: rgba(255, 255, 255, 0.16);
  --accent-soft: #1e536b;
  --accent-wash-strong: rgba(32, 103, 136, 0.65);
  --accent-wash: rgba(32, 103, 136, 0.12);
  --accent-wash-soft: rgba(32, 103, 136, 0.07);
  --accent-line: rgba(32, 103, 136, 0.5);
  --accent-line-soft: rgba(32, 103, 136, 0.32);
  --accent-glow: rgba(32, 103, 136, 0.24);
  --accent-gradient: linear-gradient(135deg, #297699, #1c5b78);
  --bg: #f7fafb;
  --bg-2: #ffffff;
  --page: #f2f6f8;
  --bg-elevated: #ffffff;
  --surface-float: #ffffff;
  --bg-soft: #f7fafb;
  --surface: #ffffff;
  --surface-2: #f7fafb;
  --surface-3: #ecf2f5;
  --border: transparent;
  --border-soft: transparent;
  --input-bg: #f9fbfc;
}

.accent-moss {
  --accent: #a6ca68;
  --accent-ink: #1c2211;
  --accent-ink-wash: rgba(28, 34, 17, 0.1);
  --accent-soft: #c2dd92;
  --accent-wash-strong: rgba(166, 202, 104, 0.65);
  --accent-wash: rgba(166, 202, 104, 0.16);
  --accent-wash-soft: rgba(166, 202, 104, 0.1);
  --accent-line: rgba(166, 202, 104, 0.5);
  --accent-line-soft: rgba(166, 202, 104, 0.32);
  --accent-glow: rgba(166, 202, 104, 0.3);
  --accent-gradient: linear-gradient(135deg, #aecc7b, #92c43b);
  --bg: #020302;
  --bg-2: #101409;
  --page: #040503;
  --bg-elevated: #202718;
  --surface-float: #303728;
  --bg-soft: #2a3122;
  --surface: #202718;
  --surface-2: #2a3122;
  --surface-3: #353c2d;
  --border: transparent;
  --border-soft: transparent;
  --input-bg: #040503;
}
.theme-light.accent-moss {
  --accent: #597529;
  --accent-ink: #ffffff;
  --accent-ink-wash: rgba(255, 255, 255, 0.16);
  --accent-soft: #475b25;
  --accent-wash-strong: rgba(89, 117, 41, 0.65);
  --accent-wash: rgba(89, 117, 41, 0.12);
  --accent-wash-soft: rgba(89, 117, 41, 0.07);
  --accent-line: rgba(89, 117, 41, 0.5);
  --accent-line-soft: rgba(89, 117, 41, 0.32);
  --accent-glow: rgba(89, 117, 41, 0.24);
  --accent-gradient: linear-gradient(135deg, #678433, #4e6921);
  --bg: #f9faf8;
  --bg-2: #ffffff;
  --page: #f5f7f2;
  --bg-elevated: #ffffff;
  --surface-float: #ffffff;
  --bg-soft: #f9faf8;
  --surface: #ffffff;
  --surface-2: #f9faf8;
  --surface-3: #f1f3ed;
  --border: transparent;
  --border-soft: transparent;
  --input-bg: #fbfcfa;
}

.accent-plum {
  --accent: #b289d2;
  --accent-ink: #1b1122;
  --accent-ink-wash: rgba(27, 17, 34, 0.1);
  --accent-soft: #cfb3e5;
  --accent-wash-strong: rgba(178, 137, 210, 0.65);
  --accent-wash: rgba(178, 137, 210, 0.16);
  --accent-wash-soft: rgba(178, 137, 210, 0.1);
  --accent-line: rgba(178, 137, 210, 0.5);
  --accent-line-soft: rgba(178, 137, 210, 0.32);
  --accent-glow: rgba(178, 137, 210, 0.3);
  --accent-gradient: linear-gradient(135deg, #bc9ad5, #9b5dcb);
  --bg: #030203;
  --bg-2: #141017;
  --page: #040305;
  --bg-elevated: #241e2a;
  --surface-float: #342e3a;
  --bg-soft: #2e2834;
  --surface: #241e2a;
  --surface-2: #2e2834;
  --surface-3: #39333f;
  --border: transparent;
  --border-soft: transparent;
  --input-bg: #040305;
}
.theme-light.accent-plum {
  --accent: #76469b;
  --accent-ink: #ffffff;
  --accent-ink-wash: rgba(255, 255, 255, 0.16);
  --accent-soft: #654280;
  --accent-wash-strong: rgba(118, 70, 155, 0.65);
  --accent-wash: rgba(118, 70, 155, 0.12);
  --accent-wash-soft: rgba(118, 70, 155, 0.07);
  --accent-line: rgba(118, 70, 155, 0.5);
  --accent-line-soft: rgba(118, 70, 155, 0.32);
  --accent-glow: rgba(118, 70, 155, 0.24);
  --accent-gradient: linear-gradient(135deg, #8352a7, #6c3b91);
  --bg: #faf9fc;
  --bg-2: #ffffff;
  --page: #f7f4f9;
  --bg-elevated: #ffffff;
  --surface-float: #ffffff;
  --bg-soft: #faf9fc;
  --surface: #ffffff;
  --surface-2: #faf9fc;
  --surface-3: #f3eff7;
  --border: transparent;
  --border-soft: transparent;
  --input-bg: #fcfafd;
}

.accent-rose {
  --accent: #dd889c;
  --accent-ink: #221115;
  --accent-ink-wash: rgba(34, 17, 21, 0.1);
  --accent-soft: #edb6c2;
  --accent-wash-strong: rgba(221, 136, 156, 0.65);
  --accent-wash: rgba(221, 136, 156, 0.16);
  --accent-wash-soft: rgba(221, 136, 156, 0.1);
  --accent-line: rgba(221, 136, 156, 0.5);
  --accent-line-soft: rgba(221, 136, 156, 0.32);
  --accent-glow: rgba(221, 136, 156, 0.3);
  --accent-gradient: linear-gradient(135deg, #df9aaa, #d85a77);
  --bg: #030202;
  --bg-2: #1a1013;
  --page: #060304;
  --bg-elevated: #2a1d22;
  --surface-float: #3a2d32;
  --bg-soft: #34272c;
  --surface: #2a1d22;
  --surface-2: #34272c;
  --surface-3: #3f3237;
  --border: transparent;
  --border-soft: transparent;
  --input-bg: #060304;
}
.theme-light.accent-rose {
  --accent: #9f3c53;
  --accent-ink: #ffffff;
  --accent-ink-wash: rgba(255, 255, 255, 0.16);
  --accent-soft: #833a4b;
  --accent-wash-strong: rgba(159, 60, 83, 0.65);
  --accent-wash: rgba(159, 60, 83, 0.12);
  --accent-wash-soft: rgba(159, 60, 83, 0.07);
  --accent-line: rgba(159, 60, 83, 0.5);
  --accent-line-soft: rgba(159, 60, 83, 0.32);
  --accent-glow: rgba(159, 60, 83, 0.24);
  --accent-gradient: linear-gradient(135deg, #ad4860, #943349);
  --bg: #fcf8f9;
  --bg-2: #ffffff;
  --page: #f9f3f5;
  --bg-elevated: #ffffff;
  --surface-float: #ffffff;
  --bg-soft: #fcf8f9;
  --surface: #ffffff;
  --surface-2: #fcf8f9;
  --surface-3: #f7eef0;
  --border: transparent;
  --border-soft: transparent;
  --input-bg: #fdfafb;
}

.accent-sand {
  --accent: #d6b471;
  --accent-ink: #221c11;
  --accent-ink-wash: rgba(34, 28, 17, 0.1);
  --accent-soft: #e6ce9e;
  --accent-wash-strong: rgba(214, 180, 113, 0.65);
  --accent-wash: rgba(214, 180, 113, 0.16);
  --accent-wash-soft: rgba(214, 180, 113, 0.1);
  --accent-line: rgba(214, 180, 113, 0.5);
  --accent-line-soft: rgba(214, 180, 113, 0.32);
  --accent-glow: rgba(214, 180, 113, 0.3);
  --accent-gradient: linear-gradient(135deg, #d7bb84, #d1a242);
  --bg: #030302;
  --bg-2: #16120b;
  --page: #050503;
  --bg-elevated: #262118;
  --surface-float: #363128;
  --bg-soft: #302b22;
  --surface: #262118;
  --surface-2: #302b22;
  --surface-3: #3b362d;
  --border: transparent;
  --border-soft: transparent;
  --input-bg: #050503;
}
.theme-light.accent-sand {
  --accent: #816122;
  --accent-ink: #ffffff;
  --accent-ink-wash: rgba(255, 255, 255, 0.16);
  --accent-soft: #654e20;
  --accent-wash-strong: rgba(129, 97, 34, 0.65);
  --accent-wash: rgba(129, 97, 34, 0.12);
  --accent-wash-soft: rgba(129, 97, 34, 0.07);
  --accent-line: rgba(129, 97, 34, 0.5);
  --accent-line-soft: rgba(129, 97, 34, 0.32);
  --accent-glow: rgba(129, 97, 34, 0.24);
  --accent-gradient: linear-gradient(135deg, #916f2b, #74561b);
  --bg: #fbf9f7;
  --bg-2: #ffffff;
  --page: #f7f6f2;
  --bg-elevated: #ffffff;
  --surface-float: #ffffff;
  --bg-soft: #fbf9f7;
  --surface: #ffffff;
  --surface-2: #fbf9f7;
  --surface-3: #f4f2ec;
  --border: transparent;
  --border-soft: transparent;
  --input-bg: #fcfbf9;
}

.accent-orange {
  --accent: #f2a06a;
  --accent-ink: #221208;
  --accent-ink-wash: rgba(34, 18, 8, 0.1);
  --accent-soft: #f7bb8d;
  --accent-wash-strong: rgba(242, 160, 106, 0.65);
  --accent-wash: rgba(242, 160, 106, 0.16);
  --accent-wash-soft: rgba(242, 160, 106, 0.1);
  --accent-line: rgba(242, 160, 106, 0.5);
  --accent-line-soft: rgba(242, 160, 106, 0.32);
  --accent-glow: rgba(242, 160, 106, 0.3);
  --accent-gradient: linear-gradient(135deg, #f7b07d, #df7a41);
  --bg: #050301;
  --bg-2: #161009;
  --page: #080502;
  --bg-elevated: #221810;
  --surface-float: #32251a;
  --bg-soft: #2a1f15;
  --surface: #221810;
  --surface-2: #2a1f15;
  --surface-3: #37281b;
  --border: transparent;
  --border-soft: transparent;
  --input-bg: #080502;
}
.theme-light.accent-orange {
  --accent: #b2570f;
  --accent-ink: #ffffff;
  --accent-ink-wash: rgba(255, 255, 255, 0.16);
  --accent-soft: #c06318;
  --accent-wash-strong: rgba(178, 87, 15, 0.65);
  --accent-wash: rgba(178, 87, 15, 0.12);
  --accent-wash-soft: rgba(178, 87, 15, 0.07);
  --accent-line: rgba(178, 87, 15, 0.5);
  --accent-line-soft: rgba(178, 87, 15, 0.32);
  --accent-glow: rgba(178, 87, 15, 0.24);
  --accent-gradient: linear-gradient(135deg, #c4691f, #9b470a);
  --bg: #fdf8f2;
  --bg-2: #ffffff;
  --page: #f8f1e8;
  --bg-elevated: #ffffff;
  --surface-float: #ffffff;
  --bg-soft: #fdf8f2;
  --surface: #ffffff;
  --surface-2: #fdf8f2;
  --surface-3: #f6ebe0;
  --border: transparent;
  --border-soft: transparent;
  --input-bg: #fffcf8;
}

.accent-celadon {
  --accent: #5ec8c0;
  --accent-ink: #0f2424;
  --accent-ink-wash: rgba(15, 36, 36, 0.1);
  --accent-soft: #8fded7;
  --accent-wash-strong: rgba(94, 200, 192, 0.65);
  --accent-wash: rgba(94, 200, 192, 0.16);
  --accent-wash-soft: rgba(94, 200, 192, 0.1);
  --accent-line: rgba(94, 200, 192, 0.5);
  --accent-line-soft: rgba(94, 200, 192, 0.32);
  --accent-glow: rgba(94, 200, 192, 0.3);
  --accent-gradient: linear-gradient(135deg, #74d2cb, #3cb5ad);
  --bg: #020303;
  --bg-2: #0a1312;
  --page: #030404;
  --bg-elevated: #172522;
  --surface-float: #273733;
  --bg-soft: #21302d;
  --surface: #172522;
  --surface-2: #21302d;
  --surface-3: #2c3b38;
  --border: transparent;
  --border-soft: transparent;
  --input-bg: #030404;
}
.theme-light.accent-celadon {
  --accent: #2c7671;
  --accent-ink: #ffffff;
  --accent-ink-wash: rgba(255, 255, 255, 0.16);
  --accent-soft: #265f5b;
  --accent-wash-strong: rgba(44, 118, 113, 0.65);
  --accent-wash: rgba(44, 118, 113, 0.12);
  --accent-wash-soft: rgba(44, 118, 113, 0.07);
  --accent-line: rgba(44, 118, 113, 0.5);
  --accent-line-soft: rgba(44, 118, 113, 0.32);
  --accent-glow: rgba(44, 118, 113, 0.24);
  --accent-gradient: linear-gradient(135deg, #34847e, #26645f);
  --bg: #f7fbfa;
  --bg-2: #ffffff;
  --page: #f1f7f5;
  --bg-elevated: #ffffff;
  --surface-float: #ffffff;
  --bg-soft: #f7fbfa;
  --surface: #ffffff;
  --surface-2: #f7fbfa;
  --surface-3: #e9f2ef;
  --border: transparent;
  --border-soft: transparent;
  --input-bg: #f9fcfb;
}

/* 暖白是暖色基准：米白/暖灰整套底色 + 陶橙强调色，与桌面端一致。
   其它主题也按各自强调色铺浅底，只是色相不同。 */
.accent-claude {
  --bg: #1f1e1d;
  --bg-2: #191817;
  --page: #1b1a19;
  --bg-elevated: #31302d;
  --surface-float: #444340;
  --float-shadow: 0 24rpx 60rpx rgba(0, 0, 0, 0.55);
  --hover: rgba(245, 244, 239, 0.07);
  --hover-strong: rgba(245, 244, 239, 0.11);
  --bg-soft: #3e3d3a;
  --surface: #343330;
  --surface-2: #3e3d3a;
  --surface-3: #494845;
  --border: transparent;
  --border-soft: transparent;
  --text: #f5f4ef;
  --text-strong: #f5f4ef;
  --muted: #ccc7bd;
  --dim: #c4bfb5;
  --accent: #d97757;
  --accent-ink: #201713;
  --accent-ink-wash: rgba(32, 23, 19, 0.1);
  --accent-soft: #e38e71;
  --accent-wash-strong: rgba(217, 119, 87, 0.65);
  --accent-wash: rgba(217, 119, 87, 0.14);
  --accent-wash-soft: rgba(217, 119, 87, 0.08);
  --accent-line: rgba(217, 119, 87, 0.45);
  --accent-line-soft: rgba(217, 119, 87, 0.28);
  --accent-glow: rgba(217, 119, 87, 0.26);
  --input-bg: #191817;
  --accent-gradient: linear-gradient(135deg, #e08a6b, #c15f3c);
  /* Claude 深色底色不是纯黑，投影保持黑色，四周补一圈白色微光。 */
  --card-shadow: 0 0 0 2rpx rgba(255, 255, 255, 0.13),
    inset 0 2rpx 0 rgba(255, 255, 255, 0.05), 0 0 18rpx rgba(255, 255, 255, 0.06),
    0 12rpx 32rpx rgba(0, 0, 0, 0.5);
}
.theme-light.accent-claude {
  --bg: #faf9f5;
  --bg-2: #f2efe7;
  --page: #f1efe7;
  --bg-elevated: #ffffff;
  --surface-float: #ffffff;
  --float-shadow: 0 22rpx 54rpx rgba(80, 65, 50, 0.16);
  --hover: rgba(31, 30, 29, 0.055);
  --hover-strong: rgba(31, 30, 29, 0.09);
  --bg-soft: #f5f2ea;
  --surface: #ffffff;
  --surface-2: #f5f2ea;
  --surface-3: #ece8de;
  --border: transparent;
  --border-soft: transparent;
  --text: #1f1e1d;
  --text-strong: #1f1e1d;
  --muted: #615d55;
  --dim: #6a665e;
  --accent: #b4532f;
  --accent-ink: #ffffff;
  --accent-ink-wash: rgba(255, 255, 255, 0.16);
  --accent-soft: #a94e2f;
  --accent-wash-strong: rgba(193, 95, 60, 0.65);
  --accent-wash: rgba(193, 95, 60, 0.1);
  --accent-wash-soft: rgba(193, 95, 60, 0.06);
  --accent-line: rgba(193, 95, 60, 0.45);
  --accent-line-soft: rgba(193, 95, 60, 0.28);
  --accent-glow: rgba(193, 95, 60, 0.22);
  --input-bg: #f5f2ea;
  --accent-gradient: linear-gradient(135deg, #c15f3c, #a94e2f);
  /* 米白底上用暖灰阴影，和 Claude 的暖色面板保持一致。 */
  --card-shadow: 0 2rpx 8rpx rgba(80, 65, 50, 0.05), 0 0 18rpx rgba(80, 65, 50, 0.07),
    0 12rpx 30rpx rgba(80, 65, 50, 0.09);
}
/*
 * 按钮配色方案。页面根节点同时带 accent-* 与 btn-scheme-*，
 * 颜色 token 必须声明在页面这一层，才能在浅色/主题色覆盖之后解析。
 */
.btn-scheme-accent {
  --btn-primary-bg: var(--accent-gradient);
  --btn-primary-fg: var(--accent-ink);
  --btn-primary-border: 1rpx solid transparent;
  --btn-primary-shadow: 0 10rpx 24rpx var(--accent-glow);
  --btn-secondary-bg: var(--surface-3);
  --btn-secondary-fg: var(--text);
  --btn-secondary-border: 1rpx solid transparent;
  --btn-soft-bg: var(--accent-wash);
  --btn-soft-fg: var(--accent-soft);
  --btn-soft-border: 1rpx solid transparent;
  --btn-danger-bg: var(--stop-soft);
  --btn-danger-fg: var(--stop);
  --btn-danger-border: 1rpx solid transparent;
  --btn-danger-shadow: none;
  --btn-danger-strong-bg: linear-gradient(135deg, #c9928d, #a15a55);
  --btn-danger-strong-fg: #ffffff;
  --btn-danger-strong-border: 1rpx solid transparent;
  --btn-danger-strong-shadow: 0 10rpx 28rpx rgba(161, 90, 85, 0.24);
}
.btn-scheme-mono {
  --btn-primary-bg: var(--text-strong);
  --btn-primary-fg: var(--bg);
  --btn-primary-border: 1rpx solid transparent;
  --btn-primary-shadow: none;
  --btn-secondary-bg: var(--surface-3);
  --btn-secondary-fg: var(--text);
  --btn-secondary-border: 1rpx solid transparent;
  --btn-soft-bg: var(--surface-2);
  --btn-soft-fg: var(--muted);
  --btn-soft-border: 1rpx solid transparent;
  --btn-danger-bg: var(--stop-soft);
  --btn-danger-fg: var(--stop);
  --btn-danger-border: 1rpx solid transparent;
  --btn-danger-shadow: none;
  --btn-danger-strong-bg: var(--stop);
  --btn-danger-strong-fg: var(--bg);
  --btn-danger-strong-border: 1rpx solid transparent;
  --btn-danger-strong-shadow: none;
}
.btn-scheme-soft {
  --btn-primary-bg: var(--accent-wash);
  --btn-primary-fg: var(--accent-soft);
  --btn-primary-border: 1rpx solid transparent;
  --btn-primary-shadow: none;
  --btn-secondary-bg: var(--surface-2);
  --btn-secondary-fg: var(--text);
  --btn-secondary-border: 1rpx solid transparent;
  --btn-soft-bg: var(--accent-wash-soft);
  --btn-soft-fg: var(--accent-soft);
  --btn-soft-border: 1rpx solid transparent;
  --btn-danger-bg: var(--stop-soft);
  --btn-danger-fg: var(--stop);
  --btn-danger-border: 1rpx solid transparent;
  --btn-danger-shadow: none;
  --btn-danger-strong-bg: var(--stop-soft);
  --btn-danger-strong-fg: var(--stop);
  --btn-danger-strong-border: 1rpx solid transparent;
  --btn-danger-strong-shadow: none;
}
/*
 * 分层填充：沿用 outline 这个已持久化的 id，但不再画线框。主按钮和次按钮
 * 各用一级底色，层级靠 surface-2 / surface-3 的色差表达。
 */
.btn-scheme-outline {
  --btn-primary-bg: var(--surface-3);
  --btn-primary-fg: var(--text-strong);
  --btn-primary-border: 1rpx solid transparent;
  --btn-primary-shadow: none;
  --btn-secondary-bg: var(--surface-2);
  --btn-secondary-fg: var(--text);
  --btn-secondary-border: 1rpx solid transparent;
  --btn-soft-bg: var(--accent-wash-soft);
  --btn-soft-fg: var(--accent-soft);
  --btn-soft-border: 1rpx solid transparent;
  --btn-danger-bg: var(--stop-soft);
  --btn-danger-fg: var(--danger);
  --btn-danger-border: 1rpx solid transparent;
  --btn-danger-shadow: none;
  --btn-danger-strong-bg: var(--stop-soft);
  --btn-danger-strong-fg: var(--danger);
  --btn-danger-strong-border: 1rpx solid transparent;
  --btn-danger-strong-shadow: none;
}

.page {
  min-height: 100vh;
  /* 页面画布统一用 --page：浅色下灰底才能从列表两侧的通栏缝隙里透出来，
     深色下也保持纯黑画布，让卡片自己抬层级。 */
  background: var(--page);
  color: var(--text);
  box-sizing: border-box;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: var(--btn-h-lg);
  margin: 0;
  padding: 0 var(--btn-pad-lg);
  border: 1rpx solid transparent;
  border-radius: var(--btn-radius);
  background: transparent;
  color: var(--text);
  font-size: var(--btn-font-lg);
  font-weight: 600;
  line-height: 1.2;
  text-align: center;
}
/* uni-app 原生按钮默认带描边（H5/App 由 button::after 绘制），统一去掉所有按钮边线。 */
button,
button::after {
  border: none;
}
.btn.primary {
  background: var(--btn-primary-bg, var(--accent-gradient));
  color: var(--btn-primary-fg, var(--accent-ink, #000000));
  border: var(--btn-primary-border, 1rpx solid transparent);
  box-shadow: var(--btn-primary-shadow, 0 10rpx 24rpx var(--accent-glow));
}
.btn.ghost {
  background: var(--btn-secondary-bg, var(--surface-3));
  color: var(--btn-secondary-fg, var(--text));
  border: var(--btn-secondary-border, 1rpx solid transparent);
  box-shadow: none;
}
.btn.soft {
  background: var(--btn-soft-bg, var(--accent-wash));
  color: var(--btn-soft-fg, var(--accent-soft));
  border: var(--btn-soft-border, 1rpx solid transparent);
  box-shadow: none;
}
.btn.danger {
  background: var(--btn-danger-bg, var(--stop-soft));
  color: var(--btn-danger-fg, var(--stop));
  border: var(--btn-danger-border, 1rpx solid transparent);
  box-shadow: var(--btn-danger-shadow, none);
}
.btn.danger-strong {
  background: var(--btn-danger-strong-bg, linear-gradient(135deg, #c9928d, #a15a55));
  color: var(--btn-danger-strong-fg, #ffffff);
  border: var(--btn-danger-strong-border, 1rpx solid transparent);
  box-shadow: var(--btn-danger-strong-shadow, none);
}
.btn.small-btn {
  height: var(--btn-h-md);
  padding: 0 var(--btn-pad-md);
  border-radius: var(--btn-radius-sm);
  font-size: var(--btn-font-md);
}
.btn.block {
  width: 100%;
}
.btn.primary[disabled],
.btn.ghost[disabled],
.btn.soft[disabled],
.btn.danger[disabled] {
  background: var(--surface-3);
  color: var(--dim);
  border-color: transparent;
  box-shadow: none;
}
.btn:active:not([disabled]) {
  transform: scale(var(--btn-press-scale));
}
/*
 * 触屏用 :active 就够；带鼠标的环境（H5 / 桌面浏览器）再补一层 hover，
 * 让所有可点控件都有可见反馈。标签类元素不在这个选择器里，保持纯展示。
 */
@media (hover: hover) and (pointer: fine) {
  .btn:not([disabled]):hover,
  .chip:not([disabled]):hover,
  .text-btn:not([disabled]):hover,
  button:not([disabled]):hover {
    filter: brightness(1.06);
  }
  .theme-light .btn:not([disabled]):hover,
  .theme-light .chip:not([disabled]):hover,
  .theme-light .text-btn:not([disabled]):hover,
  .theme-light button:not([disabled]):hover {
    filter: brightness(0.96);
  }
}
/* 胶囊标签按钮：知识、文件、暂停、停止、设备操作等密集操作统一用这一档。 */
.chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: var(--btn-h-xs);
  padding: 0 var(--btn-pad-xs);
  border: 1rpx solid transparent;
  border-radius: var(--btn-radius-pill);
  font-size: var(--btn-font-sm);
  line-height: 1.2;
  flex-shrink: 0;
}
.chip:active {
  transform: scale(var(--btn-press-scale));
}
/* 文字按钮：不抢主按钮的视觉层级，只保留强调色与足够的热区。 */
.text-btn {
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  min-height: var(--btn-h-xs);
  padding: 0 8rpx;
  color: var(--accent-soft);
  font-size: var(--btn-font-sm);
  line-height: 1.2;
}
.text-btn.danger {
  color: var(--btn-danger-fg, var(--stop));
}
.text-btn:active {
  opacity: 0.7;
}
button[disabled] {
  /* uni-app 自带的 uni-button[disabled]:not([type]) 选择器权重更高，这里必须用 !important 覆盖。 */
  background: var(--surface-3) !important;
  color: var(--dim) !important;
  box-shadow: none !important;
}
.muted {
  color: var(--muted);
  font-size: calc(24rpx * var(--font-scale));
  line-height: 1.55;
}

/* 对比度与饱和度（手机端）（由 pilot/scripts/gen-appearance-css.mjs 生成，勿手改） */
/* appearance:begin */
.contrast-standard {
  --bg: #050505;
  --bg-2: #0f0f0f;
  --page: #050505;
  --bg-elevated: #171717;
  --surface-float: #2e2e2e;
  --bg-soft: #282828;
  --surface: #1f1f1f;
  --surface-2: #282828;
  --surface-3: #333333;
  --input-bg: #0d0d0d;
  --text: #ededed;
  --text-strong: #ededed;
  --muted: #bababa;
  --dim: #adadad;
  --line: rgba(255, 255, 255, 0.1);
  --line-strong: rgba(255, 255, 255, 0.2);
}

.theme-light.contrast-standard {
  --bg: #fbfbfb;
  --bg-2: #f1f1f1;
  --page: #eeeeee;
  --bg-elevated: #fbfbfb;
  --surface-float: #fbfbfb;
  --bg-soft: #f1f1f1;
  --surface: #fbfbfb;
  --surface-2: #f1f1f1;
  --surface-3: #e7e7e7;
  --input-bg: #f3f3f3;
  --text: #141414;
  --text-strong: #141414;
  --muted: #5f5f5f;
  --dim: #686868;
  --line: rgba(0, 0, 0, 0.1);
  --line-strong: rgba(0, 0, 0, 0.2);
}

.contrast-standard.accent-pine {
  --bg: #060906;
  --bg-2: #0f1b16;
  --page: #070b09;
  --bg-elevated: #18221e;
  --surface-float: #2f4037;
  --bg-soft: #293a31;
  --surface: #1f3027;
  --surface-2: #293a31;
  --surface-3: #34443c;
  --input-bg: #070b09;
  --text: #ededed;
  --text-strong: #ededed;
  --muted: #bababa;
  --dim: #adadad;
  --line: rgba(255, 255, 255, 0.1);
  --line-strong: rgba(255, 255, 255, 0.2);
}

.theme-light.contrast-standard.accent-pine {
  --bg: #f4f7f5;
  --bg-2: #fbfbfb;
  --page: #eff4f1;
  --bg-elevated: #fbfbfb;
  --surface-float: #fbfbfb;
  --bg-soft: #f4f7f5;
  --surface: #fbfbfb;
  --surface-2: #f4f7f5;
  --surface-3: #e9f0ec;
  --input-bg: #f5f9f7;
  --text: #141414;
  --text-strong: #141414;
  --muted: #5f5f5f;
  --dim: #686868;
  --line: rgba(0, 0, 0, 0.1);
  --line-strong: rgba(0, 0, 0, 0.2);
}

.contrast-standard.accent-indigo {
  --bg: #060609;
  --bg-2: #10121a;
  --page: #07090b;
  --bg-elevated: #1f2331;
  --surface-float: #2f3341;
  --bg-soft: #292d3b;
  --surface: #1f2331;
  --surface-2: #292d3b;
  --surface-3: #343846;
  --input-bg: #07090b;
  --text: #ededed;
  --text-strong: #ededed;
  --muted: #bababa;
  --dim: #adadad;
  --line: rgba(255, 255, 255, 0.1);
  --line-strong: rgba(255, 255, 255, 0.2);
}

.theme-light.contrast-standard.accent-indigo {
  --bg: #f3f5f8;
  --bg-2: #fbfbfb;
  --page: #eeeff7;
  --bg-elevated: #fbfbfb;
  --surface-float: #fbfbfb;
  --bg-soft: #f3f5f8;
  --surface: #fbfbfb;
  --surface-2: #f3f5f8;
  --surface-3: #e9ecf3;
  --input-bg: #f5f7f9;
  --text: #141414;
  --text-strong: #141414;
  --muted: #5f5f5f;
  --dim: #686868;
  --line: rgba(0, 0, 0, 0.1);
  --line-strong: rgba(0, 0, 0, 0.2);
}

.contrast-standard.accent-clay {
  --bg: #090606;
  --bg-2: #1b140d;
  --page: #0b0907;
  --bg-elevated: #2a2019;
  --surface-float: #39302a;
  --bg-soft: #332a24;
  --surface: #2a2019;
  --surface-2: #332a24;
  --surface-3: #3e352f;
  --input-bg: #0b0907;
  --text: #ededed;
  --text-strong: #ededed;
  --muted: #bababa;
  --dim: #adadad;
  --line: rgba(255, 255, 255, 0.1);
  --line-strong: rgba(255, 255, 255, 0.2);
}

.theme-light.contrast-standard.accent-clay {
  --bg: #f8f5f3;
  --bg-2: #fbfbfb;
  --page: #f5f1ee;
  --bg-elevated: #fbfbfb;
  --surface-float: #fbfbfb;
  --bg-soft: #f8f5f3;
  --surface: #fbfbfb;
  --surface-2: #f8f5f3;
  --surface-3: #f2ede9;
  --input-bg: #f9f7f5;
  --text: #141414;
  --text-strong: #141414;
  --muted: #5f5f5f;
  --dim: #686868;
  --line: rgba(0, 0, 0, 0.1);
  --line-strong: rgba(0, 0, 0, 0.2);
}

.contrast-standard.accent-ocean {
  --bg: #060909;
  --bg-2: #0d1a1e;
  --page: #07090b;
  --bg-elevated: #1d2d33;
  --surface-float: #2d3c42;
  --bg-soft: #27373c;
  --surface: #1d2d33;
  --surface-2: #27373c;
  --surface-3: #324147;
  --input-bg: #07090b;
  --text: #ededed;
  --text-strong: #ededed;
  --muted: #bababa;
  --dim: #adadad;
  --line: rgba(255, 255, 255, 0.1);
  --line-strong: rgba(255, 255, 255, 0.2);
}

.theme-light.contrast-standard.accent-ocean {
  --bg: #f2f7f9;
  --bg-2: #fbfbfb;
  --page: #edf3f5;
  --bg-elevated: #fbfbfb;
  --surface-float: #fbfbfb;
  --bg-soft: #f2f7f9;
  --surface: #fbfbfb;
  --surface-2: #f2f7f9;
  --surface-3: #e7eff3;
  --input-bg: #f4f8f9;
  --text: #141414;
  --text-strong: #141414;
  --muted: #5f5f5f;
  --dim: #686868;
  --line: rgba(0, 0, 0, 0.1);
  --line-strong: rgba(0, 0, 0, 0.2);
}

.contrast-standard.accent-moss {
  --bg: #060906;
  --bg-2: #151b0c;
  --page: #090b07;
  --bg-elevated: #252d1b;
  --surface-float: #343c2b;
  --bg-soft: #2e3625;
  --surface: #252d1b;
  --surface-2: #2e3625;
  --surface-3: #394130;
  --input-bg: #090b07;
  --text: #ededed;
  --text-strong: #ededed;
  --muted: #bababa;
  --dim: #adadad;
  --line: rgba(255, 255, 255, 0.1);
  --line-strong: rgba(255, 255, 255, 0.2);
}

.theme-light.contrast-standard.accent-moss {
  --bg: #f5f7f4;
  --bg-2: #fbfbfb;
  --page: #f2f4ed;
  --bg-elevated: #fbfbfb;
  --surface-float: #fbfbfb;
  --bg-soft: #f5f7f4;
  --surface: #fbfbfb;
  --surface-2: #f5f7f4;
  --surface-3: #eef0e9;
  --input-bg: #f7f9f5;
  --text: #141414;
  --text-strong: #141414;
  --muted: #5f5f5f;
  --dim: #686868;
  --line: rgba(0, 0, 0, 0.1);
  --line-strong: rgba(0, 0, 0, 0.2);
}

.contrast-standard.accent-plum {
  --bg: #090609;
  --bg-2: #19141d;
  --page: #09070b;
  --bg-elevated: #28222f;
  --surface-float: #38323f;
  --bg-soft: #322c39;
  --surface: #28222f;
  --surface-2: #322c39;
  --surface-3: #3d3743;
  --input-bg: #09070b;
  --text: #ededed;
  --text-strong: #ededed;
  --muted: #bababa;
  --dim: #adadad;
  --line: rgba(255, 255, 255, 0.1);
  --line-strong: rgba(255, 255, 255, 0.2);
}

.theme-light.contrast-standard.accent-plum {
  --bg: #f6f4f9;
  --bg-2: #fbfbfb;
  --page: #f4eff6;
  --bg-elevated: #fbfbfb;
  --surface-float: #fbfbfb;
  --bg-soft: #f6f4f9;
  --surface: #fbfbfb;
  --surface-2: #f6f4f9;
  --surface-3: #efeaf5;
  --input-bg: #f9f5fb;
  --text: #141414;
  --text-strong: #141414;
  --muted: #5f5f5f;
  --dim: #686868;
  --line: rgba(0, 0, 0, 0.1);
  --line-strong: rgba(0, 0, 0, 0.2);
}

.contrast-standard.accent-rose {
  --bg: #090606;
  --bg-2: #201417;
  --page: #0d0608;
  --bg-elevated: #2f2126;
  --surface-float: #3f3136;
  --bg-soft: #392b30;
  --surface: #2f2126;
  --surface-2: #392b30;
  --surface-3: #43363b;
  --input-bg: #0d0608;
  --text: #ededed;
  --text-strong: #ededed;
  --muted: #bababa;
  --dim: #adadad;
  --line: rgba(255, 255, 255, 0.1);
  --line-strong: rgba(255, 255, 255, 0.2);
}

.theme-light.contrast-standard.accent-rose {
  --bg: #faf3f4;
  --bg-2: #fbfbfb;
  --page: #f7eef1;
  --bg-elevated: #fbfbfb;
  --surface-float: #fbfbfb;
  --bg-soft: #faf3f4;
  --surface: #fbfbfb;
  --surface-2: #faf3f4;
  --surface-3: #f5e9ec;
  --input-bg: #fbf5f7;
  --text: #141414;
  --text-strong: #141414;
  --muted: #5f5f5f;
  --dim: #686868;
  --line: rgba(0, 0, 0, 0.1);
  --line-strong: rgba(0, 0, 0, 0.2);
}

.contrast-standard.accent-sand {
  --bg: #090906;
  --bg-2: #1c170e;
  --page: #0b0b07;
  --bg-elevated: #2b261b;
  --surface-float: #3b352c;
  --bg-soft: #352f26;
  --surface: #2b261b;
  --surface-2: #352f26;
  --surface-3: #403a31;
  --input-bg: #0b0b07;
  --text: #ededed;
  --text-strong: #ededed;
  --muted: #bababa;
  --dim: #adadad;
  --line: rgba(255, 255, 255, 0.1);
  --line-strong: rgba(255, 255, 255, 0.2);
}

.theme-light.contrast-standard.accent-sand {
  --bg: #f9f5f2;
  --bg-2: #fbfbfb;
  --page: #f4f3ed;
  --bg-elevated: #fbfbfb;
  --surface-float: #fbfbfb;
  --bg-soft: #f9f5f2;
  --surface: #fbfbfb;
  --surface-2: #f9f5f2;
  --surface-3: #f1efe7;
  --input-bg: #f9f8f4;
  --text: #141414;
  --text-strong: #141414;
  --muted: #5f5f5f;
  --dim: #686868;
  --line: rgba(0, 0, 0, 0.1);
  --line-strong: rgba(0, 0, 0, 0.2);
}

.contrast-standard.accent-orange {
  --bg: #0d0803;
  --bg-2: #1d150c;
  --page: #100a04;
  --bg-elevated: #281c13;
  --surface-float: #38291d;
  --bg-soft: #302318;
  --surface: #281c13;
  --surface-2: #302318;
  --surface-3: #3d2c1e;
  --input-bg: #100a04;
  --text: #ededed;
  --text-strong: #ededed;
  --muted: #bababa;
  --dim: #adadad;
  --line: rgba(255, 255, 255, 0.1);
  --line-strong: rgba(255, 255, 255, 0.2);
}

.theme-light.contrast-standard.accent-orange {
  --bg: #fcf5ec;
  --bg-2: #fbfbfb;
  --page: #f6eee2;
  --bg-elevated: #fbfbfb;
  --surface-float: #fbfbfb;
  --bg-soft: #fcf5ec;
  --surface: #fbfbfb;
  --surface-2: #fcf5ec;
  --surface-3: #f4e7db;
  --input-bg: #fff9f0;
  --text: #141414;
  --text-strong: #141414;
  --muted: #5f5f5f;
  --dim: #686868;
  --line: rgba(0, 0, 0, 0.1);
  --line-strong: rgba(0, 0, 0, 0.2);
}

.contrast-standard.accent-celadon {
  --bg: #060909;
  --bg-2: #0d1918;
  --page: #070a0a;
  --bg-elevated: #1a2b27;
  --surface-float: #2a3c38;
  --bg-soft: #243532;
  --surface: #1a2b27;
  --surface-2: #243532;
  --surface-3: #2f403c;
  --input-bg: #070a0a;
  --text: #ededed;
  --text-strong: #ededed;
  --muted: #bababa;
  --dim: #adadad;
  --line: rgba(255, 255, 255, 0.1);
  --line-strong: rgba(255, 255, 255, 0.2);
}

.theme-light.contrast-standard.accent-celadon {
  --bg: #f2f9f7;
  --bg-2: #fbfbfb;
  --page: #ecf4f2;
  --bg-elevated: #fbfbfb;
  --surface-float: #fbfbfb;
  --bg-soft: #f2f9f7;
  --surface: #fbfbfb;
  --surface-2: #f2f9f7;
  --surface-3: #e5efec;
  --input-bg: #f4f9f8;
  --text: #141414;
  --text-strong: #141414;
  --muted: #5f5f5f;
  --dim: #686868;
  --line: rgba(0, 0, 0, 0.1);
  --line-strong: rgba(0, 0, 0, 0.2);
}

.contrast-standard.accent-claude {
  --bg: #242321;
  --bg-2: #1e1d1b;
  --page: #201f1d;
  --bg-elevated: #353431;
  --surface-float: #484744;
  --bg-soft: #42413e;
  --surface: #383734;
  --surface-2: #42413e;
  --surface-3: #4d4c49;
  --input-bg: #1e1d1b;
  --text: #e8e6da;
  --text-strong: #e8e6da;
  --muted: #c7c1b6;
  --dim: #c4bfb5;
  --line: rgba(255, 255, 255, 0.1);
  --line-strong: rgba(255, 255, 255, 0.2);
}

.theme-light.contrast-standard.accent-claude {
  --bg: #f8f6f0;
  --bg-2: #f0ece2;
  --page: #eeece3;
  --bg-elevated: #fbfbfb;
  --surface-float: #fbfbfb;
  --bg-soft: #f3efe5;
  --surface: #fbfbfb;
  --surface-2: #f3efe5;
  --surface-3: #e9e5da;
  --input-bg: #f3efe5;
  --text: #32302e;
  --text-strong: #32302e;
  --muted: #66625a;
  --dim: #6a665e;
  --line: rgba(0, 0, 0, 0.1);
  --line-strong: rgba(0, 0, 0, 0.2);
}

.contrast-low {
  --bg: #0a0a0a;
  --bg-2: #141414;
  --page: #0a0a0a;
  --bg-elevated: #1b1b1b;
  --surface-float: #323232;
  --bg-soft: #2d2d2d;
  --surface: #232323;
  --surface-2: #2d2d2d;
  --surface-3: #373737;
  --input-bg: #121212;
  --text: #dddddd;
  --text-strong: #dddddd;
  --muted: #b5b5b5;
  --dim: #adadad;
  --line: rgba(255, 255, 255, 0.07);
  --line-strong: rgba(255, 255, 255, 0.14);
}

.theme-light.contrast-low {
  --bg: #f7f7f7;
  --bg-2: #eeeeee;
  --page: #ebebeb;
  --bg-elevated: #f7f7f7;
  --surface-float: #f7f7f7;
  --bg-soft: #eeeeee;
  --surface: #f7f7f7;
  --surface-2: #eeeeee;
  --surface-3: #e4e4e4;
  --input-bg: #f0f0f0;
  --text: #272727;
  --text-strong: #272727;
  --muted: #646464;
  --dim: #686868;
  --line: rgba(0, 0, 0, 0.07);
  --line-strong: rgba(0, 0, 0, 0.14);
}

.contrast-low.accent-pine {
  --bg: #0a0f0a;
  --bg-2: #13211b;
  --page: #0a110e;
  --bg-elevated: #1b2822;
  --surface-float: #33443b;
  --bg-soft: #2d3f35;
  --surface: #23362c;
  --surface-2: #2d3f35;
  --surface-3: #384940;
  --input-bg: #0a110e;
  --text: #dddddd;
  --text-strong: #dddddd;
  --muted: #b5b5b5;
  --dim: #adadad;
  --line: rgba(255, 255, 255, 0.07);
  --line-strong: rgba(255, 255, 255, 0.14);
}

.theme-light.contrast-low.accent-pine {
  --bg: #eff4f2;
  --bg-2: #f7f7f7;
  --page: #eaf1ee;
  --bg-elevated: #f7f7f7;
  --surface-float: #f7f7f7;
  --bg-soft: #eff4f2;
  --surface: #f7f7f7;
  --surface-2: #eff4f2;
  --surface-3: #e4ede9;
  --input-bg: #f1f6f4;
  --text: #272727;
  --text-strong: #272727;
  --muted: #646464;
  --dim: #686868;
  --line: rgba(0, 0, 0, 0.07);
  --line-strong: rgba(0, 0, 0, 0.14);
}

.contrast-low.accent-indigo {
  --bg: #0a0a0f;
  --bg-2: #131620;
  --page: #0a0e11;
  --bg-elevated: #232637;
  --surface-float: #333645;
  --bg-soft: #2d3040;
  --surface: #232637;
  --surface-2: #2d3040;
  --surface-3: #383b4a;
  --input-bg: #0a0e11;
  --text: #dddddd;
  --text-strong: #dddddd;
  --muted: #b5b5b5;
  --dim: #adadad;
  --line: rgba(255, 255, 255, 0.07);
  --line-strong: rgba(255, 255, 255, 0.14);
}

.theme-light.contrast-low.accent-indigo {
  --bg: #eff1f6;
  --bg-2: #f7f7f7;
  --page: #e9ebf4;
  --bg-elevated: #f7f7f7;
  --surface-float: #f7f7f7;
  --bg-soft: #eff1f6;
  --surface: #f7f7f7;
  --surface-2: #eff1f6;
  --surface-3: #e5e8f1;
  --input-bg: #f1f4f6;
  --text: #272727;
  --text-strong: #272727;
  --muted: #646464;
  --dim: #686868;
  --line: rgba(0, 0, 0, 0.07);
  --line-strong: rgba(0, 0, 0, 0.14);
}

.contrast-low.accent-clay {
  --bg: #0f0a0a;
  --bg-2: #221810;
  --page: #110e0a;
  --bg-elevated: #2f251d;
  --surface-float: #3e342d;
  --bg-soft: #382e27;
  --surface: #2f251d;
  --surface-2: #382e27;
  --surface-3: #423932;
  --input-bg: #110e0a;
  --text: #dddddd;
  --text-strong: #dddddd;
  --muted: #b5b5b5;
  --dim: #adadad;
  --line: rgba(255, 255, 255, 0.07);
  --line-strong: rgba(255, 255, 255, 0.14);
}

.theme-light.contrast-low.accent-clay {
  --bg: #f6f1ef;
  --bg-2: #f7f7f7;
  --page: #f3edea;
  --bg-elevated: #f7f7f7;
  --surface-float: #f7f7f7;
  --bg-soft: #f6f1ef;
  --surface: #f7f7f7;
  --surface-2: #f6f1ef;
  --surface-3: #f0eae5;
  --input-bg: #f6f4f1;
  --text: #272727;
  --text-strong: #272727;
  --muted: #646464;
  --dim: #686868;
  --line: rgba(0, 0, 0, 0.07);
  --line-strong: rgba(0, 0, 0, 0.14);
}

.contrast-low.accent-ocean {
  --bg: #0a0f0f;
  --bg-2: #101f24;
  --page: #0a0e11;
  --bg-elevated: #203238;
  --surface-float: #314147;
  --bg-soft: #2b3b41;
  --surface: #203238;
  --surface-2: #2b3b41;
  --surface-3: #36454b;
  --input-bg: #0a0e11;
  --text: #dddddd;
  --text-strong: #dddddd;
  --muted: #b5b5b5;
  --dim: #adadad;
  --line: rgba(255, 255, 255, 0.07);
  --line-strong: rgba(255, 255, 255, 0.14);
}

.theme-light.contrast-low.accent-ocean {
  --bg: #edf4f6;
  --bg-2: #f7f7f7;
  --page: #e9eff3;
  --bg-elevated: #f7f7f7;
  --surface-float: #f7f7f7;
  --bg-soft: #edf4f6;
  --surface: #f7f7f7;
  --surface-2: #edf4f6;
  --surface-3: #e3ecf0;
  --input-bg: #eff4f7;
  --text: #272727;
  --text-strong: #272727;
  --muted: #646464;
  --dim: #686868;
  --line: rgba(0, 0, 0, 0.07);
  --line-strong: rgba(0, 0, 0, 0.14);
}

.contrast-low.accent-moss {
  --bg: #0a0f0a;
  --bg-2: #1b210f;
  --page: #0e110a;
  --bg-elevated: #29321f;
  --surface-float: #38412f;
  --bg-soft: #333b29;
  --surface: #29321f;
  --surface-2: #333b29;
  --surface-3: #3d4534;
  --input-bg: #0e110a;
  --text: #dddddd;
  --text-strong: #dddddd;
  --muted: #b5b5b5;
  --dim: #adadad;
  --line: rgba(255, 255, 255, 0.07);
  --line-strong: rgba(255, 255, 255, 0.14);
}

.theme-light.contrast-low.accent-moss {
  --bg: #f2f4ef;
  --bg-2: #f7f7f7;
  --page: #eef1e9;
  --bg-elevated: #f7f7f7;
  --surface-float: #f7f7f7;
  --bg-soft: #f2f4ef;
  --surface: #f7f7f7;
  --surface-2: #f2f4ef;
  --surface-3: #eaede4;
  --input-bg: #f4f6f1;
  --text: #272727;
  --text-strong: #272727;
  --muted: #646464;
  --dim: #686868;
  --line: rgba(0, 0, 0, 0.07);
  --line-strong: rgba(0, 0, 0, 0.14);
}

.contrast-low.accent-plum {
  --bg: #0f0a0f;
  --bg-2: #1e1822;
  --page: #0e0a11;
  --bg-elevated: #2d2534;
  --surface-float: #3c3543;
  --bg-soft: #362f3d;
  --surface: #2d2534;
  --surface-2: #362f3d;
  --surface-3: #413a48;
  --input-bg: #0e0a11;
  --text: #dddddd;
  --text-strong: #dddddd;
  --muted: #b5b5b5;
  --dim: #adadad;
  --line: rgba(255, 255, 255, 0.07);
  --line-strong: rgba(255, 255, 255, 0.14);
}

.theme-light.contrast-low.accent-plum {
  --bg: #f2eff7;
  --bg-2: #f7f7f7;
  --page: #f0ebf4;
  --bg-elevated: #f7f7f7;
  --surface-float: #f7f7f7;
  --bg-soft: #f2eff7;
  --surface: #f7f7f7;
  --surface-2: #f2eff7;
  --surface-3: #ece5f2;
  --input-bg: #f6eff9;
  --text: #272727;
  --text-strong: #272727;
  --muted: #646464;
  --dim: #686868;
  --line: rgba(0, 0, 0, 0.07);
  --line-strong: rgba(0, 0, 0, 0.14);
}

.contrast-low.accent-rose {
  --bg: #0f0a0a;
  --bg-2: #25171b;
  --page: #130a0d;
  --bg-elevated: #34242a;
  --surface-float: #43343a;
  --bg-soft: #3d2e34;
  --surface: #34242a;
  --surface-2: #3d2e34;
  --surface-3: #48393f;
  --input-bg: #130a0d;
  --text: #dddddd;
  --text-strong: #dddddd;
  --muted: #b5b5b5;
  --dim: #adadad;
  --line: rgba(255, 255, 255, 0.07);
  --line-strong: rgba(255, 255, 255, 0.14);
}

.theme-light.contrast-low.accent-rose {
  --bg: #f8eef0;
  --bg-2: #f7f7f7;
  --page: #f4e9ed;
  --bg-elevated: #f7f7f7;
  --surface-float: #f7f7f7;
  --bg-soft: #f8eef0;
  --surface: #f7f7f7;
  --surface-2: #f8eef0;
  --surface-3: #f2e4e7;
  --input-bg: #f9eff2;
  --text: #272727;
  --text-strong: #272727;
  --muted: #646464;
  --dim: #686868;
  --line: rgba(0, 0, 0, 0.07);
  --line-strong: rgba(0, 0, 0, 0.14);
}

.contrast-low.accent-sand {
  --bg: #0f0f0a;
  --bg-2: #231c11;
  --page: #11110a;
  --bg-elevated: #312a1f;
  --surface-float: #3f3a2f;
  --bg-soft: #3a3429;
  --surface: #312a1f;
  --surface-2: #3a3429;
  --surface-3: #443e34;
  --input-bg: #11110a;
  --text: #dddddd;
  --text-strong: #dddddd;
  --muted: #b5b5b5;
  --dim: #adadad;
  --line: rgba(255, 255, 255, 0.07);
  --line-strong: rgba(255, 255, 255, 0.14);
}

.theme-light.contrast-low.accent-sand {
  --bg: #f6f2ed;
  --bg-2: #f7f7f7;
  --page: #f1f0e9;
  --bg-elevated: #f7f7f7;
  --surface-float: #f7f7f7;
  --bg-soft: #f6f2ed;
  --surface: #f7f7f7;
  --surface-2: #f6f2ed;
  --surface-3: #efece3;
  --input-bg: #f7f4ef;
  --text: #272727;
  --text-strong: #272727;
  --muted: #646464;
  --dim: #686868;
  --line: rgba(0, 0, 0, 0.07);
  --line-strong: rgba(0, 0, 0, 0.14);
}

.contrast-low.accent-orange {
  --bg: #160d04;
  --bg-2: #231a0f;
  --page: #180f06;
  --bg-elevated: #2e2116;
  --surface-float: #3d2d20;
  --bg-soft: #36281b;
  --surface: #2e2116;
  --surface-2: #36281b;
  --surface-3: #423021;
  --input-bg: #180f06;
  --text: #dddddd;
  --text-strong: #dddddd;
  --muted: #b5b5b5;
  --dim: #adadad;
  --line: rgba(255, 255, 255, 0.07);
  --line-strong: rgba(255, 255, 255, 0.14);
}

.theme-light.contrast-low.accent-orange {
  --bg: #fbf1e5;
  --bg-2: #f7f7f7;
  --page: #f5eadd;
  --bg-elevated: #f7f7f7;
  --surface-float: #f7f7f7;
  --bg-soft: #fbf1e5;
  --surface: #f7f7f7;
  --surface-2: #fbf1e5;
  --surface-3: #f3e4d5;
  --input-bg: #fff6e9;
  --text: #272727;
  --text-strong: #272727;
  --muted: #646464;
  --dim: #686868;
  --line: rgba(0, 0, 0, 0.07);
  --line-strong: rgba(0, 0, 0, 0.14);
}

.contrast-low.accent-celadon {
  --bg: #0a0f0f;
  --bg-2: #111f1e;
  --page: #0c0f0f;
  --bg-elevated: #1e302c;
  --surface-float: #2e413c;
  --bg-soft: #283a36;
  --surface: #1e302c;
  --surface-2: #283a36;
  --surface-3: #334441;
  --input-bg: #0c0f0f;
  --text: #dddddd;
  --text-strong: #dddddd;
  --muted: #b5b5b5;
  --dim: #adadad;
  --line: rgba(255, 255, 255, 0.07);
  --line-strong: rgba(255, 255, 255, 0.14);
}

.theme-light.contrast-low.accent-celadon {
  --bg: #edf6f4;
  --bg-2: #f7f7f7;
  --page: #e8f2ee;
  --bg-elevated: #f7f7f7;
  --surface-float: #f7f7f7;
  --bg-soft: #edf6f4;
  --surface: #f7f7f7;
  --surface-2: #edf6f4;
  --surface-3: #e0ede9;
  --input-bg: #eff7f4;
  --text: #272727;
  --text-strong: #272727;
  --muted: #646464;
  --dim: #686868;
  --line: rgba(0, 0, 0, 0.07);
  --line-strong: rgba(0, 0, 0, 0.14);
}

.contrast-low.accent-claude {
  --bg: #282726;
  --bg-2: #232120;
  --page: #242322;
  --bg-elevated: #3a3835;
  --surface-float: #4c4b47;
  --bg-soft: #464541;
  --surface: #3c3b38;
  --surface-2: #464541;
  --surface-3: #504f4c;
  --input-bg: #232120;
  --text: #dcd8c7;
  --text-strong: #dcd8c7;
  --muted: #c2bcb0;
  --dim: #c4bfb5;
  --line: rgba(255, 255, 255, 0.07);
  --line-strong: rgba(255, 255, 255, 0.14);
}

.theme-light.contrast-low.accent-claude {
  --bg: #f5f3eb;
  --bg-2: #ede9de;
  --page: #ece9de;
  --bg-elevated: #f7f7f7;
  --surface-float: #f7f7f7;
  --bg-soft: #f0ece0;
  --surface: #f7f7f7;
  --surface-2: #f0ece0;
  --surface-3: #e7e2d5;
  --input-bg: #f0ece0;
  --text: #43413e;
  --text-strong: #43413e;
  --muted: #6b675e;
  --dim: #6a665e;
  --line: rgba(0, 0, 0, 0.07);
  --line-strong: rgba(0, 0, 0, 0.14);
}

.contrast-high {
  --bg: #040404;
  --bg-2: #0d0d0d;
  --page: #040404;
  --bg-elevated: #131313;
  --surface-float: #272727;
  --bg-soft: #222222;
  --surface: #1a1a1a;
  --surface-2: #222222;
  --surface-3: #2b2b2b;
  --input-bg: #0b0b0b;
  --text: #f5f5f5;
  --text-strong: #f5f5f5;
  --muted: #d9d9d9;
  --dim: #d2d2d2;
  --line: rgba(255, 255, 255, 0.18);
  --line-strong: rgba(255, 255, 255, 0.32);
}

.theme-light.contrast-high {
  --bg: #fdfdfd;
  --bg-2: #f8f8f8;
  --page: #f7f7f7;
  --bg-elevated: #fdfdfd;
  --surface-float: #fdfdfd;
  --bg-soft: #f8f8f8;
  --surface: #fdfdfd;
  --surface-2: #f8f8f8;
  --surface-3: #f3f3f3;
  --input-bg: #f9f9f9;
  --text: #0b0b0b;
  --text-strong: #0b0b0b;
  --muted: #343434;
  --dim: #393939;
  --line: rgba(0, 0, 0, 0.18);
  --line-strong: rgba(0, 0, 0, 0.32);
}

.contrast-high.accent-pine {
  --bg: #050805;
  --bg-2: #0d1713;
  --page: #060a08;
  --bg-elevated: #141d19;
  --surface-float: #28362f;
  --bg-soft: #23312a;
  --surface: #1b2921;
  --surface-2: #23312a;
  --surface-3: #2d3a33;
  --input-bg: #060a08;
  --text: #f5f5f5;
  --text-strong: #f5f5f5;
  --muted: #d9d9d9;
  --dim: #d2d2d2;
  --line: rgba(255, 255, 255, 0.18);
  --line-strong: rgba(255, 255, 255, 0.32);
}

.theme-light.contrast-high.accent-pine {
  --bg: #f9fbfa;
  --bg-2: #fdfdfd;
  --page: #f7faf8;
  --bg-elevated: #fdfdfd;
  --surface-float: #fdfdfd;
  --bg-soft: #f9fbfa;
  --surface: #fdfdfd;
  --surface-2: #f9fbfa;
  --surface-3: #f4f8f6;
  --input-bg: #fafcfb;
  --text: #0b0b0b;
  --text-strong: #0b0b0b;
  --muted: #343434;
  --dim: #393939;
  --line: rgba(0, 0, 0, 0.18);
  --line-strong: rgba(0, 0, 0, 0.32);
}

.contrast-high.accent-indigo {
  --bg: #050508;
  --bg-2: #0d0f16;
  --page: #06080a;
  --bg-elevated: #1b1e2a;
  --surface-float: #282b37;
  --bg-soft: #232632;
  --surface: #1b1e2a;
  --surface-2: #232632;
  --surface-3: #2d2f3b;
  --input-bg: #06080a;
  --text: #f5f5f5;
  --text-strong: #f5f5f5;
  --muted: #d9d9d9;
  --dim: #d2d2d2;
  --line: rgba(255, 255, 255, 0.18);
  --line-strong: rgba(255, 255, 255, 0.32);
}

.theme-light.contrast-high.accent-indigo {
  --bg: #f9fafc;
  --bg-2: #fdfdfd;
  --page: #f7f7fb;
  --bg-elevated: #fdfdfd;
  --surface-float: #fdfdfd;
  --bg-soft: #f9fafc;
  --surface: #fdfdfd;
  --surface-2: #f9fafc;
  --surface-3: #f4f5f9;
  --input-bg: #fafbfc;
  --text: #0b0b0b;
  --text-strong: #0b0b0b;
  --muted: #343434;
  --dim: #393939;
  --line: rgba(0, 0, 0, 0.18);
  --line-strong: rgba(0, 0, 0, 0.32);
}

.contrast-high.accent-clay {
  --bg: #080505;
  --bg-2: #17110b;
  --page: #0a0806;
  --bg-elevated: #231c16;
  --surface-float: #302923;
  --bg-soft: #2b241e;
  --surface: #231c16;
  --surface-2: #2b241e;
  --surface-3: #342d28;
  --input-bg: #0a0806;
  --text: #f5f5f5;
  --text-strong: #f5f5f5;
  --muted: #d9d9d9;
  --dim: #d2d2d2;
  --line: rgba(255, 255, 255, 0.18);
  --line-strong: rgba(255, 255, 255, 0.32);
}

.theme-light.contrast-high.accent-clay {
  --bg: #fcfaf9;
  --bg-2: #fdfdfd;
  --page: #faf8f7;
  --bg-elevated: #fdfdfd;
  --surface-float: #fdfdfd;
  --bg-soft: #fcfaf9;
  --surface: #fdfdfd;
  --surface-2: #fcfaf9;
  --surface-3: #f9f6f4;
  --input-bg: #fcfbfa;
  --text: #0b0b0b;
  --text-strong: #0b0b0b;
  --muted: #343434;
  --dim: #393939;
  --line: rgba(0, 0, 0, 0.18);
  --line-strong: rgba(0, 0, 0, 0.32);
}

.contrast-high.accent-ocean {
  --bg: #050808;
  --bg-2: #0b1619;
  --page: #06080a;
  --bg-elevated: #19262b;
  --surface-float: #273338;
  --bg-soft: #212e33;
  --surface: #19262b;
  --surface-2: #212e33;
  --surface-3: #2b373c;
  --input-bg: #06080a;
  --text: #f5f5f5;
  --text-strong: #f5f5f5;
  --muted: #d9d9d9;
  --dim: #d2d2d2;
  --line: rgba(255, 255, 255, 0.18);
  --line-strong: rgba(255, 255, 255, 0.32);
}

.theme-light.contrast-high.accent-ocean {
  --bg: #f9fbfc;
  --bg-2: #fdfdfd;
  --page: #f6f9fa;
  --bg-elevated: #fdfdfd;
  --surface-float: #fdfdfd;
  --bg-soft: #f9fbfc;
  --surface: #fdfdfd;
  --surface-2: #f9fbfc;
  --surface-3: #f3f7f9;
  --input-bg: #f9fbfc;
  --text: #0b0b0b;
  --text-strong: #0b0b0b;
  --muted: #343434;
  --dim: #393939;
  --line: rgba(0, 0, 0, 0.18);
  --line-strong: rgba(0, 0, 0, 0.32);
}

.contrast-high.accent-moss {
  --bg: #050805;
  --bg-2: #12170a;
  --page: #080a06;
  --bg-elevated: #1f2617;
  --surface-float: #2c3325;
  --bg-soft: #272e20;
  --surface: #1f2617;
  --surface-2: #272e20;
  --surface-3: #313729;
  --input-bg: #080a06;
  --text: #f5f5f5;
  --text-strong: #f5f5f5;
  --muted: #d9d9d9;
  --dim: #d2d2d2;
  --line: rgba(255, 255, 255, 0.18);
  --line-strong: rgba(255, 255, 255, 0.32);
}

.theme-light.contrast-high.accent-moss {
  --bg: #fafbf9;
  --bg-2: #fdfdfd;
  --page: #f8faf6;
  --bg-elevated: #fdfdfd;
  --surface-float: #fdfdfd;
  --bg-soft: #fafbf9;
  --surface: #fdfdfd;
  --surface-2: #fafbf9;
  --surface-3: #f6f8f4;
  --input-bg: #fbfcfa;
  --text: #0b0b0b;
  --text-strong: #0b0b0b;
  --muted: #343434;
  --dim: #393939;
  --line: rgba(0, 0, 0, 0.18);
  --line-strong: rgba(0, 0, 0, 0.32);
}

.contrast-high.accent-plum {
  --bg: #080508;
  --bg-2: #151118;
  --page: #08060a;
  --bg-elevated: #221d28;
  --surface-float: #302a35;
  --bg-soft: #2b2530;
  --surface: #221d28;
  --surface-2: #2b2530;
  --surface-3: #342e39;
  --input-bg: #08060a;
  --text: #f5f5f5;
  --text-strong: #f5f5f5;
  --muted: #d9d9d9;
  --dim: #d2d2d2;
  --line: rgba(255, 255, 255, 0.18);
  --line-strong: rgba(255, 255, 255, 0.32);
}

.theme-light.contrast-high.accent-plum {
  --bg: #faf9fc;
  --bg-2: #fdfdfd;
  --page: #f9f7fb;
  --bg-elevated: #fdfdfd;
  --surface-float: #fdfdfd;
  --bg-soft: #faf9fc;
  --surface: #fdfdfd;
  --surface-2: #faf9fc;
  --surface-3: #f7f5fa;
  --input-bg: #fcfafd;
  --text: #0b0b0b;
  --text-strong: #0b0b0b;
  --muted: #343434;
  --dim: #393939;
  --line: rgba(0, 0, 0, 0.18);
  --line-strong: rgba(0, 0, 0, 0.32);
}

.contrast-high.accent-rose {
  --bg: #080505;
  --bg-2: #1b1114;
  --page: #0b0507;
  --bg-elevated: #281c20;
  --surface-float: #35292e;
  --bg-soft: #302429;
  --surface: #281c20;
  --surface-2: #302429;
  --surface-3: #392d32;
  --input-bg: #0b0507;
  --text: #f5f5f5;
  --text-strong: #f5f5f5;
  --muted: #d9d9d9;
  --dim: #d2d2d2;
  --line: rgba(255, 255, 255, 0.18);
  --line-strong: rgba(255, 255, 255, 0.32);
}

.theme-light.contrast-high.accent-rose {
  --bg: #fcf9fa;
  --bg-2: #fdfdfd;
  --page: #fbf7f8;
  --bg-elevated: #fdfdfd;
  --surface-float: #fdfdfd;
  --bg-soft: #fcf9fa;
  --surface: #fdfdfd;
  --surface-2: #fcf9fa;
  --surface-3: #faf4f5;
  --input-bg: #fdfafb;
  --text: #0b0b0b;
  --text-strong: #0b0b0b;
  --muted: #343434;
  --dim: #393939;
  --line: rgba(0, 0, 0, 0.18);
  --line-strong: rgba(0, 0, 0, 0.32);
}

.contrast-high.accent-sand {
  --bg: #080805;
  --bg-2: #18140c;
  --page: #0a0a06;
  --bg-elevated: #252017;
  --surface-float: #322d25;
  --bg-soft: #2d2820;
  --surface: #252017;
  --surface-2: #2d2820;
  --surface-3: #363129;
  --input-bg: #0a0a06;
  --text: #f5f5f5;
  --text-strong: #f5f5f5;
  --muted: #d9d9d9;
  --dim: #d2d2d2;
  --line: rgba(255, 255, 255, 0.18);
  --line-strong: rgba(255, 255, 255, 0.32);
}

.theme-light.contrast-high.accent-sand {
  --bg: #fcfaf9;
  --bg-2: #fdfdfd;
  --page: #faf9f6;
  --bg-elevated: #fdfdfd;
  --surface-float: #fdfdfd;
  --bg-soft: #fcfaf9;
  --surface: #fdfdfd;
  --surface-2: #fcfaf9;
  --surface-3: #f8f7f3;
  --input-bg: #fcfbf9;
  --text: #0b0b0b;
  --text-strong: #0b0b0b;
  --muted: #343434;
  --dim: #393939;
  --line: rgba(0, 0, 0, 0.18);
  --line-strong: rgba(0, 0, 0, 0.32);
}

.contrast-high.accent-orange {
  --bg: #0b0702;
  --bg-2: #18120a;
  --page: #0e0903;
  --bg-elevated: #221810;
  --surface-float: #2f2319;
  --bg-soft: #291e14;
  --surface: #221810;
  --surface-2: #291e14;
  --surface-3: #342619;
  --input-bg: #0e0903;
  --text: #f5f5f5;
  --text-strong: #f5f5f5;
  --muted: #d9d9d9;
  --dim: #d2d2d2;
  --line: rgba(255, 255, 255, 0.18);
  --line-strong: rgba(255, 255, 255, 0.32);
}

.theme-light.contrast-high.accent-orange {
  --bg: #fefaf5;
  --bg-2: #fdfdfd;
  --page: #fbf6f1;
  --bg-elevated: #fdfdfd;
  --surface-float: #fdfdfd;
  --bg-soft: #fefaf5;
  --surface: #fdfdfd;
  --surface-2: #fefaf5;
  --surface-3: #faf3ed;
  --input-bg: #fffcf8;
  --text: #0b0b0b;
  --text-strong: #0b0b0b;
  --muted: #343434;
  --dim: #393939;
  --line: rgba(0, 0, 0, 0.18);
  --line-strong: rgba(0, 0, 0, 0.32);
}

.contrast-high.accent-celadon {
  --bg: #050808;
  --bg-2: #0b1614;
  --page: #060808;
  --bg-elevated: #162421;
  --surface-float: #24332f;
  --bg-soft: #1f2d2a;
  --surface: #162421;
  --surface-2: #1f2d2a;
  --surface-3: #283633;
  --input-bg: #060808;
  --text: #f5f5f5;
  --text-strong: #f5f5f5;
  --muted: #d9d9d9;
  --dim: #d2d2d2;
  --line: rgba(255, 255, 255, 0.18);
  --line-strong: rgba(255, 255, 255, 0.32);
}

.theme-light.contrast-high.accent-celadon {
  --bg: #f9fcfb;
  --bg-2: #fdfdfd;
  --page: #f6faf8;
  --bg-elevated: #fdfdfd;
  --surface-float: #fdfdfd;
  --bg-soft: #f9fcfb;
  --surface: #fdfdfd;
  --surface-2: #f9fcfb;
  --surface-3: #f2f7f5;
  --input-bg: #f9fcfb;
  --text: #0b0b0b;
  --text-strong: #0b0b0b;
  --muted: #343434;
  --dim: #393939;
  --line: rgba(0, 0, 0, 0.18);
  --line-strong: rgba(0, 0, 0, 0.32);
}

.contrast-high.accent-claude {
  --bg: #1e1d1c;
  --bg-2: #191817;
  --page: #1b1a19;
  --bg-elevated: #2d2c2a;
  --surface-float: #3d3c3a;
  --bg-soft: #383735;
  --surface: #302f2c;
  --surface-2: #383735;
  --surface-3: #41403e;
  --input-bg: #191817;
  --text: #f2f1eb;
  --text-strong: #f2f1eb;
  --muted: #e0ddd7;
  --dim: #dfdcd6;
  --line: rgba(255, 255, 255, 0.18);
  --line-strong: rgba(255, 255, 255, 0.32);
}

.theme-light.contrast-high.accent-claude {
  --bg: #fbfbf8;
  --bg-2: #f7f5f1;
  --page: #f7f6f1;
  --bg-elevated: #fdfdfd;
  --surface-float: #fdfdfd;
  --bg-soft: #f9f7f2;
  --surface: #fdfdfd;
  --surface-2: #f9f7f2;
  --surface-3: #f4f2ec;
  --input-bg: #f9f7f2;
  --text: #1b1a1a;
  --text-strong: #1b1a1a;
  --muted: #383631;
  --dim: #3a3834;
  --line: rgba(0, 0, 0, 0.18);
  --line-strong: rgba(0, 0, 0, 0.32);
}

.saturation-standard {
  --accent: #ffffff;
  --accent-soft: #ffffff;
  --accent-gradient: linear-gradient(135deg, #ffffff, #bdbdbd);
  --accent-wash-strong: rgba(255, 255, 255, 0.65);
  --accent-wash: rgba(255, 255, 255, 0.14);
  --accent-wash-soft: rgba(255, 255, 255, 0.08);
  --accent-line: rgba(255, 255, 255, 0.45);
  --accent-line-soft: rgba(255, 255, 255, 0.28);
  --accent-glow: rgba(255, 255, 255, 0.26);
  --ok: #93bc9b;
  --ok-soft: #c5dfcb;
  --warn: #d5ae70;
  --danger: #d28b84;
  --knowledge: #a3c7c8;
  --knowledge-soft: rgba(163, 199, 200, 0.14);
  --file: #88a8c7;
  --file-soft: rgba(136, 168, 199, 0.14);
  --pause: #d5ae70;
  --pause-soft: rgba(213, 174, 112, 0.14);
  --pause-line: rgba(213, 174, 112, 0.32);
  --stop: #d28b84;
  --stop-soft: rgba(210, 139, 132, 0.14);
  --stop-line: rgba(210, 139, 132, 0.32);
  --resume: #93bc9b;
  --resume-soft: rgba(147, 188, 155, 0.14);
  --review: #afa1c4;
  --review-soft: rgba(175, 161, 196, 0.14);
}

.theme-light.saturation-standard {
  --accent: #000000;
  --accent-soft: #000000;
  --accent-gradient: linear-gradient(135deg, #000000, #333333);
  --accent-wash-strong: rgba(0, 0, 0, 0.65);
  --accent-wash: rgba(0, 0, 0, 0.1);
  --accent-wash-soft: rgba(0, 0, 0, 0.06);
  --accent-line: rgba(0, 0, 0, 0.45);
  --accent-line-soft: rgba(0, 0, 0, 0.28);
  --accent-glow: rgba(0, 0, 0, 0.22);
  --ok: #4a7754;
  --ok-soft: #3b6044;
  --warn: #976d28;
  --danger: #ac504a;
  --knowledge: #477a7a;
  --knowledge-soft: rgba(71, 122, 122, 0.1);
  --file: #476b8d;
  --file-soft: rgba(71, 107, 141, 0.1);
  --pause: #976d28;
  --pause-soft: rgba(151, 109, 40, 0.1);
  --pause-line: rgba(151, 109, 40, 0.32);
  --stop: #ac504a;
  --stop-soft: rgba(172, 80, 74, 0.1);
  --stop-line: rgba(172, 80, 74, 0.32);
  --resume: #4a7754;
  --resume-soft: rgba(74, 119, 84, 0.1);
  --review: #6e5e87;
  --review-soft: rgba(110, 94, 135, 0.1);
}

.saturation-standard.accent-pine {
  --accent: #70d1a1;
  --accent-soft: #9be3bf;
  --accent-gradient: linear-gradient(135deg, #84d2ab, #3fcf87);
  --accent-wash-strong: rgba(112, 209, 161, 0.65);
  --accent-wash: rgba(112, 209, 161, 0.16);
  --accent-wash-soft: rgba(112, 209, 161, 0.1);
  --accent-line: rgba(112, 209, 161, 0.5);
  --accent-line-soft: rgba(112, 209, 161, 0.32);
  --accent-glow: rgba(112, 209, 161, 0.3);
  --ok: #93bc9b;
  --ok-soft: #c5dfcb;
  --warn: #d5ae70;
  --danger: #d28b84;
  --knowledge: #a3c7c8;
  --knowledge-soft: rgba(163, 199, 200, 0.14);
  --file: #88a8c7;
  --file-soft: rgba(136, 168, 199, 0.14);
  --pause: #d5ae70;
  --pause-soft: rgba(213, 174, 112, 0.14);
  --pause-line: rgba(213, 174, 112, 0.32);
  --stop: #d28b84;
  --stop-soft: rgba(210, 139, 132, 0.14);
  --stop-line: rgba(210, 139, 132, 0.32);
  --resume: #93bc9b;
  --resume-soft: rgba(147, 188, 155, 0.14);
  --review: #afa1c4;
  --review-soft: rgba(175, 161, 196, 0.14);
}

.theme-light.saturation-standard.accent-pine {
  --accent: #278254;
  --accent-soft: #256645;
  --accent-gradient: linear-gradient(135deg, #319161, #1e764a);
  --accent-wash-strong: rgba(39, 130, 84, 0.65);
  --accent-wash: rgba(39, 130, 84, 0.12);
  --accent-wash-soft: rgba(39, 130, 84, 0.07);
  --accent-line: rgba(39, 130, 84, 0.5);
  --accent-line-soft: rgba(39, 130, 84, 0.32);
  --accent-glow: rgba(39, 130, 84, 0.24);
  --ok: #4a7754;
  --ok-soft: #3b6044;
  --warn: #976d28;
  --danger: #ac504a;
  --knowledge: #477a7a;
  --knowledge-soft: rgba(71, 122, 122, 0.1);
  --file: #476b8d;
  --file-soft: rgba(71, 107, 141, 0.1);
  --pause: #976d28;
  --pause-soft: rgba(151, 109, 40, 0.1);
  --pause-line: rgba(151, 109, 40, 0.32);
  --stop: #ac504a;
  --stop-soft: rgba(172, 80, 74, 0.1);
  --stop-line: rgba(172, 80, 74, 0.32);
  --resume: #4a7754;
  --resume-soft: rgba(74, 119, 84, 0.1);
  --review: #6e5e87;
  --review-soft: rgba(110, 94, 135, 0.1);
}

.saturation-standard.accent-indigo {
  --accent: #7994e2;
  --accent-soft: #a8bbf0;
  --accent-gradient: linear-gradient(135deg, #8da3e2, #4670e2);
  --accent-wash-strong: rgba(121, 148, 226, 0.65);
  --accent-wash: rgba(121, 148, 226, 0.16);
  --accent-wash-soft: rgba(121, 148, 226, 0.1);
  --accent-line: rgba(121, 148, 226, 0.5);
  --accent-line-soft: rgba(121, 148, 226, 0.32);
  --accent-glow: rgba(121, 148, 226, 0.3);
  --ok: #93bc9b;
  --ok-soft: #c5dfcb;
  --warn: #d5ae70;
  --danger: #d28b84;
  --knowledge: #a3c7c8;
  --knowledge-soft: rgba(163, 199, 200, 0.14);
  --file: #88a8c7;
  --file-soft: rgba(136, 168, 199, 0.14);
  --pause: #d5ae70;
  --pause-soft: rgba(213, 174, 112, 0.14);
  --pause-line: rgba(213, 174, 112, 0.32);
  --stop: #d28b84;
  --stop-soft: rgba(210, 139, 132, 0.14);
  --stop-line: rgba(210, 139, 132, 0.32);
  --resume: #93bc9b;
  --resume-soft: rgba(147, 188, 155, 0.14);
  --review: #afa1c4;
  --review-soft: rgba(175, 161, 196, 0.14);
}

.theme-light.saturation-standard.accent-indigo {
  --accent: #2646a1;
  --accent-soft: #273f82;
  --accent-gradient: linear-gradient(135deg, #3052b1, #1d3e96);
  --accent-wash-strong: rgba(38, 70, 161, 0.65);
  --accent-wash: rgba(38, 70, 161, 0.12);
  --accent-wash-soft: rgba(38, 70, 161, 0.07);
  --accent-line: rgba(38, 70, 161, 0.5);
  --accent-line-soft: rgba(38, 70, 161, 0.32);
  --accent-glow: rgba(38, 70, 161, 0.24);
  --ok: #4a7754;
  --ok-soft: #3b6044;
  --warn: #976d28;
  --danger: #ac504a;
  --knowledge: #477a7a;
  --knowledge-soft: rgba(71, 122, 122, 0.1);
  --file: #476b8d;
  --file-soft: rgba(71, 107, 141, 0.1);
  --pause: #976d28;
  --pause-soft: rgba(151, 109, 40, 0.1);
  --pause-line: rgba(151, 109, 40, 0.32);
  --stop: #ac504a;
  --stop-soft: rgba(172, 80, 74, 0.1);
  --stop-line: rgba(172, 80, 74, 0.32);
  --resume: #4a7754;
  --resume-soft: rgba(74, 119, 84, 0.1);
  --review: #6e5e87;
  --review-soft: rgba(110, 94, 135, 0.1);
}

.saturation-standard.accent-clay {
  --accent: #df9a67;
  --accent-soft: #edba97;
  --accent-gradient: linear-gradient(135deg, #dea57d, #df7c34);
  --accent-wash-strong: rgba(223, 154, 103, 0.65);
  --accent-wash: rgba(223, 154, 103, 0.16);
  --accent-wash-soft: rgba(223, 154, 103, 0.1);
  --accent-line: rgba(223, 154, 103, 0.5);
  --accent-line-soft: rgba(223, 154, 103, 0.32);
  --accent-glow: rgba(223, 154, 103, 0.3);
  --ok: #93bc9b;
  --ok-soft: #c5dfcb;
  --warn: #d5ae70;
  --danger: #d28b84;
  --knowledge: #a3c7c8;
  --knowledge-soft: rgba(163, 199, 200, 0.14);
  --file: #88a8c7;
  --file-soft: rgba(136, 168, 199, 0.14);
  --pause: #d5ae70;
  --pause-soft: rgba(213, 174, 112, 0.14);
  --pause-line: rgba(213, 174, 112, 0.32);
  --stop: #d28b84;
  --stop-soft: rgba(210, 139, 132, 0.14);
  --stop-line: rgba(210, 139, 132, 0.32);
  --resume: #93bc9b;
  --resume-soft: rgba(147, 188, 155, 0.14);
  --review: #afa1c4;
  --review-soft: rgba(175, 161, 196, 0.14);
}

.theme-light.saturation-standard.accent-clay {
  --accent: #9d5724;
  --accent-soft: #7e4a25;
  --accent-gradient: linear-gradient(135deg, #ad642e, #924d1c);
  --accent-wash-strong: rgba(157, 87, 36, 0.65);
  --accent-wash: rgba(157, 87, 36, 0.12);
  --accent-wash-soft: rgba(157, 87, 36, 0.07);
  --accent-line: rgba(157, 87, 36, 0.5);
  --accent-line-soft: rgba(157, 87, 36, 0.32);
  --accent-glow: rgba(157, 87, 36, 0.24);
  --ok: #4a7754;
  --ok-soft: #3b6044;
  --warn: #976d28;
  --danger: #ac504a;
  --knowledge: #477a7a;
  --knowledge-soft: rgba(71, 122, 122, 0.1);
  --file: #476b8d;
  --file-soft: rgba(71, 107, 141, 0.1);
  --pause: #976d28;
  --pause-soft: rgba(151, 109, 40, 0.1);
  --pause-line: rgba(151, 109, 40, 0.32);
  --stop: #ac504a;
  --stop-soft: rgba(172, 80, 74, 0.1);
  --stop-line: rgba(172, 80, 74, 0.32);
  --resume: #4a7754;
  --resume-soft: rgba(74, 119, 84, 0.1);
  --review: #6e5e87;
  --review-soft: rgba(110, 94, 135, 0.1);
}

.saturation-standard.accent-ocean {
  --accent: #55b9e7;
  --accent-soft: #89cff0;
  --accent-gradient: linear-gradient(135deg, #6bbee5, #22a8e7);
  --accent-wash-strong: rgba(85, 185, 231, 0.65);
  --accent-wash: rgba(85, 185, 231, 0.16);
  --accent-wash-soft: rgba(85, 185, 231, 0.1);
  --accent-line: rgba(85, 185, 231, 0.5);
  --accent-line-soft: rgba(85, 185, 231, 0.32);
  --accent-glow: rgba(85, 185, 231, 0.3);
  --ok: #93bc9b;
  --ok-soft: #c5dfcb;
  --warn: #d5ae70;
  --danger: #d28b84;
  --knowledge: #a3c7c8;
  --knowledge-soft: rgba(163, 199, 200, 0.14);
  --file: #88a8c7;
  --file-soft: rgba(136, 168, 199, 0.14);
  --pause: #d5ae70;
  --pause-soft: rgba(213, 174, 112, 0.14);
  --pause-line: rgba(213, 174, 112, 0.32);
  --stop: #d28b84;
  --stop-soft: rgba(210, 139, 132, 0.14);
  --stop-line: rgba(210, 139, 132, 0.32);
  --resume: #93bc9b;
  --resume-soft: rgba(147, 188, 155, 0.14);
  --review: #afa1c4;
  --review-soft: rgba(175, 161, 196, 0.14);
}

.theme-light.saturation-standard.accent-ocean {
  --accent: #106d98;
  --accent-soft: #125777;
  --accent-gradient: linear-gradient(135deg, #187caa, #0e6086);
  --accent-wash-strong: rgba(16, 109, 152, 0.65);
  --accent-wash: rgba(16, 109, 152, 0.12);
  --accent-wash-soft: rgba(16, 109, 152, 0.07);
  --accent-line: rgba(16, 109, 152, 0.5);
  --accent-line-soft: rgba(16, 109, 152, 0.32);
  --accent-glow: rgba(16, 109, 152, 0.24);
  --ok: #4a7754;
  --ok-soft: #3b6044;
  --warn: #976d28;
  --danger: #ac504a;
  --knowledge: #477a7a;
  --knowledge-soft: rgba(71, 122, 122, 0.1);
  --file: #476b8d;
  --file-soft: rgba(71, 107, 141, 0.1);
  --pause: #976d28;
  --pause-soft: rgba(151, 109, 40, 0.1);
  --pause-line: rgba(151, 109, 40, 0.32);
  --stop: #ac504a;
  --stop-soft: rgba(172, 80, 74, 0.1);
  --stop-line: rgba(172, 80, 74, 0.32);
  --resume: #4a7754;
  --resume-soft: rgba(74, 119, 84, 0.1);
  --review: #6e5e87;
  --review-soft: rgba(110, 94, 135, 0.1);
}

.saturation-standard.accent-moss {
  --accent: #aad959;
  --accent-soft: #c5e887;
  --accent-gradient: linear-gradient(135deg, #b1d86f, #98d926);
  --accent-wash-strong: rgba(170, 217, 89, 0.65);
  --accent-wash: rgba(170, 217, 89, 0.16);
  --accent-wash-soft: rgba(170, 217, 89, 0.1);
  --accent-line: rgba(170, 217, 89, 0.5);
  --accent-line-soft: rgba(170, 217, 89, 0.32);
  --accent-glow: rgba(170, 217, 89, 0.3);
  --ok: #93bc9b;
  --ok-soft: #c5dfcb;
  --warn: #d5ae70;
  --danger: #d28b84;
  --knowledge: #a3c7c8;
  --knowledge-soft: rgba(163, 199, 200, 0.14);
  --file: #88a8c7;
  --file-soft: rgba(136, 168, 199, 0.14);
  --pause: #d5ae70;
  --pause-soft: rgba(213, 174, 112, 0.14);
  --pause-line: rgba(213, 174, 112, 0.32);
  --stop: #d28b84;
  --stop-soft: rgba(210, 139, 132, 0.14);
  --stop-line: rgba(210, 139, 132, 0.32);
  --resume: #93bc9b;
  --resume-soft: rgba(147, 188, 155, 0.14);
  --review: #afa1c4;
  --review-soft: rgba(175, 161, 196, 0.14);
}

.theme-light.saturation-standard.accent-moss {
  --accent: #5c801e;
  --accent-soft: #49631d;
  --accent-gradient: linear-gradient(135deg, #6a9027, #517416);
  --accent-wash-strong: rgba(92, 128, 30, 0.65);
  --accent-wash: rgba(92, 128, 30, 0.12);
  --accent-wash-soft: rgba(92, 128, 30, 0.07);
  --accent-line: rgba(92, 128, 30, 0.5);
  --accent-line-soft: rgba(92, 128, 30, 0.32);
  --accent-glow: rgba(92, 128, 30, 0.24);
  --ok: #4a7754;
  --ok-soft: #3b6044;
  --warn: #976d28;
  --danger: #ac504a;
  --knowledge: #477a7a;
  --knowledge-soft: rgba(71, 122, 122, 0.1);
  --file: #476b8d;
  --file-soft: rgba(71, 107, 141, 0.1);
  --pause: #976d28;
  --pause-soft: rgba(151, 109, 40, 0.1);
  --pause-line: rgba(151, 109, 40, 0.32);
  --stop: #ac504a;
  --stop-soft: rgba(172, 80, 74, 0.1);
  --stop-line: rgba(172, 80, 74, 0.32);
  --resume: #4a7754;
  --resume-soft: rgba(74, 119, 84, 0.1);
  --review: #6e5e87;
  --review-soft: rgba(110, 94, 135, 0.1);
}

.saturation-standard.accent-plum {
  --accent: #b37edd;
  --accent-soft: #d0abed;
  --accent-gradient: linear-gradient(135deg, #bd91de, #9d4ddb);
  --accent-wash-strong: rgba(179, 126, 221, 0.65);
  --accent-wash: rgba(179, 126, 221, 0.16);
  --accent-wash-soft: rgba(179, 126, 221, 0.1);
  --accent-line: rgba(179, 126, 221, 0.5);
  --accent-line-soft: rgba(179, 126, 221, 0.32);
  --accent-glow: rgba(179, 126, 221, 0.3);
  --ok: #93bc9b;
  --ok-soft: #c5dfcb;
  --warn: #d5ae70;
  --danger: #d28b84;
  --knowledge: #a3c7c8;
  --knowledge-soft: rgba(163, 199, 200, 0.14);
  --file: #88a8c7;
  --file-soft: rgba(136, 168, 199, 0.14);
  --pause: #d5ae70;
  --pause-soft: rgba(213, 174, 112, 0.14);
  --pause-line: rgba(213, 174, 112, 0.32);
  --stop: #d28b84;
  --stop-soft: rgba(210, 139, 132, 0.14);
  --stop-line: rgba(210, 139, 132, 0.32);
  --resume: #93bc9b;
  --resume-soft: rgba(147, 188, 155, 0.14);
  --review: #afa1c4;
  --review-soft: rgba(175, 161, 196, 0.14);
}

.theme-light.saturation-standard.accent-plum {
  --accent: #7839a8;
  --accent-soft: #663989;
  --accent-gradient: linear-gradient(135deg, #8545b4, #6e2e9e);
  --accent-wash-strong: rgba(120, 57, 168, 0.65);
  --accent-wash: rgba(120, 57, 168, 0.12);
  --accent-wash-soft: rgba(120, 57, 168, 0.07);
  --accent-line: rgba(120, 57, 168, 0.5);
  --accent-line-soft: rgba(120, 57, 168, 0.32);
  --accent-glow: rgba(120, 57, 168, 0.24);
  --ok: #4a7754;
  --ok-soft: #3b6044;
  --warn: #976d28;
  --danger: #ac504a;
  --knowledge: #477a7a;
  --knowledge-soft: rgba(71, 122, 122, 0.1);
  --file: #476b8d;
  --file-soft: rgba(71, 107, 141, 0.1);
  --pause: #976d28;
  --pause-soft: rgba(151, 109, 40, 0.1);
  --pause-line: rgba(151, 109, 40, 0.32);
  --stop: #ac504a;
  --stop-soft: rgba(172, 80, 74, 0.1);
  --stop-line: rgba(172, 80, 74, 0.32);
  --resume: #4a7754;
  --resume-soft: rgba(74, 119, 84, 0.1);
  --review: #6e5e87;
  --review-soft: rgba(110, 94, 135, 0.1);
}

.saturation-standard.accent-rose {
  --accent: #ea7b95;
  --accent-soft: #f5aebd;
  --accent-gradient: linear-gradient(135deg, #e990a4, #eb476d);
  --accent-wash-strong: rgba(234, 123, 149, 0.65);
  --accent-wash: rgba(234, 123, 149, 0.16);
  --accent-wash-soft: rgba(234, 123, 149, 0.1);
  --accent-line: rgba(234, 123, 149, 0.5);
  --accent-line-soft: rgba(234, 123, 149, 0.32);
  --accent-glow: rgba(234, 123, 149, 0.3);
  --ok: #93bc9b;
  --ok-soft: #c5dfcb;
  --warn: #d5ae70;
  --danger: #d28b84;
  --knowledge: #a3c7c8;
  --knowledge-soft: rgba(163, 199, 200, 0.14);
  --file: #88a8c7;
  --file-soft: rgba(136, 168, 199, 0.14);
  --pause: #d5ae70;
  --pause-soft: rgba(213, 174, 112, 0.14);
  --pause-line: rgba(213, 174, 112, 0.32);
  --stop: #d28b84;
  --stop-soft: rgba(210, 139, 132, 0.14);
  --stop-line: rgba(210, 139, 132, 0.32);
  --resume: #93bc9b;
  --resume-soft: rgba(147, 188, 155, 0.14);
  --review: #afa1c4;
  --review-soft: rgba(175, 161, 196, 0.14);
}

.theme-light.saturation-standard.accent-rose {
  --accent: #ae2d4b;
  --accent-soft: #8e2f45;
  --accent-gradient: linear-gradient(135deg, #bc3958, #a32441);
  --accent-wash-strong: rgba(174, 45, 75, 0.65);
  --accent-wash: rgba(174, 45, 75, 0.12);
  --accent-wash-soft: rgba(174, 45, 75, 0.07);
  --accent-line: rgba(174, 45, 75, 0.5);
  --accent-line-soft: rgba(174, 45, 75, 0.32);
  --accent-glow: rgba(174, 45, 75, 0.24);
  --ok: #4a7754;
  --ok-soft: #3b6044;
  --warn: #976d28;
  --danger: #ac504a;
  --knowledge: #477a7a;
  --knowledge-soft: rgba(71, 122, 122, 0.1);
  --file: #476b8d;
  --file-soft: rgba(71, 107, 141, 0.1);
  --pause: #976d28;
  --pause-soft: rgba(151, 109, 40, 0.1);
  --pause-line: rgba(151, 109, 40, 0.32);
  --stop: #ac504a;
  --stop-soft: rgba(172, 80, 74, 0.1);
  --stop-line: rgba(172, 80, 74, 0.32);
  --resume: #4a7754;
  --resume-soft: rgba(74, 119, 84, 0.1);
  --review: #6e5e87;
  --review-soft: rgba(110, 94, 135, 0.1);
}

.saturation-standard.accent-sand {
  --accent: #e5b962;
  --accent-soft: #f1d293;
  --accent-gradient: linear-gradient(135deg, #e3bf78, #e6a92d);
  --accent-wash-strong: rgba(229, 185, 98, 0.65);
  --accent-wash: rgba(229, 185, 98, 0.16);
  --accent-wash-soft: rgba(229, 185, 98, 0.1);
  --accent-line: rgba(229, 185, 98, 0.5);
  --accent-line-soft: rgba(229, 185, 98, 0.32);
  --accent-glow: rgba(229, 185, 98, 0.3);
  --ok: #93bc9b;
  --ok-soft: #c5dfcb;
  --warn: #d5ae70;
  --danger: #d28b84;
  --knowledge: #a3c7c8;
  --knowledge-soft: rgba(163, 199, 200, 0.14);
  --file: #88a8c7;
  --file-soft: rgba(136, 168, 199, 0.14);
  --pause: #d5ae70;
  --pause-soft: rgba(213, 174, 112, 0.14);
  --pause-line: rgba(213, 174, 112, 0.32);
  --stop: #d28b84;
  --stop-soft: rgba(210, 139, 132, 0.14);
  --stop-line: rgba(210, 139, 132, 0.32);
  --resume: #93bc9b;
  --resume-soft: rgba(147, 188, 155, 0.14);
  --review: #afa1c4;
  --review-soft: rgba(175, 161, 196, 0.14);
}

.theme-light.saturation-standard.accent-sand {
  --accent: #8f6614;
  --accent-soft: #6f5116;
  --accent-gradient: linear-gradient(135deg, #a0741c, #815a0e);
  --accent-wash-strong: rgba(143, 102, 20, 0.65);
  --accent-wash: rgba(143, 102, 20, 0.12);
  --accent-wash-soft: rgba(143, 102, 20, 0.07);
  --accent-line: rgba(143, 102, 20, 0.5);
  --accent-line-soft: rgba(143, 102, 20, 0.32);
  --accent-glow: rgba(143, 102, 20, 0.24);
  --ok: #4a7754;
  --ok-soft: #3b6044;
  --warn: #976d28;
  --danger: #ac504a;
  --knowledge: #477a7a;
  --knowledge-soft: rgba(71, 122, 122, 0.1);
  --file: #476b8d;
  --file-soft: rgba(71, 107, 141, 0.1);
  --pause: #976d28;
  --pause-soft: rgba(151, 109, 40, 0.1);
  --pause-line: rgba(151, 109, 40, 0.32);
  --stop: #ac504a;
  --stop-soft: rgba(172, 80, 74, 0.1);
  --stop-line: rgba(172, 80, 74, 0.32);
  --resume: #4a7754;
  --resume-soft: rgba(74, 119, 84, 0.1);
  --review: #6e5e87;
  --review-soft: rgba(110, 94, 135, 0.1);
}

.saturation-standard.accent-orange {
  --accent: #ff9d5d;
  --accent-soft: #ffba85;
  --accent-gradient: linear-gradient(135deg, #ffaf75, #f77329);
  --accent-wash-strong: rgba(255, 157, 93, 0.65);
  --accent-wash: rgba(255, 157, 93, 0.16);
  --accent-wash-soft: rgba(255, 157, 93, 0.1);
  --accent-line: rgba(255, 157, 93, 0.5);
  --accent-line-soft: rgba(255, 157, 93, 0.32);
  --accent-glow: rgba(255, 157, 93, 0.3);
  --ok: #93bc9b;
  --ok-soft: #c5dfcb;
  --warn: #d5ae70;
  --danger: #d28b84;
  --knowledge: #a3c7c8;
  --knowledge-soft: rgba(163, 199, 200, 0.14);
  --file: #88a8c7;
  --file-soft: rgba(136, 168, 199, 0.14);
  --pause: #d5ae70;
  --pause-soft: rgba(213, 174, 112, 0.14);
  --pause-line: rgba(213, 174, 112, 0.32);
  --stop: #d28b84;
  --stop-soft: rgba(210, 139, 132, 0.14);
  --stop-line: rgba(210, 139, 132, 0.32);
  --resume: #93bc9b;
  --resume-soft: rgba(147, 188, 155, 0.14);
  --review: #afa1c4;
  --review-soft: rgba(175, 161, 196, 0.14);
}

.theme-light.saturation-standard.accent-orange {
  --accent: #c15500;
  --accent-soft: #d86000;
  --accent-gradient: linear-gradient(135deg, #dd6606, #a54500);
  --accent-wash-strong: rgba(193, 85, 0, 0.65);
  --accent-wash: rgba(193, 85, 0, 0.12);
  --accent-wash-soft: rgba(193, 85, 0, 0.07);
  --accent-line: rgba(193, 85, 0, 0.5);
  --accent-line-soft: rgba(193, 85, 0, 0.32);
  --accent-glow: rgba(193, 85, 0, 0.24);
  --ok: #4a7754;
  --ok-soft: #3b6044;
  --warn: #976d28;
  --danger: #ac504a;
  --knowledge: #477a7a;
  --knowledge-soft: rgba(71, 122, 122, 0.1);
  --file: #476b8d;
  --file-soft: rgba(71, 107, 141, 0.1);
  --pause: #976d28;
  --pause-soft: rgba(151, 109, 40, 0.1);
  --pause-line: rgba(151, 109, 40, 0.32);
  --stop: #ac504a;
  --stop-soft: rgba(172, 80, 74, 0.1);
  --stop-line: rgba(172, 80, 74, 0.32);
  --resume: #4a7754;
  --resume-soft: rgba(74, 119, 84, 0.1);
  --review: #6e5e87;
  --review-soft: rgba(110, 94, 135, 0.1);
}

.saturation-standard.accent-celadon {
  --accent: #4ed8ce;
  --accent-soft: #83eae1;
  --accent-gradient: linear-gradient(135deg, #66e0d7, #2ac7bd);
  --accent-wash-strong: rgba(78, 216, 206, 0.65);
  --accent-wash: rgba(78, 216, 206, 0.16);
  --accent-wash-soft: rgba(78, 216, 206, 0.1);
  --accent-line: rgba(78, 216, 206, 0.5);
  --accent-line-soft: rgba(78, 216, 206, 0.32);
  --accent-glow: rgba(78, 216, 206, 0.3);
  --ok: #93bc9b;
  --ok-soft: #c5dfcb;
  --warn: #d5ae70;
  --danger: #d28b84;
  --knowledge: #a3c7c8;
  --knowledge-soft: rgba(163, 199, 200, 0.14);
  --file: #88a8c7;
  --file-soft: rgba(136, 168, 199, 0.14);
  --pause: #d5ae70;
  --pause-soft: rgba(213, 174, 112, 0.14);
  --pause-line: rgba(213, 174, 112, 0.32);
  --stop: #d28b84;
  --stop-soft: rgba(210, 139, 132, 0.14);
  --stop-line: rgba(210, 139, 132, 0.32);
  --resume: #93bc9b;
  --resume-soft: rgba(147, 188, 155, 0.14);
  --review: #afa1c4;
  --review-soft: rgba(175, 161, 196, 0.14);
}

.theme-light.saturation-standard.accent-celadon {
  --accent: #21817b;
  --accent-soft: #1d6862;
  --accent-gradient: linear-gradient(135deg, #289088, #1d6d67);
  --accent-wash-strong: rgba(33, 129, 123, 0.65);
  --accent-wash: rgba(33, 129, 123, 0.12);
  --accent-wash-soft: rgba(33, 129, 123, 0.07);
  --accent-line: rgba(33, 129, 123, 0.5);
  --accent-line-soft: rgba(33, 129, 123, 0.32);
  --accent-glow: rgba(33, 129, 123, 0.24);
  --ok: #4a7754;
  --ok-soft: #3b6044;
  --warn: #976d28;
  --danger: #ac504a;
  --knowledge: #477a7a;
  --knowledge-soft: rgba(71, 122, 122, 0.1);
  --file: #476b8d;
  --file-soft: rgba(71, 107, 141, 0.1);
  --pause: #976d28;
  --pause-soft: rgba(151, 109, 40, 0.1);
  --pause-line: rgba(151, 109, 40, 0.32);
  --stop: #ac504a;
  --stop-soft: rgba(172, 80, 74, 0.1);
  --stop-line: rgba(172, 80, 74, 0.32);
  --resume: #4a7754;
  --resume-soft: rgba(74, 119, 84, 0.1);
  --review: #6e5e87;
  --review-soft: rgba(110, 94, 135, 0.1);
}

.saturation-standard.accent-claude {
  --accent: #ec6d44;
  --accent-soft: #f48660;
  --accent-gradient: linear-gradient(135deg, #f28259, #d55628);
  --accent-wash-strong: rgba(236, 109, 68, 0.65);
  --accent-wash: rgba(236, 109, 68, 0.14);
  --accent-wash-soft: rgba(236, 109, 68, 0.08);
  --accent-line: rgba(236, 109, 68, 0.45);
  --accent-line-soft: rgba(236, 109, 68, 0.28);
  --accent-glow: rgba(236, 109, 68, 0.26);
  --ok: #93bc9b;
  --ok-soft: #c5dfcb;
  --warn: #d5ae70;
  --danger: #d28b84;
  --knowledge: #a3c7c8;
  --knowledge-soft: rgba(163, 199, 200, 0.14);
  --file: #88a8c7;
  --file-soft: rgba(136, 168, 199, 0.14);
  --pause: #d5ae70;
  --pause-soft: rgba(213, 174, 112, 0.14);
  --pause-line: rgba(213, 174, 112, 0.32);
  --stop: #d28b84;
  --stop-soft: rgba(210, 139, 132, 0.14);
  --stop-line: rgba(210, 139, 132, 0.32);
  --resume: #93bc9b;
  --resume-soft: rgba(147, 188, 155, 0.14);
  --review: #afa1c4;
  --review-soft: rgba(175, 161, 196, 0.14);
}

.theme-light.saturation-standard.accent-claude {
  --accent: #c84a1b;
  --accent-soft: #bb451d;
  --accent-gradient: linear-gradient(135deg, #d55628, #bb451d);
  --accent-wash-strong: rgba(213, 86, 40, 0.65);
  --accent-wash: rgba(213, 86, 40, 0.1);
  --accent-wash-soft: rgba(213, 86, 40, 0.06);
  --accent-line: rgba(213, 86, 40, 0.45);
  --accent-line-soft: rgba(213, 86, 40, 0.28);
  --accent-glow: rgba(213, 86, 40, 0.22);
  --ok: #4a7754;
  --ok-soft: #3b6044;
  --warn: #976d28;
  --danger: #ac504a;
  --knowledge: #477a7a;
  --knowledge-soft: rgba(71, 122, 122, 0.1);
  --file: #476b8d;
  --file-soft: rgba(71, 107, 141, 0.1);
  --pause: #976d28;
  --pause-soft: rgba(151, 109, 40, 0.1);
  --pause-line: rgba(151, 109, 40, 0.32);
  --stop: #ac504a;
  --stop-soft: rgba(172, 80, 74, 0.1);
  --stop-line: rgba(172, 80, 74, 0.32);
  --resume: #4a7754;
  --resume-soft: rgba(74, 119, 84, 0.1);
  --review: #6e5e87;
  --review-soft: rgba(110, 94, 135, 0.1);
}

.saturation-low {
  --accent: #ffffff;
  --accent-soft: #ffffff;
  --accent-gradient: linear-gradient(135deg, #ffffff, #bdbdbd);
  --accent-wash-strong: rgba(255, 255, 255, 0.65);
  --accent-wash: rgba(255, 255, 255, 0.14);
  --accent-wash-soft: rgba(255, 255, 255, 0.08);
  --accent-line: rgba(255, 255, 255, 0.45);
  --accent-line-soft: rgba(255, 255, 255, 0.28);
  --accent-glow: rgba(255, 255, 255, 0.26);
  --ok: #9db2a1;
  --ok-soft: #cbd9cf;
  --warn: #bca889;
  --danger: #bf9b98;
  --knowledge: #acbebf;
  --knowledge-soft: rgba(172, 190, 191, 0.14);
  --file: #98a8b7;
  --file-soft: rgba(152, 168, 183, 0.14);
  --pause: #bca889;
  --pause-soft: rgba(188, 168, 137, 0.14);
  --pause-line: rgba(188, 168, 137, 0.32);
  --stop: #bf9b98;
  --stop-soft: rgba(191, 155, 152, 0.14);
  --stop-line: rgba(191, 155, 152, 0.32);
  --resume: #9db2a1;
  --resume-soft: rgba(157, 178, 161, 0.14);
  --review: #b1aabb;
  --review-soft: rgba(177, 170, 187, 0.14);
}

.theme-light.saturation-low {
  --accent: #000000;
  --accent-soft: #000000;
  --accent-gradient: linear-gradient(135deg, #000000, #333333);
  --accent-wash-strong: rgba(0, 0, 0, 0.65);
  --accent-wash: rgba(0, 0, 0, 0.1);
  --accent-wash-soft: rgba(0, 0, 0, 0.06);
  --accent-line: rgba(0, 0, 0, 0.45);
  --accent-line-soft: rgba(0, 0, 0, 0.28);
  --accent-glow: rgba(0, 0, 0, 0.22);
  --ok: #556c5a;
  --ok-soft: #445749;
  --warn: #7b6644;
  --danger: #946662;
  --knowledge: #546d6d;
  --knowledge-soft: rgba(84, 109, 109, 0.1);
  --file: #586b7c;
  --file-soft: rgba(88, 107, 124, 0.1);
  --pause: #7b6644;
  --pause-soft: rgba(123, 102, 68, 0.1);
  --pause-line: rgba(123, 102, 68, 0.32);
  --stop: #946662;
  --stop-soft: rgba(148, 102, 98, 0.1);
  --stop-line: rgba(148, 102, 98, 0.32);
  --resume: #556c5a;
  --resume-soft: rgba(85, 108, 90, 0.1);
  --review: #70687d;
  --review-soft: rgba(112, 104, 125, 0.1);
}

.saturation-low.accent-pine {
  --accent: #88b9a1;
  --accent-soft: #add1bf;
  --accent-gradient: linear-gradient(135deg, #98bfab, #63ab87);
  --accent-wash-strong: rgba(136, 185, 161, 0.65);
  --accent-wash: rgba(136, 185, 161, 0.16);
  --accent-wash-soft: rgba(136, 185, 161, 0.1);
  --accent-line: rgba(136, 185, 161, 0.5);
  --accent-line-soft: rgba(136, 185, 161, 0.32);
  --accent-glow: rgba(136, 185, 161, 0.3);
  --ok: #9db2a1;
  --ok-soft: #cbd9cf;
  --warn: #bca889;
  --danger: #bf9b98;
  --knowledge: #acbebf;
  --knowledge-soft: rgba(172, 190, 191, 0.14);
  --file: #98a8b7;
  --file-soft: rgba(152, 168, 183, 0.14);
  --pause: #bca889;
  --pause-soft: rgba(188, 168, 137, 0.14);
  --pause-line: rgba(188, 168, 137, 0.32);
  --stop: #bf9b98;
  --stop-soft: rgba(191, 155, 152, 0.14);
  --stop-line: rgba(191, 155, 152, 0.32);
  --resume: #9db2a1;
  --resume-soft: rgba(157, 178, 161, 0.14);
  --review: #b1aabb;
  --review-soft: rgba(177, 170, 187, 0.14);
}

.theme-light.saturation-low.accent-pine {
  --accent: #3d6b54;
  --accent-soft: #355545;
  --accent-gradient: linear-gradient(135deg, #497961, #34604a);
  --accent-wash-strong: rgba(61, 107, 84, 0.65);
  --accent-wash: rgba(61, 107, 84, 0.12);
  --accent-wash-soft: rgba(61, 107, 84, 0.07);
  --accent-line: rgba(61, 107, 84, 0.5);
  --accent-line-soft: rgba(61, 107, 84, 0.32);
  --accent-glow: rgba(61, 107, 84, 0.24);
  --ok: #556c5a;
  --ok-soft: #445749;
  --warn: #7b6644;
  --danger: #946662;
  --knowledge: #546d6d;
  --knowledge-soft: rgba(84, 109, 109, 0.1);
  --file: #586b7c;
  --file-soft: rgba(88, 107, 124, 0.1);
  --pause: #7b6644;
  --pause-soft: rgba(123, 102, 68, 0.1);
  --pause-line: rgba(123, 102, 68, 0.32);
  --stop: #946662;
  --stop-soft: rgba(148, 102, 98, 0.1);
  --stop-line: rgba(148, 102, 98, 0.32);
  --resume: #556c5a;
  --resume-soft: rgba(85, 108, 90, 0.1);
  --review: #70687d;
  --review-soft: rgba(112, 104, 125, 0.1);
}

.saturation-low.accent-indigo {
  --accent: #93a1c8;
  --accent-soft: #bac4de;
  --accent-gradient: linear-gradient(135deg, #a2adcd, #6d82bb);
  --accent-wash-strong: rgba(147, 161, 200, 0.65);
  --accent-wash: rgba(147, 161, 200, 0.16);
  --accent-wash-soft: rgba(147, 161, 200, 0.1);
  --accent-line: rgba(147, 161, 200, 0.5);
  --accent-line-soft: rgba(147, 161, 200, 0.32);
  --accent-glow: rgba(147, 161, 200, 0.3);
  --ok: #9db2a1;
  --ok-soft: #cbd9cf;
  --warn: #bca889;
  --danger: #bf9b98;
  --knowledge: #acbebf;
  --knowledge-soft: rgba(172, 190, 191, 0.14);
  --file: #98a8b7;
  --file-soft: rgba(152, 168, 183, 0.14);
  --pause: #bca889;
  --pause-soft: rgba(188, 168, 137, 0.14);
  --pause-line: rgba(188, 168, 137, 0.32);
  --stop: #bf9b98;
  --stop-soft: rgba(191, 155, 152, 0.14);
  --stop-line: rgba(191, 155, 152, 0.32);
  --resume: #9db2a1;
  --resume-soft: rgba(157, 178, 161, 0.14);
  --review: #b1aabb;
  --review-soft: rgba(177, 170, 187, 0.14);
}

.theme-light.saturation-low.accent-indigo {
  --accent: #455582;
  --accent-soft: #3d4a6b;
  --accent-gradient: linear-gradient(135deg, #506191, #3b4c78);
  --accent-wash-strong: rgba(69, 85, 130, 0.65);
  --accent-wash: rgba(69, 85, 130, 0.12);
  --accent-wash-soft: rgba(69, 85, 130, 0.07);
  --accent-line: rgba(69, 85, 130, 0.5);
  --accent-line-soft: rgba(69, 85, 130, 0.32);
  --accent-glow: rgba(69, 85, 130, 0.24);
  --ok: #556c5a;
  --ok-soft: #445749;
  --warn: #7b6644;
  --danger: #946662;
  --knowledge: #546d6d;
  --knowledge-soft: rgba(84, 109, 109, 0.1);
  --file: #586b7c;
  --file-soft: rgba(88, 107, 124, 0.1);
  --pause: #7b6644;
  --pause-soft: rgba(123, 102, 68, 0.1);
  --pause-line: rgba(123, 102, 68, 0.32);
  --stop: #946662;
  --stop-soft: rgba(148, 102, 98, 0.1);
  --stop-line: rgba(148, 102, 98, 0.32);
  --resume: #556c5a;
  --resume-soft: rgba(85, 108, 90, 0.1);
  --review: #70687d;
  --review-soft: rgba(112, 104, 125, 0.1);
}

.saturation-low.accent-clay {
  --accent: #c19e85;
  --accent-soft: #d7bead;
  --accent-gradient: linear-gradient(135deg, #c6a995, #b4835f);
  --accent-wash-strong: rgba(193, 158, 133, 0.65);
  --accent-wash: rgba(193, 158, 133, 0.16);
  --accent-wash-soft: rgba(193, 158, 133, 0.1);
  --accent-line: rgba(193, 158, 133, 0.5);
  --accent-line-soft: rgba(193, 158, 133, 0.32);
  --accent-glow: rgba(193, 158, 133, 0.3);
  --ok: #9db2a1;
  --ok-soft: #cbd9cf;
  --warn: #bca889;
  --danger: #bf9b98;
  --knowledge: #acbebf;
  --knowledge-soft: rgba(172, 190, 191, 0.14);
  --file: #98a8b7;
  --file-soft: rgba(152, 168, 183, 0.14);
  --pause: #bca889;
  --pause-soft: rgba(188, 168, 137, 0.14);
  --pause-line: rgba(188, 168, 137, 0.32);
  --stop: #bf9b98;
  --stop-soft: rgba(191, 155, 152, 0.14);
  --stop-line: rgba(191, 155, 152, 0.32);
  --resume: #9db2a1;
  --resume-soft: rgba(157, 178, 161, 0.14);
  --review: #b1aabb;
  --review-soft: rgba(177, 170, 187, 0.14);
}

.theme-light.saturation-low.accent-clay {
  --accent: #7f5c42;
  --accent-soft: #684e3b;
  --accent-gradient: linear-gradient(135deg, #8d694e, #74523a);
  --accent-wash-strong: rgba(127, 92, 66, 0.65);
  --accent-wash: rgba(127, 92, 66, 0.12);
  --accent-wash-soft: rgba(127, 92, 66, 0.07);
  --accent-line: rgba(127, 92, 66, 0.5);
  --accent-line-soft: rgba(127, 92, 66, 0.32);
  --accent-glow: rgba(127, 92, 66, 0.24);
  --ok: #556c5a;
  --ok-soft: #445749;
  --warn: #7b6644;
  --danger: #946662;
  --knowledge: #546d6d;
  --knowledge-soft: rgba(84, 109, 109, 0.1);
  --file: #586b7c;
  --file-soft: rgba(88, 107, 124, 0.1);
  --pause: #7b6644;
  --pause-soft: rgba(123, 102, 68, 0.1);
  --pause-line: rgba(123, 102, 68, 0.32);
  --stop: #946662;
  --stop-soft: rgba(148, 102, 98, 0.1);
  --stop-line: rgba(148, 102, 98, 0.32);
  --resume: #556c5a;
  --resume-soft: rgba(85, 108, 90, 0.1);
  --review: #70687d;
  --review-soft: rgba(112, 104, 125, 0.1);
}

.saturation-low.accent-ocean {
  --accent: #7aacc2;
  --accent-soft: #a3c6d6;
  --accent-gradient: linear-gradient(135deg, #89b3c7, #5396b6);
  --accent-wash-strong: rgba(122, 172, 194, 0.65);
  --accent-wash: rgba(122, 172, 194, 0.16);
  --accent-wash-soft: rgba(122, 172, 194, 0.1);
  --accent-line: rgba(122, 172, 194, 0.5);
  --accent-line-soft: rgba(122, 172, 194, 0.32);
  --accent-glow: rgba(122, 172, 194, 0.3);
  --ok: #9db2a1;
  --ok-soft: #cbd9cf;
  --warn: #bca889;
  --danger: #bf9b98;
  --knowledge: #acbebf;
  --knowledge-soft: rgba(172, 190, 191, 0.14);
  --file: #98a8b7;
  --file-soft: rgba(152, 168, 183, 0.14);
  --pause: #bca889;
  --pause-soft: rgba(188, 168, 137, 0.14);
  --pause-line: rgba(188, 168, 137, 0.32);
  --stop: #bf9b98;
  --stop-soft: rgba(191, 155, 152, 0.14);
  --stop-line: rgba(191, 155, 152, 0.32);
  --resume: #9db2a1;
  --resume-soft: rgba(157, 178, 161, 0.14);
  --review: #b1aabb;
  --review-soft: rgba(177, 170, 187, 0.14);
}

.theme-light.saturation-low.accent-ocean {
  --accent: #326076;
  --accent-soft: #2b4e5e;
  --accent-gradient: linear-gradient(135deg, #3d6f85, #2c5568);
  --accent-wash-strong: rgba(50, 96, 118, 0.65);
  --accent-wash: rgba(50, 96, 118, 0.12);
  --accent-wash-soft: rgba(50, 96, 118, 0.07);
  --accent-line: rgba(50, 96, 118, 0.5);
  --accent-line-soft: rgba(50, 96, 118, 0.32);
  --accent-glow: rgba(50, 96, 118, 0.24);
  --ok: #556c5a;
  --ok-soft: #445749;
  --warn: #7b6644;
  --danger: #946662;
  --knowledge: #546d6d;
  --knowledge-soft: rgba(84, 109, 109, 0.1);
  --file: #586b7c;
  --file-soft: rgba(88, 107, 124, 0.1);
  --pause: #7b6644;
  --pause-soft: rgba(123, 102, 68, 0.1);
  --pause-line: rgba(123, 102, 68, 0.32);
  --stop: #946662;
  --stop-soft: rgba(148, 102, 98, 0.1);
  --stop-line: rgba(148, 102, 98, 0.32);
  --resume: #556c5a;
  --resume-soft: rgba(85, 108, 90, 0.1);
  --review: #70687d;
  --review-soft: rgba(112, 104, 125, 0.1);
}

.saturation-low.accent-moss {
  --accent: #a1b979;
  --accent-soft: #bed09f;
  --accent-gradient: linear-gradient(135deg, #aabe89, #8cac53);
  --accent-wash-strong: rgba(161, 185, 121, 0.65);
  --accent-wash: rgba(161, 185, 121, 0.16);
  --accent-wash-soft: rgba(161, 185, 121, 0.1);
  --accent-line: rgba(161, 185, 121, 0.5);
  --accent-line-soft: rgba(161, 185, 121, 0.32);
  --accent-glow: rgba(161, 185, 121, 0.3);
  --ok: #9db2a1;
  --ok-soft: #cbd9cf;
  --warn: #bca889;
  --danger: #bf9b98;
  --knowledge: #acbebf;
  --knowledge-soft: rgba(172, 190, 191, 0.14);
  --file: #98a8b7;
  --file-soft: rgba(152, 168, 183, 0.14);
  --pause: #bca889;
  --pause-soft: rgba(188, 168, 137, 0.14);
  --pause-line: rgba(188, 168, 137, 0.32);
  --stop: #bf9b98;
  --stop-soft: rgba(191, 155, 152, 0.14);
  --stop-line: rgba(191, 155, 152, 0.32);
  --resume: #9db2a1;
  --resume-soft: rgba(157, 178, 161, 0.14);
  --review: #b1aabb;
  --review-soft: rgba(177, 170, 187, 0.14);
}

.theme-light.saturation-low.accent-moss {
  --accent: #566836;
  --accent-soft: #45522e;
  --accent-gradient: linear-gradient(135deg, #637641, #4b5c2e);
  --accent-wash-strong: rgba(86, 104, 54, 0.65);
  --accent-wash: rgba(86, 104, 54, 0.12);
  --accent-wash-soft: rgba(86, 104, 54, 0.07);
  --accent-line: rgba(86, 104, 54, 0.5);
  --accent-line-soft: rgba(86, 104, 54, 0.32);
  --accent-glow: rgba(86, 104, 54, 0.24);
  --ok: #556c5a;
  --ok-soft: #445749;
  --warn: #7b6644;
  --danger: #946662;
  --knowledge: #546d6d;
  --knowledge-soft: rgba(84, 109, 109, 0.1);
  --file: #586b7c;
  --file-soft: rgba(88, 107, 124, 0.1);
  --pause: #7b6644;
  --pause-soft: rgba(123, 102, 68, 0.1);
  --pause-line: rgba(123, 102, 68, 0.32);
  --stop: #946662;
  --stop-soft: rgba(148, 102, 98, 0.1);
  --stop-line: rgba(148, 102, 98, 0.32);
  --resume: #556c5a;
  --resume-soft: rgba(85, 108, 90, 0.1);
  --review: #70687d;
  --review-soft: rgba(112, 104, 125, 0.1);
}

.saturation-low.accent-plum {
  --accent: #b096c5;
  --accent-soft: #cebcdc;
  --accent-gradient: linear-gradient(135deg, #baa4cb, #9970b8);
  --accent-wash-strong: rgba(176, 150, 197, 0.65);
  --accent-wash: rgba(176, 150, 197, 0.16);
  --accent-wash-soft: rgba(176, 150, 197, 0.1);
  --accent-line: rgba(176, 150, 197, 0.5);
  --accent-line-soft: rgba(176, 150, 197, 0.32);
  --accent-glow: rgba(176, 150, 197, 0.3);
  --ok: #9db2a1;
  --ok-soft: #cbd9cf;
  --warn: #bca889;
  --danger: #bf9b98;
  --knowledge: #acbebf;
  --knowledge-soft: rgba(172, 190, 191, 0.14);
  --file: #98a8b7;
  --file-soft: rgba(152, 168, 183, 0.14);
  --pause: #bca889;
  --pause-soft: rgba(188, 168, 137, 0.14);
  --pause-line: rgba(188, 168, 137, 0.32);
  --stop: #bf9b98;
  --stop-soft: rgba(191, 155, 152, 0.14);
  --stop-line: rgba(191, 155, 152, 0.32);
  --resume: #9db2a1;
  --resume-soft: rgba(157, 178, 161, 0.14);
  --review: #b1aabb;
  --review-soft: rgba(177, 170, 187, 0.14);
}

.theme-light.saturation-low.accent-plum {
  --accent: #74558c;
  --accent-soft: #644d75;
  --accent-gradient: linear-gradient(135deg, #816198, #6a4a82);
  --accent-wash-strong: rgba(116, 85, 140, 0.65);
  --accent-wash: rgba(116, 85, 140, 0.12);
  --accent-wash-soft: rgba(116, 85, 140, 0.07);
  --accent-line: rgba(116, 85, 140, 0.5);
  --accent-line-soft: rgba(116, 85, 140, 0.32);
  --accent-glow: rgba(116, 85, 140, 0.24);
  --ok: #556c5a;
  --ok-soft: #445749;
  --warn: #7b6644;
  --danger: #946662;
  --knowledge: #546d6d;
  --knowledge-soft: rgba(84, 109, 109, 0.1);
  --file: #586b7c;
  --file-soft: rgba(88, 107, 124, 0.1);
  --pause: #7b6644;
  --pause-soft: rgba(123, 102, 68, 0.1);
  --pause-line: rgba(123, 102, 68, 0.32);
  --stop: #946662;
  --stop-soft: rgba(148, 102, 98, 0.1);
  --stop-line: rgba(148, 102, 98, 0.32);
  --resume: #556c5a;
  --resume-soft: rgba(85, 108, 90, 0.1);
  --review: #70687d;
  --review-soft: rgba(112, 104, 125, 0.1);
}

.saturation-low.accent-rose {
  --accent: #ce97a4;
  --accent-soft: #e3c0c7;
  --accent-gradient: linear-gradient(135deg, #d3a6b0, #c27083);
  --accent-wash-strong: rgba(206, 151, 164, 0.65);
  --accent-wash: rgba(206, 151, 164, 0.16);
  --accent-wash-soft: rgba(206, 151, 164, 0.1);
  --accent-line: rgba(206, 151, 164, 0.5);
  --accent-line-soft: rgba(206, 151, 164, 0.32);
  --accent-glow: rgba(206, 151, 164, 0.3);
  --ok: #9db2a1;
  --ok-soft: #cbd9cf;
  --warn: #bca889;
  --danger: #bf9b98;
  --knowledge: #acbebf;
  --knowledge-soft: rgba(172, 190, 191, 0.14);
  --file: #98a8b7;
  --file-soft: rgba(152, 168, 183, 0.14);
  --pause: #bca889;
  --pause-soft: rgba(188, 168, 137, 0.14);
  --pause-line: rgba(188, 168, 137, 0.32);
  --stop: #bf9b98;
  --stop-soft: rgba(191, 155, 152, 0.14);
  --stop-line: rgba(191, 155, 152, 0.32);
  --resume: #9db2a1;
  --resume-soft: rgba(157, 178, 161, 0.14);
  --review: #b1aabb;
  --review-soft: rgba(177, 170, 187, 0.14);
}

.theme-light.saturation-low.accent-rose {
  --accent: #8e4d5c;
  --accent-soft: #764752;
  --accent-gradient: linear-gradient(135deg, #9b5a69, #834452);
  --accent-wash-strong: rgba(142, 77, 92, 0.65);
  --accent-wash: rgba(142, 77, 92, 0.12);
  --accent-wash-soft: rgba(142, 77, 92, 0.07);
  --accent-line: rgba(142, 77, 92, 0.5);
  --accent-line-soft: rgba(142, 77, 92, 0.32);
  --accent-glow: rgba(142, 77, 92, 0.24);
  --ok: #556c5a;
  --ok-soft: #445749;
  --warn: #7b6644;
  --danger: #946662;
  --knowledge: #546d6d;
  --knowledge-soft: rgba(84, 109, 109, 0.1);
  --file: #586b7c;
  --file-soft: rgba(88, 107, 124, 0.1);
  --pause: #7b6644;
  --pause-soft: rgba(123, 102, 68, 0.1);
  --pause-line: rgba(123, 102, 68, 0.32);
  --stop: #946662;
  --stop-soft: rgba(148, 102, 98, 0.1);
  --stop-line: rgba(148, 102, 98, 0.32);
  --resume: #556c5a;
  --resume-soft: rgba(85, 108, 90, 0.1);
  --review: #70687d;
  --review-soft: rgba(112, 104, 125, 0.1);
}

.saturation-low.accent-sand {
  --accent: #c4ae83;
  --accent-soft: #d9caab;
  --accent-gradient: linear-gradient(135deg, #c8b693, #b8995b);
  --accent-wash-strong: rgba(196, 174, 131, 0.65);
  --accent-wash: rgba(196, 174, 131, 0.16);
  --accent-wash-soft: rgba(196, 174, 131, 0.1);
  --accent-line: rgba(196, 174, 131, 0.5);
  --accent-line-soft: rgba(196, 174, 131, 0.32);
  --accent-glow: rgba(196, 174, 131, 0.3);
  --ok: #9db2a1;
  --ok-soft: #cbd9cf;
  --warn: #bca889;
  --danger: #bf9b98;
  --knowledge: #acbebf;
  --knowledge-soft: rgba(172, 190, 191, 0.14);
  --file: #98a8b7;
  --file-soft: rgba(152, 168, 183, 0.14);
  --pause: #bca889;
  --pause-soft: rgba(188, 168, 137, 0.14);
  --pause-line: rgba(188, 168, 137, 0.32);
  --stop: #bf9b98;
  --stop-soft: rgba(191, 155, 152, 0.14);
  --stop-line: rgba(191, 155, 152, 0.32);
  --resume: #9db2a1;
  --resume-soft: rgba(157, 178, 161, 0.14);
  --review: #b1aabb;
  --review-soft: rgba(177, 170, 187, 0.14);
}

.theme-light.saturation-low.accent-sand {
  --accent: #705c33;
  --accent-soft: #594a2c;
  --accent-gradient: linear-gradient(135deg, #7f693d, #64512b);
  --accent-wash-strong: rgba(112, 92, 51, 0.65);
  --accent-wash: rgba(112, 92, 51, 0.12);
  --accent-wash-soft: rgba(112, 92, 51, 0.07);
  --accent-line: rgba(112, 92, 51, 0.5);
  --accent-line-soft: rgba(112, 92, 51, 0.32);
  --accent-glow: rgba(112, 92, 51, 0.24);
  --ok: #556c5a;
  --ok-soft: #445749;
  --warn: #7b6644;
  --danger: #946662;
  --knowledge: #546d6d;
  --knowledge-soft: rgba(84, 109, 109, 0.1);
  --file: #586b7c;
  --file-soft: rgba(88, 107, 124, 0.1);
  --pause: #7b6644;
  --pause-soft: rgba(123, 102, 68, 0.1);
  --pause-line: rgba(123, 102, 68, 0.32);
  --stop: #946662;
  --stop-soft: rgba(148, 102, 98, 0.1);
  --stop-line: rgba(148, 102, 98, 0.32);
  --resume: #556c5a;
  --resume-soft: rgba(85, 108, 90, 0.1);
  --review: #70687d;
  --review-soft: rgba(112, 104, 125, 0.1);
}

.saturation-low.accent-orange {
  --accent: #daa582;
  --accent-soft: #e4bda0;
  --accent-gradient: linear-gradient(135deg, #e2b392, #c3825d);
  --accent-wash-strong: rgba(218, 165, 130, 0.65);
  --accent-wash: rgba(218, 165, 130, 0.16);
  --accent-wash-soft: rgba(218, 165, 130, 0.1);
  --accent-line: rgba(218, 165, 130, 0.5);
  --accent-line-soft: rgba(218, 165, 130, 0.32);
  --accent-glow: rgba(218, 165, 130, 0.3);
  --ok: #9db2a1;
  --ok-soft: #cbd9cf;
  --warn: #bca889;
  --danger: #bf9b98;
  --knowledge: #acbebf;
  --knowledge-soft: rgba(172, 190, 191, 0.14);
  --file: #98a8b7;
  --file-soft: rgba(152, 168, 183, 0.14);
  --pause: #bca889;
  --pause-soft: rgba(188, 168, 137, 0.14);
  --pause-line: rgba(188, 168, 137, 0.32);
  --stop: #bf9b98;
  --stop-soft: rgba(191, 155, 152, 0.14);
  --stop-line: rgba(191, 155, 152, 0.32);
  --resume: #9db2a1;
  --resume-soft: rgba(157, 178, 161, 0.14);
  --review: #b1aabb;
  --review-soft: rgba(177, 170, 187, 0.14);
}

.theme-light.saturation-low.accent-orange {
  --accent: #955a2c;
  --accent-soft: #a36635;
  --accent-gradient: linear-gradient(135deg, #a76c3c, #824b23);
  --accent-wash-strong: rgba(149, 90, 44, 0.65);
  --accent-wash: rgba(149, 90, 44, 0.12);
  --accent-wash-soft: rgba(149, 90, 44, 0.07);
  --accent-line: rgba(149, 90, 44, 0.5);
  --accent-line-soft: rgba(149, 90, 44, 0.32);
  --accent-glow: rgba(149, 90, 44, 0.24);
  --ok: #556c5a;
  --ok-soft: #445749;
  --warn: #7b6644;
  --danger: #946662;
  --knowledge: #546d6d;
  --knowledge-soft: rgba(84, 109, 109, 0.1);
  --file: #586b7c;
  --file-soft: rgba(88, 107, 124, 0.1);
  --pause: #7b6644;
  --pause-soft: rgba(123, 102, 68, 0.1);
  --pause-line: rgba(123, 102, 68, 0.32);
  --stop: #946662;
  --stop-soft: rgba(148, 102, 98, 0.1);
  --stop-line: rgba(148, 102, 98, 0.32);
  --resume: #556c5a;
  --resume-soft: rgba(85, 108, 90, 0.1);
  --review: #70687d;
  --review-soft: rgba(112, 104, 125, 0.1);
}

.saturation-low.accent-celadon {
  --accent: #71b5b0;
  --accent-soft: #9dd0cc;
  --accent-gradient: linear-gradient(135deg, #84c2bd, #51a09b);
  --accent-wash-strong: rgba(113, 181, 176, 0.65);
  --accent-wash: rgba(113, 181, 176, 0.16);
  --accent-wash-soft: rgba(113, 181, 176, 0.1);
  --accent-line: rgba(113, 181, 176, 0.5);
  --accent-line-soft: rgba(113, 181, 176, 0.32);
  --accent-glow: rgba(113, 181, 176, 0.3);
  --ok: #9db2a1;
  --ok-soft: #cbd9cf;
  --warn: #bca889;
  --danger: #bf9b98;
  --knowledge: #acbebf;
  --knowledge-soft: rgba(172, 190, 191, 0.14);
  --file: #98a8b7;
  --file-soft: rgba(152, 168, 183, 0.14);
  --pause: #bca889;
  --pause-soft: rgba(188, 168, 137, 0.14);
  --pause-line: rgba(188, 168, 137, 0.32);
  --stop: #bf9b98;
  --stop-soft: rgba(191, 155, 152, 0.14);
  --stop-line: rgba(191, 155, 152, 0.32);
  --resume: #9db2a1;
  --resume-soft: rgba(157, 178, 161, 0.14);
  --review: #b1aabb;
  --review-soft: rgba(177, 170, 187, 0.14);
}

.theme-light.saturation-low.accent-celadon {
  --accent: #396966;
  --accent-soft: #305552;
  --accent-gradient: linear-gradient(135deg, #427672, #315956);
  --accent-wash-strong: rgba(57, 105, 102, 0.65);
  --accent-wash: rgba(57, 105, 102, 0.12);
  --accent-wash-soft: rgba(57, 105, 102, 0.07);
  --accent-line: rgba(57, 105, 102, 0.5);
  --accent-line-soft: rgba(57, 105, 102, 0.32);
  --accent-glow: rgba(57, 105, 102, 0.24);
  --ok: #556c5a;
  --ok-soft: #445749;
  --warn: #7b6644;
  --danger: #946662;
  --knowledge: #546d6d;
  --knowledge-soft: rgba(84, 109, 109, 0.1);
  --file: #586b7c;
  --file-soft: rgba(88, 107, 124, 0.1);
  --pause: #7b6644;
  --pause-soft: rgba(123, 102, 68, 0.1);
  --pause-line: rgba(123, 102, 68, 0.32);
  --stop: #946662;
  --stop-soft: rgba(148, 102, 98, 0.1);
  --stop-line: rgba(148, 102, 98, 0.32);
  --resume: #556c5a;
  --resume-soft: rgba(85, 108, 90, 0.1);
  --review: #70687d;
  --review-soft: rgba(112, 104, 125, 0.1);
}

.saturation-low.accent-claude {
  --accent: #c2836e;
  --accent-soft: #cf9885;
  --accent-gradient: linear-gradient(135deg, #cc947f, #aa6a53);
  --accent-wash-strong: rgba(194, 131, 110, 0.65);
  --accent-wash: rgba(194, 131, 110, 0.14);
  --accent-wash-soft: rgba(194, 131, 110, 0.08);
  --accent-line: rgba(194, 131, 110, 0.45);
  --accent-line-soft: rgba(194, 131, 110, 0.28);
  --accent-glow: rgba(194, 131, 110, 0.26);
  --ok: #9db2a1;
  --ok-soft: #cbd9cf;
  --warn: #bca889;
  --danger: #bf9b98;
  --knowledge: #acbebf;
  --knowledge-soft: rgba(172, 190, 191, 0.14);
  --file: #98a8b7;
  --file-soft: rgba(152, 168, 183, 0.14);
  --pause: #bca889;
  --pause-soft: rgba(188, 168, 137, 0.14);
  --pause-line: rgba(188, 168, 137, 0.32);
  --stop: #bf9b98;
  --stop-soft: rgba(191, 155, 152, 0.14);
  --stop-line: rgba(191, 155, 152, 0.32);
  --resume: #9db2a1;
  --resume-soft: rgba(157, 178, 161, 0.14);
  --review: #b1aabb;
  --review-soft: rgba(177, 170, 187, 0.14);
}

.theme-light.saturation-low.accent-claude {
  --accent: #9d5e46;
  --accent-soft: #945944;
  --accent-gradient: linear-gradient(135deg, #aa6a53, #945944);
  --accent-wash-strong: rgba(170, 106, 83, 0.65);
  --accent-wash: rgba(170, 106, 83, 0.1);
  --accent-wash-soft: rgba(170, 106, 83, 0.06);
  --accent-line: rgba(170, 106, 83, 0.45);
  --accent-line-soft: rgba(170, 106, 83, 0.28);
  --accent-glow: rgba(170, 106, 83, 0.22);
  --ok: #556c5a;
  --ok-soft: #445749;
  --warn: #7b6644;
  --danger: #946662;
  --knowledge: #546d6d;
  --knowledge-soft: rgba(84, 109, 109, 0.1);
  --file: #586b7c;
  --file-soft: rgba(88, 107, 124, 0.1);
  --pause: #7b6644;
  --pause-soft: rgba(123, 102, 68, 0.1);
  --pause-line: rgba(123, 102, 68, 0.32);
  --stop: #946662;
  --stop-soft: rgba(148, 102, 98, 0.1);
  --stop-line: rgba(148, 102, 98, 0.32);
  --resume: #556c5a;
  --resume-soft: rgba(85, 108, 90, 0.1);
  --review: #70687d;
  --review-soft: rgba(112, 104, 125, 0.1);
}

.saturation-high {
  --accent: #ffffff;
  --accent-soft: #ffffff;
  --accent-gradient: linear-gradient(135deg, #ffffff, #bdbdbd);
  --accent-wash-strong: rgba(255, 255, 255, 0.65);
  --accent-wash: rgba(255, 255, 255, 0.14);
  --accent-wash-soft: rgba(255, 255, 255, 0.08);
  --accent-line: rgba(255, 255, 255, 0.45);
  --accent-line-soft: rgba(255, 255, 255, 0.28);
  --accent-glow: rgba(255, 255, 255, 0.26);
  --ok: #8dc297;
  --ok-soft: #c1e3ca;
  --warn: #e4b161;
  --danger: #de8178;
  --knowledge: #9dccce;
  --knowledge-soft: rgba(157, 204, 206, 0.14);
  --file: #7ea8d1;
  --file-soft: rgba(126, 168, 209, 0.14);
  --pause: #e4b161;
  --pause-soft: rgba(228, 177, 97, 0.14);
  --pause-line: rgba(228, 177, 97, 0.32);
  --stop: #de8178;
  --stop-soft: rgba(222, 129, 120, 0.14);
  --stop-line: rgba(222, 129, 120, 0.32);
  --resume: #8dc297;
  --resume-soft: rgba(141, 194, 151, 0.14);
  --review: #ae9cc9;
  --review-soft: rgba(174, 156, 201, 0.14);
}

.theme-light.saturation-high {
  --accent: #000000;
  --accent-soft: #000000;
  --accent-gradient: linear-gradient(135deg, #000000, #333333);
  --accent-wash-strong: rgba(0, 0, 0, 0.65);
  --accent-wash: rgba(0, 0, 0, 0.1);
  --accent-wash-soft: rgba(0, 0, 0, 0.06);
  --accent-line: rgba(0, 0, 0, 0.45);
  --accent-line-soft: rgba(0, 0, 0, 0.28);
  --accent-glow: rgba(0, 0, 0, 0.22);
  --ok: #437e50;
  --ok-soft: #356641;
  --warn: #a77118;
  --danger: #bb433b;
  --knowledge: #408181;
  --knowledge-soft: rgba(64, 129, 129, 0.1);
  --file: #3c6c98;
  --file-soft: rgba(60, 108, 152, 0.1);
  --pause: #a77118;
  --pause-soft: rgba(167, 113, 24, 0.1);
  --pause-line: rgba(167, 113, 24, 0.32);
  --stop: #bb433b;
  --stop-soft: rgba(187, 67, 59, 0.1);
  --stop-line: rgba(187, 67, 59, 0.32);
  --resume: #437e50;
  --resume-soft: rgba(67, 126, 80, 0.1);
  --review: #6d588d;
  --review-soft: rgba(109, 88, 141, 0.1);
}

.saturation-high.accent-pine {
  --accent: #61e0a1;
  --accent-soft: #90eebf;
  --accent-gradient: linear-gradient(135deg, #78deab, #2ae487);
  --accent-wash-strong: rgba(97, 224, 161, 0.65);
  --accent-wash: rgba(97, 224, 161, 0.16);
  --accent-wash-soft: rgba(97, 224, 161, 0.1);
  --accent-line: rgba(97, 224, 161, 0.5);
  --accent-line-soft: rgba(97, 224, 161, 0.32);
  --accent-glow: rgba(97, 224, 161, 0.3);
  --ok: #8dc297;
  --ok-soft: #c1e3ca;
  --warn: #e4b161;
  --danger: #de8178;
  --knowledge: #9dccce;
  --knowledge-soft: rgba(157, 204, 206, 0.14);
  --file: #7ea8d1;
  --file-soft: rgba(126, 168, 209, 0.14);
  --pause: #e4b161;
  --pause-soft: rgba(228, 177, 97, 0.14);
  --pause-line: rgba(228, 177, 97, 0.32);
  --stop: #de8178;
  --stop-soft: rgba(222, 129, 120, 0.14);
  --stop-line: rgba(222, 129, 120, 0.32);
  --resume: #8dc297;
  --resume-soft: rgba(141, 194, 151, 0.14);
  --review: #ae9cc9;
  --review-soft: rgba(174, 156, 201, 0.14);
}

.theme-light.saturation-high.accent-pine {
  --accent: #198f54;
  --accent-soft: #1b6f45;
  --accent-gradient: linear-gradient(135deg, #22a061, #11834a);
  --accent-wash-strong: rgba(25, 143, 84, 0.65);
  --accent-wash: rgba(25, 143, 84, 0.12);
  --accent-wash-soft: rgba(25, 143, 84, 0.07);
  --accent-line: rgba(25, 143, 84, 0.5);
  --accent-line-soft: rgba(25, 143, 84, 0.32);
  --accent-glow: rgba(25, 143, 84, 0.24);
  --ok: #437e50;
  --ok-soft: #356641;
  --warn: #a77118;
  --danger: #bb433b;
  --knowledge: #408181;
  --knowledge-soft: rgba(64, 129, 129, 0.1);
  --file: #3c6c98;
  --file-soft: rgba(60, 108, 152, 0.1);
  --pause: #a77118;
  --pause-soft: rgba(167, 113, 24, 0.1);
  --pause-line: rgba(167, 113, 24, 0.32);
  --stop: #bb433b;
  --stop-soft: rgba(187, 67, 59, 0.1);
  --stop-line: rgba(187, 67, 59, 0.32);
  --resume: #437e50;
  --resume-soft: rgba(67, 126, 80, 0.1);
  --review: #6d588d;
  --review-soft: rgba(109, 88, 141, 0.1);
  --accent-ink: #000000;
}

.saturation-high.accent-indigo {
  --accent: #698df2;
  --accent-soft: #9db6fb;
  --accent-gradient: linear-gradient(135deg, #819dee, #2f65f9);
  --accent-wash-strong: rgba(105, 141, 242, 0.65);
  --accent-wash: rgba(105, 141, 242, 0.16);
  --accent-wash-soft: rgba(105, 141, 242, 0.1);
  --accent-line: rgba(105, 141, 242, 0.5);
  --accent-line-soft: rgba(105, 141, 242, 0.32);
  --accent-glow: rgba(105, 141, 242, 0.3);
  --ok: #8dc297;
  --ok-soft: #c1e3ca;
  --warn: #e4b161;
  --danger: #de8178;
  --knowledge: #9dccce;
  --knowledge-soft: rgba(157, 204, 206, 0.14);
  --file: #7ea8d1;
  --file-soft: rgba(126, 168, 209, 0.14);
  --pause: #e4b161;
  --pause-soft: rgba(228, 177, 97, 0.14);
  --pause-line: rgba(228, 177, 97, 0.32);
  --stop: #de8178;
  --stop-soft: rgba(222, 129, 120, 0.14);
  --stop-line: rgba(222, 129, 120, 0.32);
  --resume: #8dc297;
  --resume-soft: rgba(141, 194, 151, 0.14);
  --review: #ae9cc9;
  --review-soft: rgba(174, 156, 201, 0.14);
}

.theme-light.saturation-high.accent-indigo {
  --accent: #133db4;
  --accent-soft: #19398f;
  --accent-gradient: linear-gradient(135deg, #1d49c4, #0b35a8);
  --accent-wash-strong: rgba(19, 61, 180, 0.65);
  --accent-wash: rgba(19, 61, 180, 0.12);
  --accent-wash-soft: rgba(19, 61, 180, 0.07);
  --accent-line: rgba(19, 61, 180, 0.5);
  --accent-line-soft: rgba(19, 61, 180, 0.32);
  --accent-glow: rgba(19, 61, 180, 0.24);
  --ok: #437e50;
  --ok-soft: #356641;
  --warn: #a77118;
  --danger: #bb433b;
  --knowledge: #408181;
  --knowledge-soft: rgba(64, 129, 129, 0.1);
  --file: #3c6c98;
  --file-soft: rgba(60, 108, 152, 0.1);
  --pause: #a77118;
  --pause-soft: rgba(167, 113, 24, 0.1);
  --pause-line: rgba(167, 113, 24, 0.32);
  --stop: #bb433b;
  --stop-soft: rgba(187, 67, 59, 0.1);
  --stop-line: rgba(187, 67, 59, 0.32);
  --resume: #437e50;
  --resume-soft: rgba(67, 126, 80, 0.1);
  --review: #6d588d;
  --review-soft: rgba(109, 88, 141, 0.1);
}

.saturation-high.accent-clay {
  --accent: #f19755;
  --accent-soft: #fab88a;
  --accent-gradient: linear-gradient(135deg, #eda36e, #f8781b);
  --accent-wash-strong: rgba(241, 151, 85, 0.65);
  --accent-wash: rgba(241, 151, 85, 0.16);
  --accent-wash-soft: rgba(241, 151, 85, 0.1);
  --accent-line: rgba(241, 151, 85, 0.5);
  --accent-line-soft: rgba(241, 151, 85, 0.32);
  --accent-glow: rgba(241, 151, 85, 0.3);
  --ok: #8dc297;
  --ok-soft: #c1e3ca;
  --warn: #e4b161;
  --danger: #de8178;
  --knowledge: #9dccce;
  --knowledge-soft: rgba(157, 204, 206, 0.14);
  --file: #7ea8d1;
  --file-soft: rgba(126, 168, 209, 0.14);
  --pause: #e4b161;
  --pause-soft: rgba(228, 177, 97, 0.14);
  --pause-line: rgba(228, 177, 97, 0.32);
  --stop: #de8178;
  --stop-soft: rgba(222, 129, 120, 0.14);
  --stop-line: rgba(222, 129, 120, 0.32);
  --resume: #8dc297;
  --resume-soft: rgba(141, 194, 151, 0.14);
  --review: #ae9cc9;
  --review-soft: rgba(174, 156, 201, 0.14);
}

.theme-light.saturation-high.accent-clay {
  --accent: #af5412;
  --accent-soft: #8c4817;
  --accent-gradient: linear-gradient(135deg, #bf611c, #a3490b);
  --accent-wash-strong: rgba(175, 84, 18, 0.65);
  --accent-wash: rgba(175, 84, 18, 0.12);
  --accent-wash-soft: rgba(175, 84, 18, 0.07);
  --accent-line: rgba(175, 84, 18, 0.5);
  --accent-line-soft: rgba(175, 84, 18, 0.32);
  --accent-glow: rgba(175, 84, 18, 0.24);
  --ok: #437e50;
  --ok-soft: #356641;
  --warn: #a77118;
  --danger: #bb433b;
  --knowledge: #408181;
  --knowledge-soft: rgba(64, 129, 129, 0.1);
  --file: #3c6c98;
  --file-soft: rgba(60, 108, 152, 0.1);
  --pause: #a77118;
  --pause-soft: rgba(167, 113, 24, 0.1);
  --pause-line: rgba(167, 113, 24, 0.32);
  --stop: #bb433b;
  --stop-soft: rgba(187, 67, 59, 0.1);
  --stop-line: rgba(187, 67, 59, 0.32);
  --resume: #437e50;
  --resume-soft: rgba(67, 126, 80, 0.1);
  --review: #6d588d;
  --review-soft: rgba(109, 88, 141, 0.1);
}

.saturation-high.accent-ocean {
  --accent: #3fc1fd;
  --accent-soft: #7ad5ff;
  --accent-gradient: linear-gradient(135deg, #59c5f7, #0ab1ff);
  --accent-wash-strong: rgba(63, 193, 253, 0.65);
  --accent-wash: rgba(63, 193, 253, 0.16);
  --accent-wash-soft: rgba(63, 193, 253, 0.1);
  --accent-line: rgba(63, 193, 253, 0.5);
  --accent-line-soft: rgba(63, 193, 253, 0.32);
  --accent-glow: rgba(63, 193, 253, 0.3);
  --ok: #8dc297;
  --ok-soft: #c1e3ca;
  --warn: #e4b161;
  --danger: #de8178;
  --knowledge: #9dccce;
  --knowledge-soft: rgba(157, 204, 206, 0.14);
  --file: #7ea8d1;
  --file-soft: rgba(126, 168, 209, 0.14);
  --pause: #e4b161;
  --pause-soft: rgba(228, 177, 97, 0.14);
  --pause-line: rgba(228, 177, 97, 0.32);
  --stop: #de8178;
  --stop-soft: rgba(222, 129, 120, 0.14);
  --stop-line: rgba(222, 129, 120, 0.32);
  --resume: #8dc297;
  --resume-soft: rgba(141, 194, 151, 0.14);
  --review: #ae9cc9;
  --review-soft: rgba(174, 156, 201, 0.14);
}

.theme-light.saturation-high.accent-ocean {
  --accent: #0073a8;
  --accent-soft: #035d86;
  --accent-gradient: linear-gradient(135deg, #0284c0, #006594);
  --accent-wash-strong: rgba(0, 115, 168, 0.65);
  --accent-wash: rgba(0, 115, 168, 0.12);
  --accent-wash-soft: rgba(0, 115, 168, 0.07);
  --accent-line: rgba(0, 115, 168, 0.5);
  --accent-line-soft: rgba(0, 115, 168, 0.32);
  --accent-glow: rgba(0, 115, 168, 0.24);
  --ok: #437e50;
  --ok-soft: #356641;
  --warn: #a77118;
  --danger: #bb433b;
  --knowledge: #408181;
  --knowledge-soft: rgba(64, 129, 129, 0.1);
  --file: #3c6c98;
  --file-soft: rgba(60, 108, 152, 0.1);
  --pause: #a77118;
  --pause-soft: rgba(167, 113, 24, 0.1);
  --pause-line: rgba(167, 113, 24, 0.32);
  --stop: #bb433b;
  --stop-soft: rgba(187, 67, 59, 0.1);
  --stop-line: rgba(187, 67, 59, 0.32);
  --resume: #437e50;
  --resume-soft: rgba(67, 126, 80, 0.1);
  --review: #6d588d;
  --review-soft: rgba(109, 88, 141, 0.1);
}

.saturation-high.accent-moss {
  --accent: #afec46;
  --accent-soft: #c9f778;
  --accent-gradient: linear-gradient(135deg, #b5e85f, #9ff30c);
  --accent-wash-strong: rgba(175, 236, 70, 0.65);
  --accent-wash: rgba(175, 236, 70, 0.16);
  --accent-wash-soft: rgba(175, 236, 70, 0.1);
  --accent-line: rgba(175, 236, 70, 0.5);
  --accent-line-soft: rgba(175, 236, 70, 0.32);
  --accent-glow: rgba(175, 236, 70, 0.3);
  --ok: #8dc297;
  --ok-soft: #c1e3ca;
  --warn: #e4b161;
  --danger: #de8178;
  --knowledge: #9dccce;
  --knowledge-soft: rgba(157, 204, 206, 0.14);
  --file: #7ea8d1;
  --file-soft: rgba(126, 168, 209, 0.14);
  --pause: #e4b161;
  --pause-soft: rgba(228, 177, 97, 0.14);
  --pause-line: rgba(228, 177, 97, 0.32);
  --stop: #de8178;
  --stop-soft: rgba(222, 129, 120, 0.14);
  --stop-line: rgba(222, 129, 120, 0.32);
  --resume: #8dc297;
  --resume-soft: rgba(141, 194, 151, 0.14);
  --review: #ae9cc9;
  --review-soft: rgba(174, 156, 201, 0.14);
}

.theme-light.saturation-high.accent-moss {
  --accent: #608f0f;
  --accent-soft: #4c6e12;
  --accent-gradient: linear-gradient(135deg, #6fa017, #548208);
  --accent-wash-strong: rgba(96, 143, 15, 0.65);
  --accent-wash: rgba(96, 143, 15, 0.12);
  --accent-wash-soft: rgba(96, 143, 15, 0.07);
  --accent-line: rgba(96, 143, 15, 0.5);
  --accent-line-soft: rgba(96, 143, 15, 0.32);
  --accent-glow: rgba(96, 143, 15, 0.24);
  --ok: #437e50;
  --ok-soft: #356641;
  --warn: #a77118;
  --danger: #bb433b;
  --knowledge: #408181;
  --knowledge-soft: rgba(64, 129, 129, 0.1);
  --file: #3c6c98;
  --file-soft: rgba(60, 108, 152, 0.1);
  --pause: #a77118;
  --pause-soft: rgba(167, 113, 24, 0.1);
  --pause-line: rgba(167, 113, 24, 0.32);
  --stop: #bb433b;
  --stop-soft: rgba(187, 67, 59, 0.1);
  --stop-line: rgba(187, 67, 59, 0.32);
  --resume: #437e50;
  --resume-soft: rgba(67, 126, 80, 0.1);
  --review: #6d588d;
  --review-soft: rgba(109, 88, 141, 0.1);
  --accent-ink: #000000;
}

.saturation-high.accent-plum {
  --accent: #b570eb;
  --accent-soft: #d1a2f6;
  --accent-gradient: linear-gradient(135deg, #bf86e9, #a037f1);
  --accent-wash-strong: rgba(181, 112, 235, 0.65);
  --accent-wash: rgba(181, 112, 235, 0.16);
  --accent-wash-soft: rgba(181, 112, 235, 0.1);
  --accent-line: rgba(181, 112, 235, 0.5);
  --accent-line-soft: rgba(181, 112, 235, 0.32);
  --accent-glow: rgba(181, 112, 235, 0.3);
  --ok: #8dc297;
  --ok-soft: #c1e3ca;
  --warn: #e4b161;
  --danger: #de8178;
  --knowledge: #9dccce;
  --knowledge-soft: rgba(157, 204, 206, 0.14);
  --file: #7ea8d1;
  --file-soft: rgba(126, 168, 209, 0.14);
  --pause: #e4b161;
  --pause-soft: rgba(228, 177, 97, 0.14);
  --pause-line: rgba(228, 177, 97, 0.32);
  --stop: #de8178;
  --stop-soft: rgba(222, 129, 120, 0.14);
  --stop-line: rgba(222, 129, 120, 0.32);
  --resume: #8dc297;
  --resume-soft: rgba(141, 194, 151, 0.14);
  --review: #ae9cc9;
  --review-soft: rgba(174, 156, 201, 0.14);
}

.theme-light.saturation-high.accent-plum {
  --accent: #7a29b8;
  --accent-soft: #682d95;
  --accent-gradient: linear-gradient(135deg, #8735c4, #701daf);
  --accent-wash-strong: rgba(122, 41, 184, 0.65);
  --accent-wash: rgba(122, 41, 184, 0.12);
  --accent-wash-soft: rgba(122, 41, 184, 0.07);
  --accent-line: rgba(122, 41, 184, 0.5);
  --accent-line-soft: rgba(122, 41, 184, 0.32);
  --accent-glow: rgba(122, 41, 184, 0.24);
  --ok: #437e50;
  --ok-soft: #356641;
  --warn: #a77118;
  --danger: #bb433b;
  --knowledge: #408181;
  --knowledge-soft: rgba(64, 129, 129, 0.1);
  --file: #3c6c98;
  --file-soft: rgba(60, 108, 152, 0.1);
  --pause: #a77118;
  --pause-soft: rgba(167, 113, 24, 0.1);
  --pause-line: rgba(167, 113, 24, 0.32);
  --stop: #bb433b;
  --stop-soft: rgba(187, 67, 59, 0.1);
  --stop-line: rgba(187, 67, 59, 0.32);
  --resume: #437e50;
  --resume-soft: rgba(67, 126, 80, 0.1);
  --review: #6d588d;
  --review-soft: rgba(109, 88, 141, 0.1);
}

.saturation-high.accent-rose {
  --accent: #fa6b8c;
  --accent-soft: #ffa4b8;
  --accent-gradient: linear-gradient(135deg, #f7829d, #ff3362);
  --accent-wash-strong: rgba(250, 107, 140, 0.65);
  --accent-wash: rgba(250, 107, 140, 0.16);
  --accent-wash-soft: rgba(250, 107, 140, 0.1);
  --accent-line: rgba(250, 107, 140, 0.5);
  --accent-line-soft: rgba(250, 107, 140, 0.32);
  --accent-glow: rgba(250, 107, 140, 0.3);
  --ok: #8dc297;
  --ok-soft: #c1e3ca;
  --warn: #e4b161;
  --danger: #de8178;
  --knowledge: #9dccce;
  --knowledge-soft: rgba(157, 204, 206, 0.14);
  --file: #7ea8d1;
  --file-soft: rgba(126, 168, 209, 0.14);
  --pause: #e4b161;
  --pause-soft: rgba(228, 177, 97, 0.14);
  --pause-line: rgba(228, 177, 97, 0.32);
  --stop: #de8178;
  --stop-soft: rgba(222, 129, 120, 0.14);
  --stop-line: rgba(222, 129, 120, 0.32);
  --resume: #8dc297;
  --resume-soft: rgba(141, 194, 151, 0.14);
  --review: #ae9cc9;
  --review-soft: rgba(174, 156, 201, 0.14);
}

.theme-light.saturation-high.accent-rose {
  --accent: #c11a41;
  --accent-soft: #9c213e;
  --accent-gradient: linear-gradient(135deg, #d0254e, #b51237);
  --accent-wash-strong: rgba(193, 26, 65, 0.65);
  --accent-wash: rgba(193, 26, 65, 0.12);
  --accent-wash-soft: rgba(193, 26, 65, 0.07);
  --accent-line: rgba(193, 26, 65, 0.5);
  --accent-line-soft: rgba(193, 26, 65, 0.32);
  --accent-glow: rgba(193, 26, 65, 0.24);
  --ok: #437e50;
  --ok-soft: #356641;
  --warn: #a77118;
  --danger: #bb433b;
  --knowledge: #408181;
  --knowledge-soft: rgba(64, 129, 129, 0.1);
  --file: #3c6c98;
  --file-soft: rgba(60, 108, 152, 0.1);
  --pause: #a77118;
  --pause-soft: rgba(167, 113, 24, 0.1);
  --pause-line: rgba(167, 113, 24, 0.32);
  --stop: #bb433b;
  --stop-soft: rgba(187, 67, 59, 0.1);
  --stop-line: rgba(187, 67, 59, 0.32);
  --resume: #437e50;
  --resume-soft: rgba(67, 126, 80, 0.1);
  --review: #6d588d;
  --review-soft: rgba(109, 88, 141, 0.1);
}

.saturation-high.accent-sand {
  --accent: #f9bf4e;
  --accent-soft: #ffd685;
  --accent-gradient: linear-gradient(135deg, #f4c467, #ffb214);
  --accent-wash-strong: rgba(249, 191, 78, 0.65);
  --accent-wash: rgba(249, 191, 78, 0.16);
  --accent-wash-soft: rgba(249, 191, 78, 0.1);
  --accent-line: rgba(249, 191, 78, 0.5);
  --accent-line-soft: rgba(249, 191, 78, 0.32);
  --accent-glow: rgba(249, 191, 78, 0.3);
  --ok: #8dc297;
  --ok-soft: #c1e3ca;
  --warn: #e4b161;
  --danger: #de8178;
  --knowledge: #9dccce;
  --knowledge-soft: rgba(157, 204, 206, 0.14);
  --file: #7ea8d1;
  --file-soft: rgba(126, 168, 209, 0.14);
  --pause: #e4b161;
  --pause-soft: rgba(228, 177, 97, 0.14);
  --pause-line: rgba(228, 177, 97, 0.32);
  --stop: #de8178;
  --stop-soft: rgba(222, 129, 120, 0.14);
  --stop-line: rgba(222, 129, 120, 0.32);
  --resume: #8dc297;
  --resume-soft: rgba(141, 194, 151, 0.14);
  --review: #ae9cc9;
  --review-soft: rgba(174, 156, 201, 0.14);
}

.theme-light.saturation-high.accent-sand {
  --accent: #a26c01;
  --accent-soft: #7d5608;
  --accent-gradient: linear-gradient(135deg, #b47b08, #8f5f00);
  --accent-wash-strong: rgba(162, 108, 1, 0.65);
  --accent-wash: rgba(162, 108, 1, 0.12);
  --accent-wash-soft: rgba(162, 108, 1, 0.07);
  --accent-line: rgba(162, 108, 1, 0.5);
  --accent-line-soft: rgba(162, 108, 1, 0.32);
  --accent-glow: rgba(162, 108, 1, 0.24);
  --ok: #437e50;
  --ok-soft: #356641;
  --warn: #a77118;
  --danger: #bb433b;
  --knowledge: #408181;
  --knowledge-soft: rgba(64, 129, 129, 0.1);
  --file: #3c6c98;
  --file-soft: rgba(60, 108, 152, 0.1);
  --pause: #a77118;
  --pause-soft: rgba(167, 113, 24, 0.1);
  --pause-line: rgba(167, 113, 24, 0.32);
  --stop: #bb433b;
  --stop-soft: rgba(187, 67, 59, 0.1);
  --stop-line: rgba(187, 67, 59, 0.32);
  --resume: #437e50;
  --resume-soft: rgba(67, 126, 80, 0.1);
  --review: #6d588d;
  --review-soft: rgba(109, 88, 141, 0.1);
  --accent-ink: #000000;
}

.saturation-high.accent-orange {
  --accent: #ff9d5d;
  --accent-soft: #ffba85;
  --accent-gradient: linear-gradient(135deg, #ffaf75, #ff7121);
  --accent-wash-strong: rgba(255, 157, 93, 0.65);
  --accent-wash: rgba(255, 157, 93, 0.16);
  --accent-wash-soft: rgba(255, 157, 93, 0.1);
  --accent-line: rgba(255, 157, 93, 0.5);
  --accent-line-soft: rgba(255, 157, 93, 0.32);
  --accent-glow: rgba(255, 157, 93, 0.3);
  --ok: #8dc297;
  --ok-soft: #c1e3ca;
  --warn: #e4b161;
  --danger: #de8178;
  --knowledge: #9dccce;
  --knowledge-soft: rgba(157, 204, 206, 0.14);
  --file: #7ea8d1;
  --file-soft: rgba(126, 168, 209, 0.14);
  --pause: #e4b161;
  --pause-soft: rgba(228, 177, 97, 0.14);
  --pause-line: rgba(228, 177, 97, 0.32);
  --stop: #de8178;
  --stop-soft: rgba(222, 129, 120, 0.14);
  --stop-line: rgba(222, 129, 120, 0.32);
  --resume: #8dc297;
  --resume-soft: rgba(141, 194, 151, 0.14);
  --review: #ae9cc9;
  --review-soft: rgba(174, 156, 201, 0.14);
}

.theme-light.saturation-high.accent-orange {
  --accent: #c15500;
  --accent-soft: #d86000;
  --accent-gradient: linear-gradient(135deg, #e36600, #a54500);
  --accent-wash-strong: rgba(193, 85, 0, 0.65);
  --accent-wash: rgba(193, 85, 0, 0.12);
  --accent-wash-soft: rgba(193, 85, 0, 0.07);
  --accent-line: rgba(193, 85, 0, 0.5);
  --accent-line-soft: rgba(193, 85, 0, 0.32);
  --accent-glow: rgba(193, 85, 0, 0.24);
  --ok: #437e50;
  --ok-soft: #356641;
  --warn: #a77118;
  --danger: #bb433b;
  --knowledge: #408181;
  --knowledge-soft: rgba(64, 129, 129, 0.1);
  --file: #3c6c98;
  --file-soft: rgba(60, 108, 152, 0.1);
  --pause: #a77118;
  --pause-soft: rgba(167, 113, 24, 0.1);
  --pause-line: rgba(167, 113, 24, 0.32);
  --stop: #bb433b;
  --stop-soft: rgba(187, 67, 59, 0.1);
  --stop-line: rgba(187, 67, 59, 0.32);
  --resume: #437e50;
  --resume-soft: rgba(67, 126, 80, 0.1);
  --review: #6d588d;
  --review-soft: rgba(109, 88, 141, 0.1);
}

.saturation-high.accent-celadon {
  --accent: #39eddf;
  --accent-soft: #74f9ed;
  --accent-gradient: linear-gradient(135deg, #54f2e7, #12dfd1);
  --accent-wash-strong: rgba(57, 237, 223, 0.65);
  --accent-wash: rgba(57, 237, 223, 0.16);
  --accent-wash-soft: rgba(57, 237, 223, 0.1);
  --accent-line: rgba(57, 237, 223, 0.5);
  --accent-line-soft: rgba(57, 237, 223, 0.32);
  --accent-glow: rgba(57, 237, 223, 0.3);
  --ok: #8dc297;
  --ok-soft: #c1e3ca;
  --warn: #e4b161;
  --danger: #de8178;
  --knowledge: #9dccce;
  --knowledge-soft: rgba(157, 204, 206, 0.14);
  --file: #7ea8d1;
  --file-soft: rgba(126, 168, 209, 0.14);
  --pause: #e4b161;
  --pause-soft: rgba(228, 177, 97, 0.14);
  --pause-line: rgba(228, 177, 97, 0.32);
  --stop: #de8178;
  --stop-soft: rgba(222, 129, 120, 0.14);
  --stop-line: rgba(222, 129, 120, 0.32);
  --resume: #8dc297;
  --resume-soft: rgba(141, 194, 151, 0.14);
  --review: #ae9cc9;
  --review-soft: rgba(174, 156, 201, 0.14);
}

.theme-light.saturation-high.accent-celadon {
  --accent: #129087;
  --accent-soft: #12736c;
  --accent-gradient: linear-gradient(135deg, #18a095, #117971);
  --accent-wash-strong: rgba(18, 144, 135, 0.65);
  --accent-wash: rgba(18, 144, 135, 0.12);
  --accent-wash-soft: rgba(18, 144, 135, 0.07);
  --accent-line: rgba(18, 144, 135, 0.5);
  --accent-line-soft: rgba(18, 144, 135, 0.32);
  --accent-glow: rgba(18, 144, 135, 0.24);
  --ok: #437e50;
  --ok-soft: #356641;
  --warn: #a77118;
  --danger: #bb433b;
  --knowledge: #408181;
  --knowledge-soft: rgba(64, 129, 129, 0.1);
  --file: #3c6c98;
  --file-soft: rgba(60, 108, 152, 0.1);
  --pause: #a77118;
  --pause-soft: rgba(167, 113, 24, 0.1);
  --pause-line: rgba(167, 113, 24, 0.32);
  --stop: #bb433b;
  --stop-soft: rgba(187, 67, 59, 0.1);
  --stop-line: rgba(187, 67, 59, 0.32);
  --resume: #437e50;
  --resume-soft: rgba(67, 126, 80, 0.1);
  --review: #6d588d;
  --review-soft: rgba(109, 88, 141, 0.1);
  --accent-ink: #000000;
}

.saturation-high.accent-claude {
  --accent: #ff6431;
  --accent-soft: #ff8055;
  --accent-gradient: linear-gradient(135deg, #ff7b4c, #ef490e);
  --accent-wash-strong: rgba(255, 100, 49, 0.65);
  --accent-wash: rgba(255, 100, 49, 0.14);
  --accent-wash-soft: rgba(255, 100, 49, 0.08);
  --accent-line: rgba(255, 100, 49, 0.45);
  --accent-line-soft: rgba(255, 100, 49, 0.28);
  --accent-glow: rgba(255, 100, 49, 0.26);
  --ok: #8dc297;
  --ok-soft: #c1e3ca;
  --warn: #e4b161;
  --danger: #de8178;
  --knowledge: #9dccce;
  --knowledge-soft: rgba(157, 204, 206, 0.14);
  --file: #7ea8d1;
  --file-soft: rgba(126, 168, 209, 0.14);
  --pause: #e4b161;
  --pause-soft: rgba(228, 177, 97, 0.14);
  --pause-line: rgba(228, 177, 97, 0.32);
  --stop: #de8178;
  --stop-soft: rgba(222, 129, 120, 0.14);
  --stop-line: rgba(222, 129, 120, 0.32);
  --resume: #8dc297;
  --resume-soft: rgba(141, 194, 151, 0.14);
  --review: #ae9cc9;
  --review-soft: rgba(174, 156, 201, 0.14);
}

.theme-light.saturation-high.accent-claude {
  --accent: #e23e01;
  --accent-soft: #d33905;
  --accent-gradient: linear-gradient(135deg, #ef490e, #d33905);
  --accent-wash-strong: rgba(239, 73, 14, 0.65);
  --accent-wash: rgba(239, 73, 14, 0.1);
  --accent-wash-soft: rgba(239, 73, 14, 0.06);
  --accent-line: rgba(239, 73, 14, 0.45);
  --accent-line-soft: rgba(239, 73, 14, 0.28);
  --accent-glow: rgba(239, 73, 14, 0.22);
  --ok: #437e50;
  --ok-soft: #356641;
  --warn: #a77118;
  --danger: #bb433b;
  --knowledge: #408181;
  --knowledge-soft: rgba(64, 129, 129, 0.1);
  --file: #3c6c98;
  --file-soft: rgba(60, 108, 152, 0.1);
  --pause: #a77118;
  --pause-soft: rgba(167, 113, 24, 0.1);
  --pause-line: rgba(167, 113, 24, 0.32);
  --stop: #bb433b;
  --stop-soft: rgba(187, 67, 59, 0.1);
  --stop-line: rgba(187, 67, 59, 0.32);
  --resume: #437e50;
  --resume-soft: rgba(67, 126, 80, 0.1);
  --review: #6d588d;
  --review-soft: rgba(109, 88, 141, 0.1);
  --accent-ink: #000000;
}
/* appearance:end */

</style>
