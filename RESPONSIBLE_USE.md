# 负责任使用与反滥用政策

**English summary at the end.** 本文件适用于 Pilot 的全部组件：桌面端（含内置 CLI 与 Web 控制台）、
Pilot Link（手机端，手机控电脑）、Pilot Client（手机反控端，电脑控手机）、Pilot Connector（自建中继器）。

> 一句话：**这套软件只能用于你拥有、或已获得设备所有者明确授权的设备。**
> 我们不会为了"更好卖"给任何能力留后门，也不会为拿它作恶的人背书。

---

## 1. 它不是隐蔽监控工具

远控类软件最大的失信点，是"能做"和"偷偷做"之间的界线。这条界线在本项目里是**写进代码的默认值**，
不是文档里的承诺：

| 产品上已经做死的选择 | 位置 |
| --- | --- |
| 不做静默后台录屏 / 录音：屏幕采集必须前台可见提示 + 通知栏常驻 | [`reverse-control-plan.md`](https://github.com/yunjianmanbu/pilot-client/blob/main/docs/reverse-control-plan.md) 第四节 |
| 清空手机、重启手机属 L4，**默认策略上限 L3，直接拒绝**，要显式放开 | `pilot-client/lib/reverse-control.js` 的 `DEFAULT_POLICY` |
| L2 以上每条命令都要手机端逐次确认，确认失败按拒绝处理 | `reverse-control.js` 的 `createGateway` |
| 每条命令都写审计，**包括被拒绝、参数非法、执行失败的** | 同上，`fail()` 与成功分支各写一条 |
| 审计里剪贴板正文等敏感参数脱敏，只留时间 / 等级 / 结果 / 耗时 | `pilot-client/lib/audit.js` |
| 清空审计要二次确认，且历史不在电脑端留副本 | `pilot-client/pages/audit/index.vue` |
| 用户至少有三条独立路径发现"有人在操作我的手机"：悬浮提示、通知栏、审计记录 | 方案文档第四节第 3 条 |
| 中继是**盲转发**：不落盘、不解析载荷，因此也不可能被要求交出货真价实的内容 | [`pilot-connector` README](https://github.com/yunjianmanbu/pilot-connector#security-model)、其 `SECURITY.md` |

我们明确拒绝把它做成"监控软件"。这不是因为技术上做不到，而是因为那条路同时毁掉应用商店资格、
法律立场与用户信任，而这三样恰好是这个产品唯一的价值来源。

## 2. 允许的用途

- 个人或家庭：自己的电脑、自己的手机之间的远程协助（例如帮长辈操作手机、把电脑文件传到手机）。
- 企业内部 IT：运维自己管理的设备，前提是设备使用与员工告知流程符合当地法律与公司制度。
- 开发与调试：在自己或团队拥有的设备上自动化、录制、压测。
- 教学与演示：明确告知在场设备所有者的场景。
- 集成与二次开发：Apache-2.0 允许你闭源集成、改造、商业分发 —— 见第 4 节。

## 3. 禁止的用途

以下用途一律不允许，**无论是官方构建还是经你修改的构建**：

1. 控制未获得所有者明确同意的设备，或绕过对方的确认、审计与可见提示。
2. 在对方不知情的情况下监控其屏幕、通知、短信、通讯录、位置、相机或麦克风
   （包括伴侣、子女、员工、租客、老人）。
3. 窃取凭据、验证码、文件、聊天记录；或为上述行为提供工具、代操作服务。
4. 群控养号、批量注册、刷量、绕过平台风控与反作弊、自动化诈骗与引流。
5. 勒索、骚扰、跟踪、人肉；未经授权删除数据或擦除设备。
6. 任何违反设备所在地法律的行为。

我们在这类场景下的处理：不提供技术支持、不接受基于滥用场景的 issue 与咨询、
在必要时配合执法机关，并在官网与发布说明中**公开切割**使用本项目的滥用产物（见第 6 节）。

## 4. 法律边界（诚实版）

很多同类项目会在 LICENSE 里加一句"仅限合法用途"。这里不这样做，原因需要说清楚：

- **Apache-2.0 不允许附加额外限制。** 加了"仅限合法用途"就不是 Apache-2.0 了，
  项目也不再是 OSI 认可的开源项目 —— 而开源带来的信任与分发正是这个产品的基础。
  一句自己加上去的限制，法律上多半无效，商业上却会失去开源身份，是两头落空。
- **真正可用的杠杆只有三个**：
  1. **商标**：Apache-2.0 第 6 条不授予商标权，`Pilot` / `Pilot Link` / `Pilot Client` 的名称与 Logo
     不在代码许可范围内，修改版不得暗示官方关联（见 `NOTICE`）。
  2. **不作担保**：Apache-2.0 第 7、8 条已经排除了担保与衍生责任。
  3. **本文件作为意图证据**：它记录"官方支持什么、从未支持什么"。
     将来有人拿改过的版本作恶，这份带日期的文档就是最直接的对照物。
- **所以本文件的效力来自**：品牌、官方分发渠道（官网 / 应用商店）、企业客户尽调、以及出事时的追责口径 ——
  **不是**来自它能不能约束一个已经下载了源码的人。我们不会假装它能。
- 你 fork、改名、闭源、商用都是许可给的权利；我们同时保留**不背书、不提供支持、要求去掉品牌标识**的权利。
  这两句话并不矛盾，它们就是这个项目的真实边界。

## 5. 技术护栏与默认值

| 护栏 | 默认值 | 位置 |
| --- | --- | --- |
| 危险能力上限 | `maxLevel: 3`，L4（清空手机 / 重启）默认拒绝 | `pilot-client/lib/reverse-control.js` |
| 逐次确认 | L2 及以上每条命令都要手机端确认 | 同上 `createGateway` |
| 调用限流 | 每条命令 60 次 / 分钟 | 同上 `DEFAULT_POLICY.perMinute` |
| 审计 | 全路径记录，脱敏，最多 200 条 | `pilot-client/lib/audit.js` |
| 中继监听地址 | `BIND=127.0.0.1`，只允许反代接入 | `pilot-connector/server.mjs` |
| 中继房间 / 帧 / 速率 | 每房间最多 4 台手机、单帧 1 MB、每条连接 900 条 / 分钟、心跳连丢 3 次断开 | 同上 |
| **按来源 IP 的连接上限** | `MAX_CONNECTIONS_PER_IP=64`（`0` 关闭） | 同上，`upgrade` 阶段计数 |
| **IP 黑名单** | `RELAY_BLOCK_IPS=1.2.3.4,5.6.7.8` | 同上 |
| **L1 准入码** | `RELAY_ACCESS_KEYS=home:<随机>`，`RELAY_ACCESS_STRICT=1` 强制；默认先只记录 | 同上，建房间前校验，不通过的拿 `4009` |
| **随机连接路径** | `WS_PATH=/c/<32 位十六进制>`（安装脚本自动生成） | 同上，`upgrade` 阶段判定 |
| 中继日志 | 不记录帧内容，只保留连接数与健康检查状态 | `pilot-connector/README.md`「安全边界」 |

最后三项是给**中继运营方**的：中继读不到载荷，所以运营方唯一的合规止损手段就是"按来源断流"
或"先不发连接串"，而不是"看内容判断"。准入码与随机路径的作用是让地址泄露后不至于直接变成
免费带宽，它**不是**内容保护，也不是账号体系。这个限制是设计使然，见
[`pilot-connector` 的 SECURITY.md](https://github.com/yunjianmanbu/pilot-connector/blob/main/SECURITY.md)。

## 6. 滥用举报与处置

**举报渠道**

- 邮件 `yunjianmanbu@126.com`，标题加 `[ABUSE]`（与安全漏洞 `[SECURITY]` 分开，走各自流程）；
- 或通过 GitHub Security Advisories 私下提交（涉公开传播风险时用它）。

**请附**：涉及的产品与版本、看到的滥用形态（钓鱼页面 / 售卖贴 / 应用商店条目 / 被控设备截图）、
链接或包名、你是否是设备所有者或受影响方。**不要**在公开 issue 里贴可复现的利用细节。

**我们能做与不能做**

| 我们**能**做 | 我们**不能**做 |
| --- | --- |
| 下架官网 / 官方下载渠道里被滥用的产物 | 远程关停别人自建的中继或自编译的客户端 |
| 收回品牌使用许可，公开发布"非官方产物"说明 | 阻止第三方继续分发 Apache-2.0 授权的源码 |
| 向云厂商 / 主机商 / 应用商店出具项目性质说明与官方产物哈希清单 | 代替平台或执法机关做取证与裁决 |
| 在发布说明与 SECURITY 公告里记录滥用形态与官方立场 | 应"帮我看看别人手机"之类请求提供任何配合 |

**响应口径**：3 个工作日内确认收到；确认属于滥用后，优先撤下官方分发渠道，再走品牌与公告手段。
本文件不构成对第三方行为的担保，也不构成法律意见。

## 7. 部署方自查清单

企业内网、外包运维商、托管中继服务商在部署前逐条确认：

- [ ] 被控设备的所有者**书面**知情并同意，告知内容包含：能看到什么、能操作什么、记录留多久。
- [ ] 员工场景已履行当地法律要求的告知 / 协商程序（工会、公示、隐私政策），并只用于工作设备。
- [ ] 中继地址使用 `wss://`，`BIND` 保持回环，TLS 终结在 nginx / Caddy，不直接暴露明文 WebSocket。
- [ ] 中继启用了 `RELAY_BLOCK_IPS` 应急预案与 `RELAY_ACCESS_STRICT=1`，且日志保留策略符合当地法律（中继本身不记内容，这一点要写进告知书）。
- [ ] 手机端 `maxLevel` 按最小必要设置（只做屏幕协助就停在 L2），`wipe` / `reboot` 保持默认关闭。
- [ ] 审计记录的留存与导出流程明确；知道审计只存在手机本机、清空不可恢复。
- [ ] 配对凭据与二维码按一次性凭据管理，不截图外传、不进共享文档。
- [ ] 已在自己的隐私政策 / 服务条款里声明调用哪一方、用于什么目的。
- [ ] 出事时有指定负责人与对外口径（谁能停服务、谁能对外说话）。
- [ ] 若对外提供中继托管服务，已在服务条款里写明禁止用途与终止权。

## 8. 司法辖区提示（非法律意见）

- **中国大陆**：《网络安全法》《数据安全法》《个人信息保护法》对个人信息处理有告知同意要求；
  未经授权控制他人计算机信息系统可能触及刑法相关条款。远控类工具通常按"双用途"审查，
  举证时"产品默认值"与"是否可见、可审计"是核心事实。
- **欧盟 / 英国**：GDPR 对员工监控与个人数据处理有单独要求；提供给他人的远控能力需要
  明确的合法基础与透明度。
- **美国**：CFAA 类条款对"未经授权访问"的解释因巡回法院而异；带可见提示与所有者同意的场景
  与隐蔽植入在实务上差别巨大。

产品在这些辖区里的共同安全做法只有一条：**让被控方随时可见、可中断、可追溯**。
这也是本项目默认值的设计目标。

## 9. 变更

- 版本：1.0（2026-11）
- 本文件随项目发布，变更记录进各仓库的发布说明；涉处置口径的修改会在 `SECURITY.md` 同步。
- 疑问与讨论走 GitHub Discussions；举报走第 6 节的私下渠道。

---

## English summary

**Intended use.** Pilot's desktop app, Pilot Link, Pilot Client and Pilot Connector may only be used on
devices you own or are explicitly authorized to control.

**Not a covert monitoring tool.** The defaults are code, not promises: destructive commands
(`rc.device.wipe`, `rc.device.reboot`) sit above the default policy ceiling and are refused; every
level-2+ command needs an on-phone confirmation; every command — including refused and failed ones —
is written to a redacted on-device audit log; the relay never stores or parses frame payloads.

**Prohibited.** Controlling devices without the owner's consent; covert monitoring of a partner,
child, employee or tenant; stealing credentials, SMS, files or screen content; bulk account farming,
scam automation, or bypassing platform anti-abuse systems; blackmail, stalking, unauthorized data
deletion; anything illegal where the device is located.

**License boundary, stated honestly.** This policy is **not** an added condition of the Apache-2.0
license — adding one would make the project non-open-source and would not be enforceable anyway.
The levers that actually exist are the trademark (not granted by Apache-2.0 §6), the warranty
disclaimer, and this document as a dated record of what the project does and does not support.
You may fork, rebrand and ship commercially; we may decline endorsement, support and the use of our
names and logos.

**Reporting abuse.** Email `yunjianmanbu@126.com` with `[ABUSE]` in the subject, or use a private
GitHub Security Advisory. We can remove abused artifacts from official channels, revoke brand use and
publish notices; we cannot remotely shut down someone else's self-hosted relay or self-built client.
We acknowledge reports within 3 business days.
