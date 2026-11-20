/**
 * 模型标签：与桌面端 `pilot/src/shared/model-label.ts` 同一套规则。
 *
 * 标签只用于辨识同名端点（如「个人」「公司A」），不参与路由。电脑端最多
 * 保存四个字，手机端只负责展示，但仍然做一次归一化，防止旧版本或手改数据
 * 把空白和超长标签带到列表里。
 */

export const MODEL_TAG_MAX_LENGTH = 4

/** 按字符（而不是 UTF-16 码元）计数，4 个中文或 4 个 emoji 都算满。 */
export function modelTagLength(value) {
  if (typeof value !== 'string') return 0
  return Array.from(value.trim()).length
}

/** 收敛成可直接展示的标签：去空白、截到上限。 */
export function normalizeModelTag(value) {
  if (typeof value !== 'string') return ''
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return Array.from(collapsed).slice(0, MODEL_TAG_MAX_LENGTH).join('')
}

/** 列表/选择器文案：「模型名称 · 标签」；没有标签时只显示名称。 */
export function modelOptionLabel(name, tag) {
  const title = String(name || '').trim()
  const clean = normalizeModelTag(tag)
  if (!clean) return title
  return title ? `${title} · ${clean}` : clean
}
