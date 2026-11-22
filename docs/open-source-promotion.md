# 开源推广素材包（awesome / HelloGitHub / 社区发帖）

这份文件解决一个具体问题：四个仓库的 README 首屏已经有动图、分享卡片和双语版本，但项目 stars 仍是 0 ——
缺的不是质量，是**被人看见的第一个入口**。这里把「入口」需要的东西全部写成可直接复制粘贴的文本，
免得每次发帖都要重新组织语言。

配套资产（都已入库，也被 README 引用，用来放 GitHub / Gitee 的社交分享卡片）：

| 资产 | 路径 | 用途 |
| --- | --- | --- |
| 首屏演示 GIF | `pilot/<子项目>/docs/social/{en,zh}/demo.gif` | README 首屏，由 `pilot/scripts/gen-readme-demo-gif.mjs` 从真实截图生成 |
| 分享卡片 | `pilot/<子项目>/docs/social/{en,zh}/social-preview.png` | GitHub 仓库 Settings → Social preview 手工上传；Gitee 在仓库设置里传 |

> 本文件会随 `split-repos.mjs` 复制到四个公开仓的 `docs/open-source-promotion.md`；
> 在单仓里上表路径简化为 `docs/social/{en,zh}/`（图随子项目一起带走）。

> GitHub 没有「自荐」按钮，也没有 Gitee 的 GVP / 推荐位；GitHub 上唯一的发现渠道是
> topics 搜索、Release 通知、别人收录进 awesome 列表、以及被 Newsletter 选中。
> 所以这份素材包的重点是**第三方收录**，而不是平台内推。

---

## 1. 一句话定位（先统一口径）

不同地方对字数要求不同，四个仓库各自一句，避免每次临时改写导致说法漂移。

| 仓库 | 一句话（中文，约 40 字） | One line (English, ~110 chars) |
| --- | --- | --- |
| `pilot` | 本地优先的桌面编程智能体：读代码、跑命令、改文件、自己验证，全部在一个文件夹里，不注册不上云。 | A local-first desktop coding agent: reads your code, runs commands, edits files, verifies the result. No sign-in, no cloud. |
| `pilot-link` | 把电脑上的智能体接到手机上：扫码配对，远程发任务、看输出、按风险等级审批。 | The phone side of Pilot: pair by QR, send tasks from your phone, watch output live, approve by risk level. |
| `pilot-client` | 反过来：让电脑端操作你授权的手机，每类能力单独授权，全部动作进脱敏审计。（Beta） | Beta: let the desktop operate a phone you authorize — per-capability grants, every action in a redacted audit log. |
| `pilot-connector` | 一条命令自建的盲中继，跨网络连手机，只按房间转发帧、不落盘、不持有密钥。 | A blind relay you deploy yourself: forwards frames by room, stores nothing, holds no keys. |

**统一禁忌**：不要用「国内的 Cursor / Devin」这类借势说法（既得罪对方用户，也容易在 awesome 列表 PR 里被判为营销）。
要强调的是「一个文件夹就是全部环境」「改动必须过审」「不注册不上云」这三条可验证的事实。

---

## 2. awesome 列表 PR（最能带来长期流量）

### 2.1 候选列表与判断

提交前**必须**读该仓库的 `contributing.md`：条目格式、排序方式（多数是按字母序插在对应分类里）、
是否要求「项目至少 N 星」——不少列表明确写着「不要给自己提交」，这种就别试。

| 列表 | 适合哪个仓库 | 会被拒的常见原因 |
| --- | --- | --- |
| `sindresorhus/awesome-electron` | `pilot` | 条目需带一句话说明且不加营销词；只收 Electron 应用，不收「AI 概念」 |
| `e2b-dev/awesome-ai-agents` | `pilot` | 分类要对（Coding agents）；表格行需一行写完 |
| `awesome-selfhosted/awesome-selfhosted` | `pilot-connector` | 要求有明确的自托管部署文档 + 许可证；「中继」这类基础设施不一定被收 |
| `jaywcjlove/awesome-mac` | `pilot` | 需提供可直接下载的 macOS 包；本项目目前只有 Windows 安装包 → **暂不提交** |
| `rust-unofficial/awesome-rust` 等语言向列表 | — | 语言向列表只看库，不看应用 → **不提交** |

### 2.2 条目文案（改分类名后直接粘贴）

`pilot` — 提交给 AI agent 类列表：

```markdown
- [Pilot](https://github.com/yunjianmanbu/pilot) - Local-first desktop coding agent: reads a folder, runs commands, edits files and verifies the result, with change review and checkpoints. No sign-in.
```

`pilot` — 提交给 Electron 类列表：

```markdown
- [Pilot](https://github.com/yunjianmanbu/pilot) - Local-first AI coding agent for the desktop: task plan, per-file diff review, checkpoints, built-in CLI.
```

`pilot-connector` — 提交给自托管 / 基础设施类列表：

```markdown
- [Pilot Connector](https://github.com/yunjianmanbu/pilot-connector) - Blind WebSocket relay for your own devices: forwards frames by room, stores nothing, holds no end-to-end keys. ([Source Code](https://github.com/yunjianmanbu/pilot-connector)) `Node.js` `Apache-2.0`
```

### 2.3 PR 正文（英文，一段话）

