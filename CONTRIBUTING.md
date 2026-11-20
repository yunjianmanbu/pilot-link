# 贡献指南

感谢你愿意改 Pilot。这个项目会真的在本机执行命令、读写文件、连手机，
所以我们对「改动是否可复核」的要求比普通前端项目更严：**每个 PR 都要带一条能复现的验证命令和它的输出。**

## 仓库结构

Pilot 由 4 个开源子项目组成，各自是一个仓库：

| 仓库 | 内容 | 主要语言 |
| --- | --- | --- |
| `pilot` | Electron 桌面客户端（主进程 / 渲染进程 / 内置 CLI / CLI 的 Web 控制台） | TypeScript、React |
| `pilot-link` | Pilot Link 手机端（uni-app）+ Android 壳原生工程 | Vue 3、Java |
| `pilot-client` | Pilot Client 手机反控端（uni-app） | Vue 3 |
| `pilot-connector` | 中继连接器（WebSocket 盲转发） | Node.js |

`site`（官网与下载清单）不开源，也不单独建仓库；`scripts`（构建 / 打包 / 发布 / 校验工具）、
`docs`（专题文档）、`examples`（插件示例）不单独建仓库，但随官网发布的源码包一起分发。
各开源仓库里的 `scripts/` 是从工作区复制进去的副本。

## 开发环境

- Node.js **20 或更高**（开发机验证用 22），包管理器：`pilot` 用 pnpm，其余用 npm
- Windows 上的原生打包额外需要 PowerShell 7、JDK 17、Android SDK（见 `pilot-link/README.md`）

```bash
cd pilot          && pnpm install && pnpm dev   # 桌面端开发
cd pilot-link     && npm install && npm test    # 手机端单测
cd pilot-client   && npm install && npm test    # 手机反控端单测
```

## 提交前必须自测

| 仓库 | 命令 |
| --- | --- |
| `pilot` | `pnpm typecheck && pnpm test` |
| `pilot-link` | `npm test` |
| `pilot-client` | `npm test` |
| `pilot-connector` | 见 `pilot-connector/README.md` 的部署验证一节 |

改到跨仓库共享脚本（`scripts/`）时，受影响的两个仓库都要跑一遍。

## 代码约定

1. **提交信息**：`type(scope): 摘要`，type 用 `feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `perf`。
   摘要写「做了什么」，不要写「修改了文件」。
2. **一次提交一件事**：顺手重构请单独成 commit，方便回退。
3. **不加新依赖**：除非在 PR 描述里说明为什么现有依赖做不到，并确认新依赖是 MIT / Apache-2.0 / BSD 这类宽松协议。
   Pilot 不接受 GPL / AGPL 依赖。
4. **不提交**：视频（`.mp4` / `.webm`）、签名证书（`.jks` / `.keystore`）、任何密码文件、`.env`、
   `node_modules/`、构建产物。这些都在 `.gitignore` 里，别用 `git add -f` 绕过去。
5. **路径不写死**：文档和脚本里不要出现个人机器路径（`C:\Users\你的名字\...`）。
   用 `%USERPROFILE%`、`$HOME`、`<你的工作区>` 或脚本自身位置推导。
6. **一次性脚本放 `tmp/` 或直接删掉**；验证过两次以上的检查、构建、发布动作要收敛成
   `scripts/` 下的脚本，并在头部写清「在仓库根目录一条命令跑通」的用法与退出码约定。

## 桌面端的额外约束

- 空 assistant 消息必须用 `agent/message-guard.ts` 的 `isEmptyAssistant` 过滤（发送前、回放前、落库前），
  否则部分模型会从 200 变成 400。
- 日志字段名含 `token` / `message` / `content` / `prompt` 会被整体脱敏，
  用量请写成 `input` / `output` / `cacheHit`。
- 权限模式、OS 沙箱、审批卡是安全边界，不接受「为方便而放宽默认值」的改动。

## Pull Request 清单

- [ ] 说明改了什么、为什么改（贴现象或 issue 链接）
- [ ] 贴出本地验证命令与输出
- [ ] UI 改动附截图；手机端改动说明测试机型与 Android 版本
- [ ] 没有夹带无关文件（`git diff --stat` 自查）
- [ ] 没有新增个人机器路径、密钥、媒体文件
- [ ] 文档同步更新（改了行为就改对应的 README 或 `docs/`）

## 谁能推 `main`

`main` 由 ruleset `protect-main` 保护：

- 维护者账号（`@yunjianmanbu`、`@embeddedmeng`、`@rigongyizu`）可以直接推送；
- 其他人一律 fork → PR，PR 必须拿到 1 个 CODEOWNERS（`@yunjianmanbu`）审批才能合入；
- 禁止强推（`non_fast_forward`）和删除 `main`。

所以外部贡献者不需要申请写权限，直接开 PR 即可；只有维护者会把你的分支 rebase 或 squash。
这条策略由 `scripts/setup-github-repos.mjs --protect-only` 维护，改名单请改脚本里的 `PUSHERS` 后重跑。

## 报告安全问题

不要开公开 issue，走 [`SECURITY.md`](SECURITY.md) 里的私下渠道。

## 行为准则

参与即表示同意 [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)。

## 许可

提交的代码默认以 [Apache License 2.0](LICENSE) 授权，保留 [`NOTICE`](NOTICE) 中的版权与商标声明。
