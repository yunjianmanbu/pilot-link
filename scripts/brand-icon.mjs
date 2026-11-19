/**
 * Pilot 品牌图标几何与 PNG 编码。
 *
 * 与 site/assets/logo.svg 保持一致：深色圆角底、白色正体圆角 P、右下角绿色圆点。
 * 纯 Node 实现（zlib 编码 PNG），不依赖 ImageMagick / sharp。
 */

import { deflateSync } from 'node:zlib'

export const BG = [16, 28, 45]
export const GREEN = [74, 222, 128]
const WHITE = [255, 255, 255]
const SS = 4

/**
 * 正体圆角 P 的 SVG 路径（64×64 坐标系），与 `squarePUpright` 的布尔几何一致。
 * 圆角矩形竖笔、平顶/平底横笔、右半圆外轮廓；竖笔与半圆之间保留完整内孔。
 */
export const SQUARE_P_PATH = [
  // 竖笔：x 19..27, y 15..49, r 3.5
  'M22.5 15H23.5A3.5 3.5 0 0 1 27 18.5V45.5A3.5 3.5 0 0 1 23.5 49H22.5A3.5 3.5 0 0 1 19 45.5V18.5A3.5 3.5 0 0 1 22.5 15Z',
  // 上横笔：x 19..33, y 15..23，只圆左侧两角
  'M22.5 15H33V23H22.5A3.5 3.5 0 0 1 19 19.5V18.5A3.5 3.5 0 0 1 22.5 15Z',
  // 下横笔：x 19..33, y 31..39，只圆左侧两角
  'M22.5 31H33V39H22.5A3.5 3.5 0 0 1 19 35.5V34.5A3.5 3.5 0 0 1 22.5 31Z',
  // 右半圆：外径 12、内径 4，形成独立的圆环内孔
  'M33 15A12 12 0 0 1 33 39L33 31A4 4 0 0 0 33 23Z'
].join('')

function crcTable() {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
}

const CRC = crcTable()

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuffer, data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function roundedRectDistance(x, y, left, top, width, height, radius) {
  const cx = left + width / 2
  const cy = top + height / 2
  const hx = width / 2 - radius
  const hy = height / 2 - radius
  const dx = Math.abs(x - cx) - hx
  const dy = Math.abs(y - cy) - hy
  const ox = Math.max(dx, 0)
  const oy = Math.max(dy, 0)
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - radius
}

function segmentDistance(x, y, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const wx = x - ax
  const wy = y - ay
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)))
  return Math.hypot(wx - vx * t, wy - vy * t)
}

// 64 坐标系中的 P：竖笔 + 上半圆 + 上下两段短横，线宽 8、圆头。
function pDistance(x, y) {
  let d = segmentDistance(x, y, 23, 45, 23, 19)
  d = Math.min(d, segmentDistance(x, y, 23, 19, 33, 19))
  d = Math.min(d, segmentDistance(x, y, 33, 35, 23, 35))
  if (x >= 33) {
    d = Math.min(d, Math.abs(Math.hypot(x - 33, y - 27) - 8))
  }
  return d
}

// 64 坐标系中的大写 D：左侧竖笔 + 上下短横 + 右侧半圆，线宽 8、圆头。
function upperDDistance(x, y) {
  let d = segmentDistance(x, y, 23, 18, 23, 46)
  d = Math.min(d, segmentDistance(x, y, 23, 18, 33, 18))
  d = Math.min(d, segmentDistance(x, y, 23, 46, 33, 46))
  if (x >= 33) {
    d = Math.min(d, Math.abs(Math.hypot(x - 33, y - 32) - 14))
  }
  return d
}

// 64 坐标系中的小写 d：左侧圆碗 + 右侧通高竖笔，线宽 8、圆头。
function lowerDDistance(x, y) {
  const bowl = Math.abs(Math.hypot(x - 32, y - 36) - 12)
  const stem = segmentDistance(x, y, 44, 14, 44, 48)
  return Math.min(bowl, stem)
}

// 正体圆角 p：圆角矩形竖笔 + 平顶/平底横笔 + 右半圆外轮廓。
// 竖笔与半圆是两笔，中间留出完整的内孔（间隔），不贴合；外轮廓在
// y=15/39 处与横笔相切。外角统一做 3.5 单位圆角，横笔右端与半圆相切处
// 保持直角，避免在切点啃出缺口。
const SQUARE_P_RADIUS = 3.5