```markdown
Adds Pilot, a local-first desktop coding agent (Electron + React).

What makes it different from the other entries: it keeps the whole execution environment inside one
folder on the user's machine — no account, no cloud database — and it treats every file edit as a
reviewable change with a per-file diff and a checkpoint before the run, instead of streaming edits
that the user has to unwind by hand.

- Repo: https://github.com/yunjianmanbu/pilot
- License: Apache-2.0
- Installers: https://pilot.medpilot.cc/#download
- Screenshots and a short demo GIF are in the README.
```

---

## 3. HelloGitHub 自荐

HelloGitHub 的收录是编辑人工挑选，自荐入口在 <https://hellogithub.com/> 的「自荐」表单（也接受邮件）。
下面这段按它惯用的字段组织，**提交前先打开当期表单核对字段名**，字段变了照表单填、内容照这份复用。

```markdown
项目名称：Pilot
项目地址：https://github.com/yunjianmanbu/pilot
项目简介（一句话）：本地优先的桌面编程智能体，一个文件夹就是全部工作环境，不注册、不上云。
项目简介（三句话）：
  它把你机器上的一个文件夹当作执行环境：读文件、搜代码、跑命令、改文件、维护计划，
  并在真实运行之后复盘，把经验写进项目记忆。
  和同类工具最大的差别是「改动必须过审」——每处修改都有按文件的差异对比、执行前的回退点，
  以及「回答」与「改动」两种完全不同的呈现。
  界面 Electron + React，填入自己的模型 Key 即可用，无账号体系。
推荐理由：
  1. 本地优先是设计而不是开关：没有云数据库，会话、记忆、审计日志全部落在自己的磁盘上；
  2. 可验证的改动流程：diff → 验收命令 → 回退点，适合把 Agent 用在自己真实项目上的场景；
  3. 四端协作：桌面端 + Android 控制端 + 手机反控端（Beta）+ 自建盲中继，都能自己部署。
  4. 代码全开源（Apache-2.0），每个子项目都有中英双版 README、截图与架构图。
项目语言：TypeScript / JavaScript
许可协议：Apache-2.0
演示/截图：README 首屏有 GIF；分享卡片见 docs/social/{en,zh}/social-preview.png
```

中文版提交时注意两件事：

1. **不要写「求 star」**——编辑最反感这句，且会被直接跳过。
2. 附一张能一眼看懂的图（`docs/social/zh/social-preview.png`，1280×640），比附十张截图有效。

---

## 4. 中文社区 / 个人博客发帖骨架

适合 V2EX、掘金、少数派、知乎。三个仓各写一篇太长，**只写 `pilot` 一篇**，其余在文末用一段话带过。

标题候选（选一个，别叠加感叹号）：

- 「我给自己的编程 Agent 加了一条硬规则：每处改动都要能看 diff、能回退」
- 「不注册、不上云：把编程 Agent 的全部状态留在自己的文件夹里」
- 「手机上也能批准 Agent 的每一步：一个本地优先 Agent 的四端结构」

正文骨架：

1. **问题**：现有 Agent 工具要么把状态放在云端，要么边跑边改、改完才发现不对。
2. **三条设计决定**（每条配一张图）：
   - 一个文件夹就是全部环境（`docs/screenshots/zh/main.png`）
   - 改动必须过审，回答与改动长得不一样（`change-review.png`、`answer-changes.png`）
   - 执行前有回退点（`checkpoint-dialog.png`）
3. **一个具体例子**：跑一次真实任务，贴出 diff、验收命令和回退点。
4. **边界**：Beta 的被控端明确列出「需要原生服务的能力尚未接通，一律返回 not_granted」，主动写出限制比藏起来更可信。
5. **文末**：GitHub 与 Gitee 双链接 + 下载页；说明中继要自己部署（没有公共中继）。

---

## 5. 发布节奏与禁忌

- **一个渠道一周最多一次**：同一天把同一个项目贴到五个群，会被当成广告号，后续账号内容都会被折叠。
- **Release 之后 24 小时内发帖**：读者点进去要能看到 `v<最新版本>`，而不是半年前的最后一次提交。
- **不要买 star、不要互 star**：GitHub 会识别，且 awesome 列表审查会看贡献者构成。
- **每个 PR / 帖子都要能被验证**：截图、下载链接、许可证、`README` 首屏——缺一个就会被当作未完成项目。
- **Gitee 侧**：仓库「项目介绍」里那句描述与 GitHub description 保持一致；Gitee 的推荐位是编辑挑的，
  能做的只有「描述清楚 + 有图 + 持续更新」，没有可提交的自荐入口。

---

## 6. 发出去之后看什么

| 指标 | 在哪看 | 判断 |
| --- | --- | --- |
| stars / forks / watchers | 各仓首页 | 4 仓 0 星 → 有任何非 0 增长就说明入口生效 |
| Release 资产下载数 | GitHub Release 页每个资产的下载计数 | 下载数 >> star 数说明「有人要但不愿留痕迹」，属于正常 |
| Gitee 收藏 / 浏览 | Gitee 仓库「统计」 | 中文流量的真实来源 |
| 官网下载量 | 服务器访问日志 `download.medpilot.cc` | 最终转化，比 star 更说明问题 |

回流之后要做的不是继续发帖，而是**把新读者提出的第一个疑问写进 README**：
「这东西要不要 API Key」「会不会把我的代码传上去」「手机上批准是不是要公网 IP」——
这三个问题出现频率最高，对应 README 的「隐私」「部署」两节。
