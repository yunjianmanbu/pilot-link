/**
 * 把界面语言钉成中文，供断言中文文案的测试文件在**第一个** import 里引入。
 *
 * 为什么要钉：这些用例断言的报错文案是中文（中文本身就是 locale 字典的 key），
 * 而 i18n 在模块加载时按运行环境语言选 locale——开发机是 zh-CN，GitHub Actions
 * 的 runner 是 en-US，于是同一份测试本地全绿、CI 里成片变红
 * （期望 /格式不正确/，实际 "Invalid format"）。
 *
 * 为什么不做成全局 --import：i18n.test.mjs 自己要断言 en 的行为，
 * 全局钉死会把它一起弄红。所以按文件引入，只影响真的依赖中文文案的用例。
 */
import { applyLocale, getLocale } from '../lib/i18n.js'

applyLocale('zh-CN')

if (getLocale() !== 'zh-CN') {
  throw new Error(`测试语言没能钉成 zh-CN，当前是 ${getLocale()}`)
}