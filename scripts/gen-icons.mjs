/**
 * 生成 Pilot 手机 App 的 Android 图标与启动图。
 *
 * 手机端用绿底白字：微信输入法 logo 同款绿色圆角底、白色 P、白色圆点。
 * 桌面端与官网仍用深色底品牌图形，因此通过 palette 单独覆盖。
 * 纯 Node 实现，不依赖 ImageMagick / sharp。
 *
 * 用法：node scripts/gen-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePng, renderIcon, sample } from './brand-icon.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SS = 4

// 取自微信输入法 logo 的绿色（#28D699），配白色圆角正体 p 与右下角圆点。
const APP_ICON_PALETTE = {
  background: [40, 214, 153],
  dot: [255, 255, 255],
  dotCenter: [47.5, 47.5],
  dotRadius: 5,
  glyph: 'squareP'
}

const iconDir = resolve(ROOT, 'static/icons')
mkdirSync(iconDir, { recursive: true })
for (const [name, size] of [
  ['48.png', 48],
  ['72.png', 72],
  ['96.png', 96],
  ['144.png', 144],
  ['180.png', 180],
  ['192.png', 192],
  ['512.png', 512],
  ['1024.png', 1024]
]) {
  writeFileSync(resolve(iconDir, name), renderIcon(size, APP_ICON_PALETTE))
  process.stdout.write(`icons/${name}\n`)
}

/**
 * maskable 图标：满幅底色、没有任何圆角透明区，主体缩到 68% 居中 ——
 * 安卓自适应图标会把外沿裁掉，字形贴着边就被切掉了。
 */
function renderMaskable(size = 512) {
  const rgba = Buffer.alloc(size * size * 4)
  const [br, bg, bb] = APP_ICON_PALETTE.background
  const scale = 64 / size
  const glyphScale = 0.68
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // 把像素坐标以中心为原点缩回 64 坐标系，再交给品牌字形采样。
      const gx = ((px + 0.5) * scale - 32) / glyphScale + 32
      const gy = ((py + 0.5) * scale - 32) / glyphScale + 32
      const color = sample(gx, gy, APP_ICON_PALETTE)
      const index = (py * size + px) * 4
      // sample 在圆角外返回 null，maskable 需要满幅底色，所以退回背景色。
      const [r, g, b] = color || APP_ICON_PALETTE.background
      rgba[index] = r ?? br
      rgba[index + 1] = g ?? bg
      rgba[index + 2] = b ?? bb
      rgba[index + 3] = 255
    }
  }
  return encodePng(size, size, rgba)
}

writeFileSync(resolve(iconDir, 'maskable-512.png'), renderMaskable(512))
process.stdout.write('icons/maskable-512.png\n')

// 启动图：保持旧 splash.9.png 的 9-patch 结构（顶部/左侧两侧为可拉伸区，
// 中间 97..288 固定），背景 #0f1115，Pilot 图标居中。
function renderSplash(size = 386) {
  const rgba = Buffer.alloc(size * size * 4)
  const logoSize = Math.round(size * 0.46)
  const offset = (size - logoSize) / 2
  const scale = 64 / logoSize
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const index = (py * size + px) * 4
      const border = px === 0 || py === 0 || px === size - 1 || py === size - 1
      if (border) {
        // 顶部与左侧的黑色像素标记可拉伸区域，其余边框保持透明。
        const marker =
          (py === 0 || px === 0) &&
          ((px >= 1 && px <= 96) || (px >= 289 && px <= 384)) &&
          (py === 0 || px === 0)
        const inRange =
          py === 0
            ? (px >= 1 && px <= 96) || (px >= 289 && px <= 384)
            : px === 0 && ((py >= 1 && py <= 96) || (py >= 289 && py <= 384))
        if (marker || inRange) {
          rgba[index + 3] = 255
        }
        continue
      }
      let sr = 15 * SS * SS
      let sg = 17 * SS * SS
      let sb = 23 * SS * SS
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS
          const y = py + (sy + 0.5) / SS
          const ix = (x - offset) * scale
          const iy = (y - offset) * scale
          const color = sample(ix, iy, APP_ICON_PALETTE)
          if (!color) continue
          sr = sr - 15 + color[0]
          sg = sg - 17 + color[1]
          sb = sb - 23 + color[2]
        }
      }
      rgba[index] = Math.round(sr / (SS * SS))
      rgba[index + 1] = Math.round(sg / (SS * SS))
      rgba[index + 2] = Math.round(sb / (SS * SS))
      rgba[index + 3] = 255
    }
  }
  return encodePng(size, size, rgba)
}

writeFileSync(resolve(ROOT, 'static/splash.9.png'), renderSplash())
process.stdout.write('static/splash.9.png\n')
