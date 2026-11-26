/**
 * 抬手后合成 click 的防穿透。
 *
 * 手机上点一个元素，浏览器发的是 touchstart → touchend → click。如果 touchend
 * 的处理里**同步**就改了这一屏（弹层铺满屏幕、或整页换成新页面），那么紧随其后的
 * 那次 click 的目标坐标已经换成了新内容，于是这一下点击会打到用户根本没点的东西上。
 *
 * 「全部任务」此前就是被这条路径吃掉的：入口在 touchend 阶段同步打开弹层 → 合成
 * click 落在刚铺满的遮罩上 → 遮罩把自己关掉，用户看到的就是「点了完全没反应」。
 * 改成跳页之后同样不能幸免：同一个坐标在新页面上若正好是某一行，就会被直接带进
 * 会话页，比「没反应」更糟。
 *
 * 所以跳页前用 armTapGuard() 开一个短窗口，新页面在窗口内忽略点击。窗口只覆盖
 * 「抬手到新页面画出来」的那一小段（H5 在 500ms 内画完），对正常操作没有影响。
 */

const DEFAULT_GUARD_MS = 500

let guardedUntil = 0

/** 开一个防穿透窗口：从现在起 ms 毫秒内的点击视为上一次抬手的余波。 */
export function armTapGuard(ms = DEFAULT_GUARD_MS) {
  const span = Number(ms)
  if (!Number.isFinite(span) || span <= 0) return
  guardedUntil = Math.max(guardedUntil, Date.now() + span)
}

/** 当前这一次点击是否还要被吞掉。 */
export function tapGuarded() {
  return Date.now() < guardedUntil
}

/** 测试用：清掉窗口，避免用例之间互相影响。 */
export function resetTapGuard() {
  guardedUntil = 0
}
