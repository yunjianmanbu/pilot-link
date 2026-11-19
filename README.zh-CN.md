# Pilot Link

[English](README.md) | **中文**

Pilot Link 是 [Pilot](https://github.com/yunjianmanbu/pilot) 的手机端：连接电脑上运行的 Pilot，
在手机上读会话、继续对话、审批工具调用、管理队列与定时任务、预览会话写入的文件。
独立 Android App（uni-app，同一套源码也可以编译 H5），不是任何对话控制台的换皮版本 ——
数据层按 Pilot 的中继协议与会话模型实现，界面沿用 uni-app 的交互结构。

**Pilot 官方不提供公共中继服务。** 需要跨网络时请自行部署连接器：
<https://github.com/yunjianmanbu/pilot-connector>；同一局域网内 App 可以直连电脑。

## 功能

- 扫码配对电脑端 Pilot；配对信息与端到端密钥保存在本机，重启自动重连；
- 查看会话列表、完整历史与工作区，继续对话，实时查看流式文字与思考过程；
- 执行过程（思考 / 工具调用 / 工具结果）内联在会话消息中，默认折叠、可按单项展开；
- 会话级执行模式（全部自动 / 只读自动 / 逐条审批），工具调用审批、总是允许、拒绝，暂停、继续、停止；
- 排队消息与待办：编辑、删除、转待办、发送 / 全部发送；待办可转定时任务（一次 / 间隔 / 每天），也能转回待办；
- 发送图片（最多 3 张，本机压缩为 data URL）和参照其他工作区（最多 8 个，只发送工作区路径，
  由电脑端校验后只读提供给模型）；
- 新建、重命名、分叉会话，查看会话写入过的文件并预览文本内容；
- 选择电脑端授权目录下任意层级的已有文件夹作为工作区，或在当前浏览的位置新建子文件夹 ——
  手机只提交相对路径，浏览、校验与创建都在电脑端完成；
- 会话知识库：把每条指令和对应回复成对整理在一页，按 Markdown 渲染并可搜索、定位回原消息；
  列表缓存在本机，电脑离线时也能翻看和搜索；
- 保存多台已配对电脑并随时切换；已配对的手机可显示一次性换机二维码，另一台手机扫码连接同一台电脑；
- 深色 / 浅色 / 跟随系统主题，十款低饱和主题色，三档对比度与饱和度、三档字号；
- App 内检查更新：HTTPS 清单 + SHA-256 校验 + 用户确认后安装；
- 设置 → 帮助里内置完整使用手册，离线可看。

消息在手机与电脑之间端到端加密（ECDH P-256 + HKDF-SHA256 + AES-256-GCM），云端连接器只转发密文。
App 不需要登录任何账号。

## 协议适配

手机端通过云端连接器或局域网直连与电脑端通信，协议版本为 2：

1. 手机发送 `relay.hello`（role `phone`），业务帧统一包在 `{ type: 'relay.frame', data }` 中；
2. 加密会话使用 `hello` → `hello.challenge` → `hello.proof`（HMAC-SHA256）→ `welcome`；
3. 业务方法使用 Pilot 的 `device.info`、`sessions.*`、`chat.*`、`todos.*`、`queue.*`、`schedules.*`、
   `approval.*`、`files.*` 等；`chat.send` 可附带 `images`（data URL，最多 3 张）与
   `references`（工作区相对路径，最多 8 个），由电脑端再次校验大小、数量与路径；
4. 运行事件使用 `run.started`、`message.delta`、`reasoning.delta`、`tool.call`、`tool.result`、
   `tool.approval_required`、`run.completed`、`queue.changed`、`todos.changed` 等。

旧的 `hello.legacy` 仍可用，用于兼容升级前生成的配对。

### 文件预览

Pilot 只提供工作区内的文本预览，因此：

- 会话页「文件」入口调用 `files.session`，列出该会话成功写入的文件（`write_file` / `apply_patch`）；
- 打开文件调用 `files.read({ workspacePath, file })`，文本与 Markdown 直接渲染；
- 图片（≤12 MB）与文本直接预览；视频 / 音频、Office、PDF 等先分块下载到 App 私有目录
  `_doc/pilot-files/`，再交给系统应用打开，单文件上限 100 MB；
- 所有路径都由电脑端按工作区 realpath 越界校验，手机不能读取工作区以外的文件。

### 下载缓存

看过的文件在本机留几天，逻辑在 `lib/file-cache.js`：

- 第一次打开会下载，并把「最后一次查看时间」记进 `pilot-app.file-cache.v1`；
- 保存天数默认 7 天，在「设置 → 功能 → 文件缓存」里可以改（1 / 3 / 7 / 14 / 30 / 90 天，
  存在 `pilot-app.file-cache-days.v1`，取值夹在 1–365 天）；
- 天数内再打开直接用本地文件（不再走中继），并从这一次查看重新计时；
- 超过天数没看，App 启动时（`App.vue` 的 `onLaunch`）和每次打开文件前会删掉本地文件与索引；
  改小天数时也会立即清一遍已超期的条目；
- 索引按「工作区 + 工作区内的相对路径」区分，落盘文件名带路径哈希，不同目录的同名文件不会互相覆盖；
- 本地文件丢失、或电脑上文件大小变了，就当没命中，重新下载；页面上的「重新下载」按钮可以不等超期强制刷新。

## 目录

```
App.vue                 # 应用入口、主题变量
main.js                 # Vue 3 入口
manifest.json           # uni-app 配置（AppID、包名、图标、权限）
pages.json              # 页面路由
index.html              # H5 模板
lib/
  bytes.js              # base64url / UTF-8 / 随机数
  e2e.js                # 与电脑端 companion 一致的端到端加密
  pairing.js            # 配对载荷解析
  storage.js            # 多电脑配对、主题、按设备隔离的缓存
  client.js             # WebSocket 连接器客户端（心跳、重连、序号、加密）
  files.js              # 文件类型识别、分块读取与本地落盘
  file-cache.js         # 下载文件缓存：过期、续期、启动清扫
  clipboard.js          # 复制与选择复制
  format.js             # 时间、工具调用摘要、执行模式文案
  manual-content.js     # 使用手册正文
store/index.js          # 全局状态、方法调用与实时事件处理
pages/                  # launch / pair / sessions / chat / knowledge / files / file / select /
                        # settings / update / feedback / manual
scripts/gen-icons.mjs   # 生成 Android 图标与 9-patch 启动图（纯 Node）
static/                 # 图标、启动图
test/                   # 加密兼容、存储、更新、Markdown 等单元测试
```

## 开发

依赖 Node 22+：

```bash
npm install
npm test
```

H5 调试：在 HBuilderX 里打开本目录，运行 → 运行到浏览器；构建产物在
`unpackage/dist/build/web/`。`index.html` 必须保留
`<script type="module" src="/main.js"></script>`。

重新生成图标：

```bash
node scripts/gen-icons.mjs
```

## 打包 Android

两条路：HBuilderX **云打包**（需要账号与本应用的证书），或者用 Android SDK 加本仓库 `native/`
下的原生壳做**本地离线打包**。离线打包需要 Gradle 工程、离线 SDK 与 `zip4j` ——
缺了它 APK 能装但 App 内热更会失败。

每次发版：

1. 递增 `manifest.json` 的 `versionName` / `versionCode`；
2. 生成 APK 并计算 SHA-256；
3. 把 APK 与 `latest.json` 清单（含 size / sha256）发布到 HTTPS 服务；
4. 更新下载页。

### 资源包热更（wgt）

只改了 `pages/`、`lib/`、`App.vue`，没动原生类、权限、图标或 SDK 时，可以只发资源包：

- wgt 版本必须大于壳版本（`manifest.json` 的 `versionName`）；
- 装完 wgt 后 `plus.runtime.version` 变成资源包版本，App 用 `pilot-app.update-wgt.v1`
  本地记录兜底，避免重复提示同一个更新；
- 客户端把 `wgt` 当可选字段：缺失或域名不对时只丢弃该字段，照旧提示全量更新；
- 从来没发过 wgt 的旧壳必须先换全量 APK。

## 安全

漏洞请私下报告，见 [`SECURITY.md`](../SECURITY.md)。消息端到端加密，连接器不接触明文、会话内容与密钥。

## 许可

[Apache License 2.0](../LICENSE)，版权归 2026 rigongyizu。你需要保留版权声明与 [`NOTICE`](../NOTICE)
文件，并在修改过的文件里注明改动。第三方组件（@noble、uni-app 等）见 [`NOTICE`](../NOTICE)。
