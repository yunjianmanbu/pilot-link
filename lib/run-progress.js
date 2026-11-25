/**
 * 运行进度：步号与已运行时长。
 *
 * 手机端等待行原来只有三个点和一句「执行中…」，跑 2 秒和跑 2 分钟长得一样；
 * 电脑端顶栏与思考行都带「第 N 步 + 已运行 mm:ss」，这里算出同样的两段文案。
 *
 * 纯函数，不读 store：页面每秒把 now 传进来，测试不用等真实时钟。
 */

/** 低于这个时长只显示步号：3 秒内的秒数只会闪一下，反而干扰阅读。 */
export const RUN_PROGRESS_MIN_MS = 3_000

/** 与电脑端 `src/renderer/src/ui.ts` 的 formatDuration 同口径：12s / 1m 35s。 */
export function formatRunElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1_000) return ''
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1_000)
  return `${minutes}m ${seconds}s`
}

/**
 * 已运行时长文案；没开始时间或不足 3 秒时返回空串，页面据此只显示步号。
 */
export function runElapsedLabel(startedAt, now = Date.now()) {
  const started = Number(startedAt)
  if (!Number.isFinite(started) || started <= 0) return ''
  const elapsed = Number(now) - started
  if (!Number.isFinite(elapsed) || elapsed < RUN_PROGRESS_MIN_MS) return ''
  return formatRunElapsed(elapsed)
}

/**
 * 等待行的两段文案。
 *
 * 返回 `{ step, elapsed }` 而不是拼好的句子：中文与英文的拼接位置不同，
 * 拼装留在页面里按当前语言做。
 */
export function runProgressParts(run, now = Date.now()) {
  const step = Number(run?.step)
  return {
    step: Number.isFinite(step) && step > 0 ? Math.floor(step) : 0,
    elapsed: runElapsedLabel(run?.startedAt, now)
  }
}