function roundedBoxInside(x, y, x0, y0, x1, y1, radius) {
  return roundedRectDistance(x, y, x0, y0, x1 - x0, y1 - y0, radius) <= 0
}

// 只圆左侧两个角：横笔右端要贴着半圆，圆角会把切点附近啃出小缺口。
function leftRoundedBoxInside(x, y, x0, y0, x1, y1, radius) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  if (x >= x0 + radius) return true
  const cy = Math.min(Math.max(y, y0 + radius), y1 - radius)
  return Math.hypot(x - (x0 + radius), y - cy) <= radius
}

function squarePUpright(x, y) {
  const radius = SQUARE_P_RADIUS
  const stem = roundedBoxInside(x, y, 19, 15, 27, 49, radius)
  const top = leftRoundedBoxInside(x, y, 19, 15, 33, 23, radius)
  const mid = leftRoundedBoxInside(x, y, 19, 31, 33, 39, radius)
  const distance = Math.hypot(x - 33, y - 27)
  const bowl = x >= 33 && distance >= 4 && distance <= 12
  return stem || top || mid || bowl
}

// 布尔字形转成 0/1 距离，和其余字形共用 threshold 判断。
function squarePDistance(x, y) {
  return squarePUpright(x, y) ? 0 : 1
}

/**
 * 在 64×64 坐标系里采样一个点，返回 [r,g,b,a]；圆角外返回 null。
 * palette 可覆盖底色、圆点位置/大小和字形。默认使用最新的正体圆角 P；
 * 桌面端深色底、白色 P、右下角绿点，手机端绿底白色 P、白点。
 */
export function sample(x, y, palette = {}) {
  const background = palette.background ?? BG
  const dot = palette.dot ?? GREEN
  // 字形颜色默认白色；浅底深字（如 Pilot Client 的白底黑 P）由调用方覆盖。
  const ink = palette.ink ?? WHITE
  const dotX = palette.dotCenter?.[0] ?? 47.5
  const dotY = palette.dotCenter?.[1] ?? 47.5
  const dotRadius = palette.dotRadius ?? 5.5
  const glyphName = palette.glyph ?? 'squareP'
  const glyph =
    glyphName === 'D'
      ? upperDDistance
      : glyphName === 'd'
        ? lowerDDistance
        : glyphName === 'p'
          ? pDistance
          : squarePDistance
  const threshold = glyphName === 'squareP' ? 0.5 : 4
  const outer = roundedRectDistance(x, y, 2, 2, 60, 60, 14.5)
  if (outer > 0) return null
  if (Math.hypot(x - dotX, y - dotY) <= dotRadius) return [...dot, 1]
  if (glyph(x, y) <= threshold) return [...ink, 1]
  return [...background, 1]
}

export function renderIcon(size, palette) {
  const rgba = Buffer.alloc(size * size * 4)
  const scale = 64 / size
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let sr = 0
      let sg = 0
      let sb = 0
      let sa = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) * scale
          const y = (py + (sy + 0.5) / SS) * scale
          const color = sample(x, y, palette)
          if (!color) continue
          sr += color[0] * color[3]
          sg += color[1] * color[3]
          sb += color[2] * color[3]
          sa += color[3]
        }
      }
      const index = (py * size + px) * 4
      if (sa > 0) {
        rgba[index] = Math.round(sr / sa)
        rgba[index + 1] = Math.round(sg / sa)
        rgba[index + 2] = Math.round(sb / sa)
      }
      rgba[index + 3] = Math.round((sa / (SS * SS)) * 255)
    }
  }
  return encodePng(size, size, rgba)
}

/** 把多张 PNG 打包成 ICO（Vista+ 的 PNG 条目）。 */
export function encodeIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)

  const directory = Buffer.alloc(entries.length * 16)
  let offset = 6 + directory.length
  entries.forEach(({ size, png }, index) => {
    const at = index * 16
    directory[at] = size >= 256 ? 0 : size
    directory[at + 1] = size >= 256 ? 0 : size
    directory[at + 2] = 0
    directory[at + 3] = 0
    directory.writeUInt16LE(1, at + 4)
    directory.writeUInt16LE(32, at + 6)
    directory.writeUInt32LE(png.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += png.length
  })

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)])
}
