/**
 * tap-guard 的接线检查：用了就必须 import。
 *
 * 这条是真故障的回归：`pages/sessions/index.vue` 里调了 `tapGuarded()`，但 import
 * 只带了 `armTapGuard`。ESM 下这是运行时 ReferenceError，正好抛在点击处理器的
 * 第一行，于是「点全部任务」表现为完全没反应，界面上一点痕迹都不留，而生产构建
 * 又把 Vue 的警告去掉了，单测也照样全绿——只有真机 / H5 实跑才能发现。
 *
 * 这里不跑页面，只做静态对账：源码里出现的每个 tap-guard 导出名，都必须出现在
 * 该文件那条 import 里。
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PAGES = [
  'pages/sessions/index.vue',
  'pages/tasks/index.vue'
]
const EXPORTS = ['armTapGuard', 'tapGuarded', 'resetTapGuard']

for (const relative of PAGES) {
  test(`${relative} 用到的 tap-guard 函数都已 import`, () => {
    const source = fs.readFileSync(path.join(ROOT, relative), 'utf8')
    // import 语句位于 <script> 顶部，单独取出来对账，避免把注释里的名字算进去。
    const importLine = source
      .split('\n')
      .find((line) => line.includes("from '") && line.includes('tap-guard.js'))
    if (!importLine) return
    const imported = (/\{([^}]*)\}/.exec(importLine)?.[1] || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    for (const name of EXPORTS) {
      // 调用形态：name( 或 name(…)，排除 import 行本身与注释。
      const used =
        new RegExp(`(^|[^.\\w])${name}\\s*\\(`).test(source) ||
        new RegExp(`[^.\\w]${name}\\s*\\(`).test(source)
      if (!used) continue
      assert.ok(imported.includes(name), `${relative} 调用了 ${name} 但没有 import 它`)
    }
  })
}
