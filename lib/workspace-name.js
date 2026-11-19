
import { t } from './i18n.js'// 手机端新建工作区时的名称校验，与电脑端 workspaces.create 的规则保持一致。
// 这里只做输入即时反馈，最终仍由电脑端按授权目录重新校验。
const NAME_MAX = 64
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]/
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

export function validateWorkspaceName(value) {
  const name = String(value || '').trim()
  if (!name) return { ok: false, name: '', error: '' }
  if (name.length > NAME_MAX) {
    return { ok: false, name, error: t("名称最多 {v1} 个字符", { v1: NAME_MAX }) }
  }
  if (name === '.' || name === '..' || INVALID_CHARS.test(name)) {
    return { ok: false, name, error: t("名称不能包含 / \\ : * ? \" < > | 等字符") }
  }
  if (name.endsWith('.') || name.endsWith(' ')) {
    return { ok: false, name, error: t("名称不能以点或空格结尾") }
  }
  if (RESERVED_NAMES.test(name)) {
    return { ok: false, name, error: t("这个名称是系统保留名，请换一个") }
  }
  return { ok: true, name, error: '' }
}
