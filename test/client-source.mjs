import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 跨仓库测试读桌面端源码的公共入口。
 *
 * 手机端的单测会断言「电脑端也有同一条协议 / 同一个确认」之类的一致性，
 * 为此要读 `pilot/pilot/src/...` 的源码。电脑端的 companion 协议与渲染层
 * 都在按域拆成多个文件（`companion/handlers/*`、`components/chat/*`），
 * 只读单个文件会得到「电脑端缺少 xxx」的假失败，所以这里统一按目录拼。
 *
 * 拆仓后子仓库 `pilot-link` 不含桌面端源码：读不到返回 null，
 * 调用方按原有约定 skip 而不是判失败。
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
export const CLIENT_ROOT = path.join(ROOT, '..', 'pilot')

/** 读客户端单个文件，缺失返回 null。 */
export function readClient(relative) {
  const abs = path.join(CLIENT_ROOT, relative)
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null
}

/** 读客户端某个目录下的全部 .ts/.tsx 源码并按文件顺序拼接，缺失返回 null。 */
export function readClientTree(relativeDir) {
  const root = path.join(CLIENT_ROOT, relativeDir)
  if (!fs.existsSync(root)) return null
  const walk = (dir) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry) => {
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) return walk(abs)
        return /\.(ts|tsx)$/.test(entry.name) ? [fs.readFileSync(abs, 'utf8')] : []
      })
  return walk(root).join('\n')
}

/**
 * companion 协议全文：server.ts 已按域拆到 handlers/*，
 * 断言 `case 'xxx'` 这类协议分支要读整棵目录。
 */
export function readCompanionProtocol() {
  return readClientTree('src/main/companion')
}
