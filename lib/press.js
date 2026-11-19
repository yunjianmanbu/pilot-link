/**
 * 列表里的长按手势。
 *
 * uni-app 原生的 @longpress 在 scroll-view 里不具备“拖动即取消”的判定：
 * 按住列表慢慢拖动时仍会到点触发，滚动列表就误开了底部操作菜单。这里改成
 * 自己跟踪 touchstart / touchmove / touchend：只有按住且位移不超过阈值才
 * 算长按，一旦拖动或列表开始滚动就取消。
 */

export const PRESS_DELAY = 500
export const PRESS_MOVE_TOLERANCE = 12
export const PRESS_CLICK_GUARD = 400
const SCROLL_QUIET_MS = 150

export function touchPoint(event) {
  const touch =
    (event && event.touches && event.touches[0]) ||
    (event && event.changedTouches && event.changedTouches[0]) ||
    null
  if (!touch) return null
  const x = Number(touch.clientX ?? touch.pageX)
  const y = Number(touch.clientY ?? touch.pageY)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

export function movedBeyond(origin, point, tolerance = PRESS_MOVE_TOLERANCE) {
  if (!origin || !point) return false
  return Math.abs(point.x - origin.x) > tolerance || Math.abs(point.y - origin.y) > tolerance
}

export function createPressGesture({
  onLongPress,
  delay = PRESS_DELAY,
  tolerance = PRESS_MOVE_TOLERANCE,
  clickGuard = PRESS_CLICK_GUARD,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id)
} = {}) {
  let timer = null
  let origin = null
  let payload = null
  let active = false
  let moved = false
  let opened = false
  let scrollQuietUntil = 0
  let clickBlockedUntil = 0

  const stopTimer = () => {
    if (timer === null) return
    clearTimer(timer)
    timer = null
  }

  const reset = () => {
    stopTimer()
    active = false
    moved = false
    opened = false
    origin = null
    payload = null
  }

  return {
    /** 按下：开始计时。value 会原样交给 onLongPress。 */
    start(event, value) {
      reset()
      // 列表还在惯性滚动时，触摸通常只是为了让列表停下，不参与长按计时。
      if (now() < scrollQuietUntil) return
      const point = touchPoint(event)
      if (!point || typeof onLongPress !== 'function') return
      origin = point
      payload = value
      active = true
      timer = setTimer(() => {
        timer = null
        if (!active || moved || opened) return
        opened = true
        clickBlockedUntil = now() + clickGuard
        onLongPress(payload)
      }, delay)
    },
    /** 移动：超过阈值即视为拖动，取消长按。 */
    move(event) {
      if (!active || moved) return
      const point = touchPoint(event)
      if (!movedBeyond(origin, point, tolerance)) return
      moved = true
      stopTimer()
      // 拖动之后抬手通常不该再当成点击，避免滚动时误进会话。
      clickBlockedUntil = now() + Math.min(clickGuard, 250)
    },
    /** 抬手：正常点击会让 click 继续；长按已触发时挡住随之而来的 click。 */
    end() {
      stopTimer()
      if (opened) clickBlockedUntil = now() + clickGuard
      reset()
    },
    cancel() {
      reset()
    },
    /** 列表滚动：取消尚未触发的长按，并在短时间内不再开始计时。 */
    scroll() {
      scrollQuietUntil = now() + SCROLL_QUIET_MS
      if (active && !opened) {
        moved = true
        stopTimer()
        clickBlockedUntil = now() + SCROLL_QUIET_MS
      }
    },
    /** 长按或拖动之后，页面里的 click 应当被忽略。 */
    clickBlocked() {
      return now() < clickBlockedUntil
    },
    dispose() {
      reset()
    }
  }
}
