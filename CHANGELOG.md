# 变更记录

## 1.13.2 — 2026-09-24 · 取回完整性、统计卡生命周期与界面反馈

- 修复超过 262,144 字符的原文返回截断预览却被当作完整结果的问题：有读回能力时兼容同步和异步接口；无接口、读取失败或读回仍截断时返回完整原文路径，供 read 工具继续取回。当前本机宿主没有 readText，超长结果走路径提示。
- 重置计数只清统计，不清原文缓存、去重缓存及回放索引。修正文档里内存 id→locator 索引被称为跨重启持久化的说法。
- 统计卡按请求完成时间安排轮询；写入使旧读取失效；写入成功后等回读再解锁；卸载中止请求；HTTP/超时错误可见，首次读取失败有重试按钮。
- 纯视图改用 renderSaveTokenView 名称，和 React 组件区分；卡片通过 React 元素挂载。新增真实组件生命周期测试，覆盖异步加载后的渲染和竞态，保留原有静态渲染断言。
- 压缩/去重开关补 aria-pressed，显示保存进度；重启后恢复默认的提示移到正文；KPI 自适应列宽，卡片操作行允许换行；纠正“无开关统计台”与实际功能不符的表述。
- 缩短插件元数据说明；package.json 与 lockfile 同步到 1.13.2；补齐四个运行文件的语法门禁。

验证：旧实现新增取回断言 6 条失败 → 修复后 verify-save-token 47/47；verify-token-lifecycle 18/18；完整检查结果见本轮报告。桌面截图接口报 SetIsBorderRequired/0x80004002，点击报 geometry unavailable；未把自动化渲染当作桌面视觉验收。

本轮没做的：保留“不做确定性压缩兜底”的决定。未增加第二压缩实现或抢占 request-error；未添加仅凭压缩字节数判断语义丢失的面板；未改用户的常驻规则和默认开关。


## 1.13.1 — 2026-09-23 · 修「会话策略」整页白屏（1.13.0 的回归）

现象（用户重启后报）：设置页点「会话策略」，右侧一片空白 —— 只剩标题栏与关闭按钮，
控制台一个字都没有。**不是槽没注册**（左栏目录里那一项在，`__DSH_BOOT__` 里 rev 也是新的），
而是整页渲染抛错被槽静默吞掉：production React 在错误边界里不打日志，所以"什么都没看见"。

**根因**：`SaveTokenCard` 把纯视图写成元素调用 `h(SaveTokenView, { d, … })`，而
`SaveTokenView` 的签名一直是 `(夹具, 回调)` —— React 把 props 对象当第一个实参传进来，
视图照旧读 `d.flags.expandTool` ⇒ `Cannot read properties of undefined`。一处卡片抛错，
`CacheControlPage` 整棵树跟着没了，于是九块一起白屏。

**为什么 1.13.0 的 99 条断言没拦住**：套件里只按**位置调用**喂夹具（`internals.SaveTokenView(FIX, {})`），
也就是"测试用的口径"和"页面里失败的那次调用"不是同一个 —— 40 条 I 组全绿，页面上一个字没有。
这类洞靠加断言堵不住"没跑过的调用形式"，只能靠**页面上真看得见**。

**改法**（都在 `client.js`）

- 取数半截改成与套件同口径的位置调用：`SaveTokenView(d, { busy, error, onToggle, onReset })`，
  旁边写明"别写成 `h(SaveTokenView, …)`"，把 2026-09-23 这次白屏记在原地。
- 新增 `PageBoundary`（与既有的 `ChipBoundary` 同一套办法）：整页抛错时把 `error.stack`
  显示在面板里并 `console.error`，**不再静默白屏**。槽是别人的，日志开关不在我们手里，
  那就把错误搬到自己能看见的地方。

**套件**：`verify-gate-client.mjs` 99 → **101 项**

- 取数半截按位置调用视图（源码守卫；匹配前先剥注释，否则会拿旁边那句说明判自己失败）。
- 设置页有错误边界（源码守卫，锁住"抛错要可见"）。

`npm test` → 语法门禁 0/0、**套件 10/10 通过**（verify-gate-client 101 条、verify-save-token 40 条）。
版本 → 1.13.1。

**顺带查到的一条环境事实**（写进 README「本机自检」）：client 半的 `?rev=` 是**内容哈希**，
改完 `client.js` 存盘、刷新页面就加载新代码 —— 不必重启 DSH Desktop。host 半（`index.js` /
`save-token-host.js`）才需要重启，因为模块只在 `name`/`inject`/`group` 变化时重新 import。

## 1.13.0 — 2026-09-23 · 并入 dsh-plugin-save-token：本插件第一次有模型工具

起因（用户）：蒸餾一遍"上下文医生 / save-token / dsh-context / memos / distillly 及同类高星项目"，
再决定各能力**嵌进哪个已有插件**（前提：不能互相冲突、不能功能重复）。这一版只落 save-token 那一条：
**整套嵌进来，但砍掉它的 compaction assist**。其余四个的判断结果在末尾「本轮没做的」。

**怎么嵌的**

- 上游 host 半 `src/index.js` → `save-token-host.js`，纯函数核 `src/compress.js` → `save-token-core.js`
  （25 KB，零 import）。**不是新的 roster 条目**：`index.js` 里以 `ctx.plugin(saveToken, config)`
  嵌套挂载，`inject` 仍是 `['webServer']`，日志 `host up (…) saveToken=mounted|absent` 交代挂没挂上。
- 挂载点是 `tools/post-execute`（prepend）+ `llm/stream`，以及 `spillStore`（`ctx.get()` 懒取，可选）。
- 路由从 `/save-token/*` 改到 `/cc/st/*`（前缀注册，与自家 `/cc/*` 同族）：`api/dashboard` /
  `api/set-enabled` / `api/reset`。
- client 半**合成一张卡**写进既有 `client.js`，没有第二次 `.load({id})`：上游的 `settings.section`
  面板（order 430）与本插件既有的 order 58 合成同一张「省 token」卡（页面里第 2 块，紧跟「省缓存」）。
  跨模块没法两个 bundle 拼一张卡，所以是**改写**而不是搬运。

**冲突面（用户的原话是"不能互相冲突"，逐条交代）**

- **删掉上游 compaction assist 整段**（`agent/pre-step` 压力触发、水位线、冷却期、`compactStats`、
  `ctx.get('compaction')`，以及喂它的 per-session estimate/billed 表）。理由：本插件「省缓存」已经是
  那个引擎的唯一所有者（triggerPct / retainPct / auto + 逐字节 backup/restore），两套阈值抢同一个
  preset 行必然打架。**删除而非默认关**——默认关只是把冲突藏起来。组合断言钉住这一点：
  client 源码里 `/compactAssist|compact-assist|compactionAssist/` 一处都不许有（不是"值为 false"）。
- **不装上游的 `conversation.composer.dock` 常驻小条**：那个槽位是 dsh-bill 的（它在同一位置画每
  会话费用行），同一格两块 UI 互相挤。断言：client 源码里不许出现 `inject('conversation.composer.dock'`。
- **`settings.section` 仍只注册一次**（断言计数 === 1）：省 token 是**同一张卡里的一块**，不是第二个设置页。

**主动砍的（不是漏的）**

- 上游面板的英文/中英双语文案 → 全中文（本仓库别处都是中文）。
- 没有加"刷新"按钮：卡片本来就 2.5 秒轮询一次，按钮是冗余（YAGNI）。
- 两个开关（压缩 / 去重）**存内存、不写 `settings.json`**、重启回默认开；计数同理。它们是临时闸不是配置。
  代价已在 README 与卡面说明里写明（换机器不用拨、导出导入也搬不走）。

**验证**

- 新增 `tools/verify-save-token.mjs`：**40 条**。真跑压缩（15,862 B → 6,526 B）再用
  `save_token_expand` 逐字节还原比对；无 `spillStore` 时原样透传（可逆性优先）；`/cc/st/api/*`
  三端点含 404 与开关键名；嵌套挂载面用假 ctx 覆盖。
- `verify-gate-client.mjs` 加 **I 组共 19 条**：视图被拆出独立的 `SaveTokenView`（取数那半步在
  `useEffect` 里，SSR 跑不到）后喂夹具渲染——KPI 换算、字节条归一（100% / 50% / 下限 4%）、
  活动表配色、sparkline 是内联 SVG、点击回调送出的键与值、三种降级（spillStore 不可用 / 空态 /
  没有 estRatio 时不占位），以及上面三条冲突面断言。分区数 8 → 9，两处断言口径同步。
- `npm test` → 语法门禁 0/0、**套件 10/10 通过**（verify-gate-client 99 条、verify-save-token 40 条）。

**分发面（这次真的动了打包）**

- `package.json`：`files` 补 `save-token-host.js` + `save-token-core.js`（**漏了就是装上去就崩**，
  它们是 `index.js` 的静态 import），版本 1.12.4 → **1.13.0**，description 同步九块。
- `NOTICE` 追加 save-token 的 MIT 署名 + 改动范围（删了哪一段、为什么、没装哪个槽位）。
- 这是本插件第一次**注册模型工具**（工具表多一行 `save_token_expand`）、第一次**依赖 disk spill**、
  第一次在 `/cc` 下开非 settings 路由 —— 三件事都在上一版都没有。

**本轮没做的（判断结果，写给下一个接手的人）**

- **dsh-context 不吸收**：它的上下文事件能力只在 dsh-bill 里加一条**只读时间线**（计数级、不含正文），
  本次未落；实际内容浏览（Context Browser）**不许**搬进 dsh-bill（那边 README 承诺过只统计不读正文）。
- **上下文医生 → 本插件**：它的确定性压缩兜底（compaction 失败时按确定性规则降级）已列入候选表，
  但**不在本轮三个已答问题里**，未动。要做先问。
- **memos**：只取 `rejected_solution`（否决过的方案）这一类记忆进 MemSearch，未落。
- **distillly / distill**：自动反思 + 归属 frontmatter（`distilled-by`）进 MemSearch，未落。

## 2026-09-23 · 本地维护：清出两个入库备份

- 删除 `client.js.bak-20260910-143611`（87 KB，2026-09-10 的客户端快照）与
  `session-gate.R4-backup-2026-09-16.md`（6.4 KB，R4 摘出时的原文备份）。依据：`git grep` 全仓只有
  README/CHANGELOG 提到它们，没有任何代码或套件读它们；两者都**按路径仍可从历史取回** ——
  `git show 47e6bc5:client.js.bak-20260910-143611`、
  `git show 98fa1af:session-gate.R4-backup-2026-09-16.md`（历史里存的是 LF 版本，因
  `core.autocrlf=true` 在检出时转成 CRLF，所以工作区比 blob 大 69 字节＝69 行）。所以这是**撤销** 1.12.4
  条目末尾「留着」的决定，不是丢内容；README「要收回原文备份」的指引同步改成上面那条 `git show`
  （或 v1.9.1 之前的 `git show 566d276:session-gate.md`），避免留一个指向已删文件的操作说明。
- **不升版本**：无行为变化。`npm test` → 语法门禁 0/0、套件 9/9 通过、exit 0。

## 1.12.4 — 2026-09-21 · 修三段规则的冲突与交叉（跨段去重，口径不降）

起因（用户）："这些多规则的是否会有冲突或者功能交叉？"——查完确实有 3 处真冲突 + 4 处内容交叉。
本版按 **B 档**处理：修冲突 + 合并交叉，**不砍任何约束**（用户口径：质量只能多不能少）。

**冲突（都已消除，可复核）**
- **C1 同一事实两处真源**：ponytail 原自带一节「输出形状」（代码优先 / 之后最多三行短话），与 shape-gate 的
  P1+P10 是同一件事的第二份写法。现在 ponytail 只留**代码与解释的比例**（那是它独有的措辞），
  回复形状的十条 + 破例全部由 `shape-gate.md` 独家提供，ponytail 里写明真源在哪。
- **C2 优先关系没有单一裁决点**：三份文件原本各带一节"与其他规则的关系"，互相指三个不同方向
  （ponytail 指 session-gate 的 R5/R6、shape-gate 指 R1–R3、session-gate R4 指 shape-gate）。
  现在只有 session-gate R4 一处声明：**宿主 system / developer > 用户当前指令 > R1–R7 > ponytail 段 > 形状段**，
  另两段不再各写一份（shape-gate 破例 6 改成指回 R4）。
- **C3 卡面文案与实际不符**：门禁卡写"规则六条"却列到 R7、ponytail 卡写"四原则"而正文是 6 条硬规则。
  已改为"规则七条 R1–R7（R4 是归属与裁决声明，不是行为规则）"与"三原则"（R5 现存 3 条）。

**交叉（已合并到一处，另一处只留一句引用）**
- 最小实现：R5 原第 2 条与 ponytail 梯子第 7 级重复 → 完整口径只在 ponytail，R5 一条指针。
- 只动必须动的行 / 无关死代码别删：R5 原第 3 条与 ponytail 硬规则第 4 条逐字重复
  （**这条是用户点名删的**，理由"没看出作用"）→ 只留 ponytail 那一份，R5 的指针里点明。
- 验证/完成要求：R6 与 ponytail「懒代码没带检查 = 没完工」保持分工（R6 管"交差前要跑并附证据"，
  ponytail 管"哪类代码必须留最小检查"），措辞已错开，不再各写一遍同一句话。

**体积**：12,569 → 12,285 B（−284 B）。三段起始 17,094 B，累计 −4,809 B（**−28.1%**，≈每请求少 1.2K token）。
本轮省得少是必然的——冲突修复本身要**增加**那段唯一的裁决声明，能省的是被合并掉的重复。

**主动不做**：没有为了省 token 删任何一条约束。设置页卡面文案同步后，`verify-gate-client` 的渲染断言口径未变。

**验证**：`npm test` 9/9 通过。

## 1.12.3 — 2026-09-21 · 瘦身续：加载器收工厂、载荷对账改成行为断言、清掉 850 KB 探针产物

接 1.12.2 清完用户点名的清单，逐条结果（含**撤回**与**主动不做**的，免得下一个人照单重做）：

- **三段规则加载器收成一个工厂**（做）：`loadGate/Ponytail/ShapeSync` + 三个 async 包装原本是逐字复制的
  三对函数，收成 `makeRuleLoader(builtinFile, overrideFile, cache)`。
  ⚠ 收的时候踩了一次：override 路径**必须传函数、每次现取**，不能传已求值的字符串 ——
  三个套件都是"先 import 本模块、再改写 `process.env.DSH_HOME`"，模块加载期把路径定下来的话，
  测试写的 override 落在临时目录、加载器却还看真实 home，`verify-ponytail-gate` 第 2 组当场红了 5 条。
  `index.js` 里已写明这条约束。
- **载荷对账从"扫源码"改成"抓真请求"**（做）：`verify-settings-payload` 新增第 4 组 —— 真起 http 服务、
  真装载 client 半、真翻一次开关，抓实际 PUT 的请求体与 `host.DEFAULTS` 比。这类断言不依赖源码文本，
  不会再出现"实现换了形态、断言假失败"。同时待对齐字段改为直接读 `host.DEFAULTS`，
  本文件不再维护第二份白名单与 `EXCLUDE`。静态那一组保留作快速失败（两条口径一强一快）。
- **删掉 849.6 KB 探针产物**（做）：`tools/cc-appear-out/`、`tools/userrow-out/` 都是 gitignore 内的产
  物、未入库，跑 `probe-userrow` / `cc-appear-probe` 可重建。
- **终端编码"问题"不存在，撤回**：上一轮记的"run-all 中文乱码需 `chcp 65001`"是我看错了 ——
  `node -e "console.log('中文 ✅')"` 经管道到 pwsh 完全正常；乱码只出在我用 `Get-Content`（按 GBK 解码）
  渲染出来的**回读**上，与脚本无关。故 run-all.mjs 一行未改。
- **主动不做**：三段 prompt 文本构造器（`gatePromptText`/`ponytailPromptText`/`shapePromptText`）没合并 ——
  三个函数合计 22 行，但"默认开 vs 默认关"的判断（`=== true` 与 `!== false`）是这个插件最容易写错的语义，
  抽掉后差异会藏进参数里、可读性变差。收益（约 10 行）小于代价，留原样。
- 回归：`npm test` 9/9 通过；`verify-settings-payload` 从 12 项增至 16 项（新增 4 项运行时断言）。

## 1.12.2 — 2026-09-21 · 瘦身：三段常驻规则减 26%，规则卡与路由样板去重

**需求**（用户）：代码瘦身，不影响现有使用；能改进／该新增的另列清单。

**常驻注入文本（每请求重发的部分，改动直接省 token）**：三段共 16,915 B → 12,569 B（−4,346 B，−26%）。
`session-gate.md` 6,990→4,719、`ponytail-gate.md` 5,143→3,661、`shape-gate.md` 4,961→4,189。
只压措辞与重复交代（R4 从 5 段并成 1 段、删掉"为什么这么整形"整节、例子合并），**R1–R7、七级梯子、
十条形状规则与六条破例的约束内容一条没减**；verify 套件盯的锚点（各节标题、关键短语、R4 的归属声明）全部保留。
顺带把设置页里写死的体积数（"2–3K""1.2K / 4,867 B"）改成按 host 回来的字节数实时算 —— 以后改文本不会再留假账。

**代码去重（不动行为）**：
- `client.js`：设置页三张规则卡（会话守则 / ponytail / 输出形状）是逐字复制的同一套骨架，合成一个
  `RuleCard(facts)`，差异（文案、字段前缀、警示行、说明内容）全部走参数；`gateTruncated ? h('p'…)` 那三处
  硬编码警示换成 `warnings: [{field, text}]` 数据。
- `client.js`：`fetch + JSON.stringify` 与 `fetch→r.json()` 两条样板链在 9 处重复，收成 `putJson` / `jsonFetch`。
- `index.js`：三条规则路由（gate / ponytail / shape）逐字同构，收成一张 `ruleRoutes` 表 + 一个注册循环。

**验证**：`node --check client.js index.js` exit 0；`npm test` 9/9 套件通过（含 verify-gate-client 真实渲染 80 项）。
两处源码级断言因实现形态变了而同步改口径（不是放宽）：verify-gate-truncation 第 ⑧ 组改盯 `field: 'Truncated'`
数据形态，verify-settings-payload 的载荷锚点从 `body: JSON.stringify({` 改到 `putJson('/cc/settings.json', {`。

**没做 / 风险**：`client.js.bak-20260910-143611`（87 KB）与 `session-gate.R4-backup-2026-09-16.md` 是**已入库**的
历史件，删它们要动 git 历史语义，留着；`tools/cc-appear-out`、`tools/userrow-out`（850 KB）已在 .gitignore 内，
本地可删。改动生效不需要重启：插件是 junction 到本仓库，host 半下次请求即读新文本；设置页卡片需要刷新页面。

## 2026-09-21 · 本地维护：并发设置保存与测试隔离

- 设置与自动审查入口共用保存队列，防止并发读取旧设置后互相覆盖；设置文件通过临时文件原子替换，避免读取半份 JSON。
- compactionBackup 只由宿主管理；主设置入口修改审查开关时同步注册或注销技能。
- 新增并发保存回归验证；客户端测试改用独立临时目录，不再清理写死的本机目录。
- 保留此前未提交的客户端外观修改。

（本仓库此前没有 changelog，从这一轮开始记。更早的历史见 README 与 `git log`。）

## 1.12.1 — 2026-09-20 · 空会话「工作区行」与输入卡左边对齐（DeepSeek / 标准模式 那一行）

**需求**（用户）：截图上那一行（DeepSeek、标准模式、PPT、生图）要和输入框对齐。

**根因**：宿主 `.wSkVaW_heroWorkspaceRow` 自带 `padding:0 20px`，左边缘贴的是 composer 列；而输入卡在
`.uV2eYG_root`（`padding:0 var(--dsh-composer-side-clearance)`）里按 `--dsh-composer-card-max-width` 居中 ——
两边缩进不同源，卡片比这一行多缩进一截。实测（composer 列宽 1052.6 / clearance 16 / card-max-width 90%）：
行内容左 340.7、卡片左 387.7，差 47px。

**做法**：`CSS` 数组末尾两条基础样式（无条件生效，不加开关 —— 这是"对齐到输入卡"的不变量）：
这一行补上同一圈内边距，第一个子项再按同一个 `--dsh-composer-card-max-width` 推出等宽的居中量。
两者的百分比基准同为「列内容宽 − 2×clearance」，所以 card-max-width 无论是对话页钉的 90% 还是宿主默认的
`calc(--dsh-chat-content-width + 32px)` 都成立。选择器只留 CSS-module 的**本地名后缀**
（`[class*="heroWorkspaceRow"]`）—— 哈希前缀一升级就变，这与本仓库隐藏拖拽把手时的做法一致。

**验证**：真浏览器实测改后 —— 行首项左 387.72 / 输入卡左 387.73 / MemSearch 胶囊左 387.72（三者一致）；
`node --check client.js` exit 0；`npm test` 8/8 套件通过（含 verify-gate-client 80 项）。

**没做 / 风险**：宿主若把 `heroWorkspaceRow` 这个本地类名改掉，这条会静默失效（表现 = 回到 47px 错位，
照本节注释重钉即可）；`dsh-approval-gate` 里那条横幅仍用旧的
`max-width:calc(--dsh-composer-card-max-width − 2×dock-inset)` 公式，按同理会比卡片窄 16px，本次不动它。

## 1.12.0 — 2026-09-21 · 并入独立插件 dsh-output-shape：第三段常驻规则「输出形状」+ 两条按需技能

**需求**（用户）：把插件"输出形状"迁移到会话策略插件里作为并行项，做个开关，然后可以删掉那个插件的框架。

**做法（按 ponytail 的第二级：先看这个仓库里已经有什么）**：形状段与 ponytail 段**逐字同构** —— 同一套通用装载器
（`loadRuleFile` + 独立的 mtime+size 缓存）、同一套 `ruleMeta`、同一条 `/cc/<name>.json` GET/PUT 路由、同样的截断三元组、
同样的花括号中和、同样的"设置页卡片 + 快捷面板分区 + chip 一段"三处入口。**没有为它新写任何机制**，
只把三处 `ponytail` 的现有实现复制成 `shape` 并把默认值翻过来。

- 新增 `shape-gate.md`（4868 B，就是原 `skills/i-have-adhd/SKILL.md` 去掉 YAML frontmatter 的正文；逐字节比对通过）
  作为该段的内置文本；override 落 `$DSH_HOME/dsh-cache-control/shape.md`；路由 `/cc/shape.json`。
- 段名 `dsh-output-shape:output-shape` → **`dsh-cache-control:shape-gate`**，order 仍是 **410**（紧随守则 400 / ponytail 405）。
  段名只在运行时用，盘上没有任何东西引用它，所以无需迁移。
- **`shapeEnabled` 默认 true**，与另两段（默认 false）相反：并入前它由那个插件的 bundle config 默认开启，
  合并时保持同默认 —— 否则升级即静默改变行为，用户只会看到"形状规则没了"。判据是 `!== false` 而不是 `=== true`，
  于是"旧盘上没这个键"也能正确判成开。
- **接手两条按需技能**：`i-have-adhd` 与 `ponytail`（原来是那个插件 `registerSkills` 注册的）。
  无开关、零常驻 token；正文**直接读本插件的规则文件**（override 优先），所以"技能里读到的"与"每请求注入的"永远同一份。
- 逃生开关**沿用原名** `DSH_OUTPUT_SHAPE_DISABLE`（改名等于把别人环境变量/脚本里的开关悄悄拔掉）。界面在卡片与面板都写明
  "被环境变量强制关闭"，chip 徽标也按"实际是否注入"画 —— 开关开着却没注入时不假装亮着。
- 会话守则里的 R4 一节 v1.9.1 摘出给那个插件，现在改指本插件同目录 `shape-gate.md`（只留归属声明，**不许再抄一份**）。
- `tools/verify-shape-gate.mjs`（新，60 项）+ `run-all.mjs` 登记；`verify-gate-client.mjs` 跟着换语义：
  chip 四段 / 三根竖线 / 五个按钮 / 五条 title、八个勾选框（C 段）、八个分区名字、`verify-settings-payload` 16 键对齐。

**顺手修掉一处静默丢键**：`tools/settings.mjs`（导出/导入）的 `DEFAULTS` 停在 v1.4.x，v1.10.0 的 `ponytailEnabled`
与 v1.11.0 的 `reviewSkillEnabled` **从来没进过名单** ⇒ 导出再导入会把这俩开关悄悄抹回默认（`sanitize` 丢弃未知字段）。
三个键一起补上，并加了往返实测。`verify-settings-payload.mjs` 只比对 host 与 client 两处，管不到这个脚本 ——
以后加开关记得**三处**都补。

**验证**：`node --check` 两个半边 exit 0；`npm test` **8/8 套件通过**（本机：gate-truncation 30 / settings-payload 12 /
gate-client 80 / shape-gate 60 / session-gate 39 / ponytail-gate 23 / panel-and-resizer 25 / host-width 全绿）。
另有一条反向证据：形状段与守则段**同时注入**时合计 11,793 B（≈2,948 tokens/请求），没有翻倍
（`verify-shape-gate` 第 7 节钉住"守则段里不许再出现形状正文"）。

**代价**：默认开着 ⇒ 所有会话每请求多约 1.2K token（含子代理与非编码会话）。这是并入前就有的账，没有变多；
不想付就去设置页或 chip 第四段关掉。`DSH_OUTPUT_SHAPE_DISABLE` 的老用法继续有效。

**没做**（明确不做，不是忘了）：原插件的 `/os/skills/reload` 路由不迁移（技能在启动时注册一次，那个路由只是开发期方便）；
`/os/*` 旧路由名不保留别名（除 `INTERFACES.md` 外无任何引用）。仓库目录归档不删除（有未推送的 git 历史）。

## 1.11.1 — 2026-09-21 · 分区标题去掉圈符编号，只留名字

**起因**：v1.11.0 刚把编号顺延过一遍（插入「自动审查」⇒ 气泡置顶⑤ / 对话页⑥ / 存储⑦），那是**连续第二次为同一件事返工** —— v1.10.2 修的是 ponytail 曾写作 "②b" 导致页面上出现两个 ②。用户问"把编号去掉只留名字是什么意思"，确认范围后落地。

**理由（一句话）**：编号是**位置属性**、名字是**身份属性**。把位置写进标题，任何一次插入都要重排全部下游引用；实测仓库里有 **250 处圈符引用**（client.js / index.js / README / CHANGELOG / package.json 描述 / NOTICE / tools/settings.mjs / 测试断言 / 跨插件指路）。去掉后插卡只改一处。

**改动范围（严格限定在"给用户看的字符串"）**：
- client.js：七个 `h3.cc-h` 标题 + 快捷面板三个 `cc-sectTitle` + 「总述」段 + 「关于本页」段里的 `⑤⑥` → 换成名字；文件头注释同步。
- tools/settings.mjs：导出/导入时打印的三行提示里的编号。
- package.json description：整段重写为按名字列举。
- README：节标题去编号，新增「为什么分区标题没有编号」一节记录这条决定与它的验证方式。
- dsh-desktop-wallpaper：四处跨插件指路（`「会话策略 · ⑥ 对话页」`→`「会话策略 · 对话页」`）。
- **不动**：CHANGELOG 历史条目（那是当时的事实）、代码注释里表示步骤的 ①②③、测试脚本内部对样本的局部序号（如 verify-gate-truncation 的七种输入）—— 与 UI 无关，改了反而丢信息。

**测试跟着换语义**：原来两条断言钉的是"编号必须从 ① 起连续、不许有字母后缀"（本身就是给这个脆弱性打的补丁）。换成：**页面（含抽屉正文，标签剥离后的全文）不许出现任何圈符** + **七个名字齐全且顺序正确**（顺序即页面顺序，不靠编号表达）。第一条比原来更严 —— 连正文里的编号引用一起管住了。

**验证**：`npm test` 7/7（verify-gate-client 仍 76 项）。UI 层复查：`grep cc-h|cc-sectTitle` 无一行带圈符。

**代价**：口头指代从"把 ⑤ 关了"变成"把气泡置顶关了"。名字本来就是 2–4 字，读得出来，不需要编号当索引。

## 1.11.0 — 2026-09-21 · 新增「④ 自动审查」：注册按需技能 auto-code-review（接外部 ocr），不注入常驻段

**需求**（用户）：蒸馏 GitHub 上的 open-code-review 及同类，内嵌进会话策略插件，做到写代码时自动审查，UI 与懒码同族。

**先做的判断（这条决定了实现形状）**：**没有蒸成常驻 prompt 段**。上游 [alibaba/open-code-review](https://github.com/alibaba/open-code-review)（Apache-2.0）自己的 README 就把"通用 agent + 自然语言 skill 做审查"列为反面教材 —— 三条通病：大 changeset 选择性漏审、报出的位置与真实行号漂移、prompt 微调即质量波动；根因是纯语言驱动对审查过程没有硬约束。其基准（AACR-bench：50 仓库 / 200 真实 PR / 1,505 条标注）显示同模型下 F1 更高而 token 只用通用 agent 的约 1/9。照 ponytail 的路子抄规则文本 = 只拿走它论证过会失败的那一半。ponytail 能常驻是因为它是风格取向、无可度量指标；审查有覆盖率与定位准确率。

**做法**：
- **零常驻注入**：一个字都不进 system prompt。注册宿主 `skills` 服务里的 `auto-code-review`（正文 `skills/auto-code-review/SKILL.md`，3.5 KB，用到才加载）。与 ②③ 两段的根本区别就写在卡的抽屉里。
- host 侧新增 `/cc/review.json`（GET 状态 / PUT 开关）、`parseSkillFrontmatter`、`ocrCandidates` + `detectOcr` + `probeOcr`（TTL 60s 记忆化）、`reviewMeta`；设置新键 `reviewSkillEnabled`（默认开）。注销走 dispose，卸载钩子里也撤一遍。
- client 侧新增 ReviewCard：开关 + 「技能体积 / 路径 / 常驻 0 B」+ **ocr 探测结果**（装了就显示版本与命令，没装给安装命令）+「重新检测」按钮 + 抽屉说明为什么不是常驻规则。chip 不加第四段（已经三段，再加挤爆；审查不是每轮都要拨的东西）。
- 分区编号顺延为 ①–⑦（自动审查插在 ponytail 之后 ⇒ 气泡置顶⑤ / 对话页⑥ / 存储⑦）。总述改"七块"、「关于本页」的纯界面对象同步。
- `package.json` 的 `files` 补 `skills`、`ponytail-gate.md`、`CHANGELOG.md`、`NOTICE`（原来连 ponytail 内置文件都没打包，npm 装出来那段规则是空的 —— 顺手补上）。新增 NOTICE 记两个上游的署名。

**踩到并修掉的三个坑**：
1. **`execFile('ocr.cmd')` 在 Node ≥18.20/20.12/24 抛 EINVAL**（CVE-2024-27980 修复），不是 ENOENT —— npm 在 Windows 上装的全局 CLI 恰恰就是 `.cmd` shim。第一版探测永远假失败、界面一直显示"未安装"。修法：`.cmd` 走 `shell:true` 且**整条命令进 shell、不传 args**（避开 DEP0190 告警）。
2. **宿主进程的 PATH 里没有 npm 全局 bin**：命令行 `ocr` 能跑、插件里 spawn `'ocr'` 报 ENOENT。所以 `ocrCandidates()` 显式补 `%APPDATA%\npm\ocr.cmd`。
3. （测试侧）`verify-settings-payload.mjs` 全文搜第一个 `body: JSON.stringify({` 当载荷锚点 —— 新增 `setReviewEnabled()` 后文件里多了个单行小载荷，被它抢先命中 ⇒ 解析出 1 个键、对齐断言集体假失败。修法：先定位 `function saveNow()` 再从那里找块，并加两条"锚点定位正确 / 键数不少于 DEFAULTS"的防回归断言。

**验证**：`npm test` **7/7 套件通过**（该套件 76 passed / 0 failed）。编号断言随之更新（⑤ 气泡置顶、⑥ 对话页、①–⑦ 连续圈符）。本机 ocr v1.12.7 实测：`delegate preview --format json` 给出 reviewable/excluded 与增删行数；`delegate rule --format json client.js` 按 `**/*.{ts,js,tsx,jsx,mjs,cjs}` 分组返回规则正文 —— 技能正文写的三步就是照这个契约写的。

**代价**：注册状态本身零 token（技能只在目录里占一行 description）。真正的成本发生在调用时：一次 delegate 审查要读 diff + 规则，属正常工具调用量级。ocr 未安装时技能仍在目录里，但跑到第一步就会停下说明 —— 卡上提前把这件事显示出来。

## 1.10.2 — 2026-09-21 · 设置页分区编号重排为连续的 ①–⑥（修"两个 ②"）

**现象**（用户）：设置页「会话策略」里出现两个 ②，序号没对齐。
**根因**：v1.10.0 加 ponytail 卡时用了 `②b` 这种插队写法（挂在守则之后、不想动后面编号），而守则本身就是 ② ⇒ 页面上一眼看到两个 ②；同时 v1.8.0 的 ⑤ 存储也从未进过总述文案，编号体系一直停在"四块"的说法里。
**修法**：编号统一为连续圈符，不再混编字母后缀 —— ① 省缓存 / ② 会话守则 / **③ ponytail** / ④ 气泡置顶 / ⑤ 对话页 / ⑥ 存储。同步改了设置页六张卡的 `h3`、快捷面板里的 `cc-sectTitle`、「总述」段（四块 → 六块并补 ③⑥ 两句）、「关于本页」里的"③④ 纯界面"→"④⑤"，以及文件头注释与两处指向旧编号的行内注释。**只改显示层**：settings.json 字段名、提示词段序常量（GATE 400 / PONY 405）、HTTP 路由一律未动，盘上存量与已开会话不受影响。
**回归**：`verify-gate-client.mjs` 三条写死旧编号的断言随之更新（③→④ 气泡置顶、④→⑤ 对话页、四个→六个分区标题），并新增两条把这次的坑钉住的断言：**编号必须是从 ① 起连续的圈符、不许出现 `[①-⑥][a-z]` 这类字母后缀**。

## 1.10.2b — 2026-09-21 · 补 v1.10.0 欠账：chip 三段版式的 8 条断言改对，并把该套件挪回 CI

**现象**（用户确认要修）：`verify-gate-client.mjs` 长期 8 条 FAIL，因此整个套件被 `EXCLUDED` 出 CI。
**根因**：v1.10.0 给 chip 加了第三段「懒码」（ponytail），版式从"两段标签 + 一根竖线 + 三个按钮"变成三段；那 8 条断言仍按两段写，加完没人更新 ⇒ 一直红着，被以"要 %APPDATA%"为由排除掉了。**真实原因不是环境依赖，是断言过期** —— 这是本轮查出来的事实。
**修法**：
- 断言按三段现状重写（`CHIP_LABELS` 常量承载标签序列，别再散落字面量）：三段标签、三枚徽标各自的开/关与高亮态、两根竖线、四个按钮、四条 title；C 段"全开"补上 `ponytailEnabled: true`，勾选框计数 5→6。
- 消除套件自身三条真实的本机依赖，让它进得了 CI：① preset 从 `%APPDATA%` 复制 → 换成与 verify-session-gate 同款最小夹具；② 收尾"真实 settings.json / gate.md 未被改动"两条硬读真实 home → 不存在时 SKIP 并如实打印；③ primitives 桩原来要求读到宿主真包源码才装载 → 改为始终按签名复刻、读不到只打一行 NOTE。`react-dom` 补进 `devDependencies`（原来只有 react，server.js 靠宿主目录）。
- `run-all.mjs`：`verify-gate-client.mjs` 从 `EXCLUDED` 挪进 `SUITES`，理由照实改写。
**验证**：本机 `npm ci --offline && npm test` ⇒ **7/7 套件通过**（该套件 76 passed / 0 failed）。反向证据（模拟 CI）：`APPDATA` 指空目录后跑 `npm test` ⇒ 仍 7/7，该套件 74 passed / 0 failed + SKIP；verify-session-gate 同步退化为 36 项。`react-dom` 钉到与 `react` 同版本 18.3.1（不用 `^`），lockfile 已同步。
**没做的**：`verify-gate-http` / `verify-ui-appearance` 仍在 EXCLUDED —— 它们有几条"逐字节比对真实 preset 未被改动"的断言，夹具化就得换比对对象、属于放宽口径，维持原判断。

## 1.10.2c — 2026-09-21 · verify-gate-http 里一条 v1.10.0 留下的假失败（顺手）

**现象**：跑本机全套时发现 `ctx.inject 依赖 systemPrompt` FAIL，实际打印 `sections=2`。
**根因**：v1.10.0 挂了第二段规则（ponytail），该断言仍写死"只挂一段"；且它取 `sections[0]` 当门禁段用，一旦宿主按 order 排出的顺序变了，下面三条段名/段序/text 契约就会验到错误的段上。**与上面那条同族**：都是加 ponytail 时没同步的旧断言。
**修法**：改成"两段都挂上"+ **按段名找门禁段**（不靠数组下标）。44 passed / 0 failed。套件仍留在 EXCLUDED（原因不变）。

## 1.10.1 — 2026-09-21 · 改段序：守则(400) → ponytail(405) → 输出形状(410)

**需求**（用户）：ponytail 不该排在 ADHD 形状规则之后——编码纪律与守则 R5 同源，应贴着守则走。
**改动**：`PONY_SECTION_ORDER` 410→405；对偶改动在 dsh-output-shape v0.3.1（`SHAPE_SECTION_ORDER` 405→410）。verify-shape 里三处写死的 405 改为读常量/新契约值，⑥ 组把"必须 >405"钉进断言。**跨插件顺序约定第一次成为事实**：以后动这两个 order 要同时查两边的套件。

## 1.10.0 — 2026-09-21 · 加 ponytail 编码纪律段：与会话守则同构的第二段常驻规则 + 独立开关

**需求**（用户 2026-09-21）：把 GitHub [DietrichGebert/ponytail](https://github.com/dietrichgebert/ponytail)（MIT）蒸馏进会话策略插件，做成一个开关 —— 开 = 全文常驻注入 system prompt，关 = 不注入。落点选本插件（而非 dsh-output-shape），与会话守则 R1–R7 同住一处；chip 上第三段「懒码」一键切换。

**做法**：内置文本 `ponytail-gate.md`（5.0 KB / 86 行，中文转写，去重了上游与 R5/R6 重叠的测试条款、去掉 lite/full/ultra 档位）+ settings 新键 `ponytailEnabled`（默认 false）+ 提示词段 `dsh-cache-control:ponytail-gate`（order 410，守则 400 与形状 405 之后）+ HTTP `/cc/ponytail.json`（GET 注入形态预览 / PUT 写 override / 空文删回内置），全部与门禁同构。

**顺手做的抽象收敛**：两段规则同构 ⇒ 加载器合并为 `loadRuleFile(builtin, override, cache, max)`、元信息合并为 `ruleMeta(...)`、写盘合并为 `writeRuleOverride(...)` —— 各自保留**独立的 mtime+size 缓存对象**（gateCache / ponyCache）。共用一份缓存会互相顶掉对方的键，热路径上表现为无谓重读、record 串段。**不要**再把这两段复制成两份实现，漂移是迟早的事。

**回归**：新增 `tools/verify-ponytail-gate.mjs`（23 项，已入 SUITES）——盯开关独立性、两段的缓存互不串、截断三元组同源、override 清除回内置、花括号中和。全套离线 6 套件通过。client 侧 PUT 载荷补 `ponytailEnabled`（verify-settings-payload 的字段对齐闸这次开局就接住了它该拦的那类漏）。

**代价如实告知**：开着时约 1.3K token/请求 × 所有会话（含子代理、非编码会话）；正文里写明"只对编码任务生效"来兜底行为，但 token 不挑会话。按需使用场景仍可用 dsh-output-shape 里的 ponytail 技能（按需加载、零常驻）。

## 1.9.7 — 2026-09-20 · 修 CI 红：verify-session-gate 的断言基线不再取自真实安装文件

**现象**：v1.9.4/v1.9.5 推上 GitHub 后 Actions 三档 Node **全红**（run #5/#6），本机却 39/39 —— 正是守则 R6"本机绿 ≠ 干净机器绿"的反例，被自己抓到。
**根因**：夹具化时留了一条"本机以真实 settings.json 为底、CI 用 DEFAULTS"的双源基线，而下面三条 sanitize 断言写死的期望是 30/4 —— **恰好是本机真实值**，DEFAULTS 实为 25/5。本机绿纯属巧合，CI 必红。
**修法**：断言基线改为套件自写的固定值 `{...DEFAULTS, enabled:true, triggerPct:30, retainPct:4, auto:true, gateEnabled:true}`；真实 home 只用于收尾的"未被改动"对照（不存在则 SKIP 并打印）。**反向验证**：把 `APPDATA`/`DSH_APP_MODULES` 指到不存在的目录模拟 CI ⇒ 修复前复现同一条 FAIL，修复后 36 passed / 0 failed + SKIP 标注。
**排查审计**：grep 全部 8 个套件的 `%APPDATA%` 读取点——其余套件要么纯临时目录，要么只在 EXCLUDED 里（不进 CI），无同类雷。
**教训入规**：以后凡"测试期望值来自环境文件"的写法一律禁止——基线必须随测试代码走，环境文件只做被守护对象。

## 1.9.6 — 2026-09-20 · ② 会话守则：R2 补两行「提问时机前置 / 阻塞式提问是最后手段」（C 项收尾）

**需求**（用户 2026-09-20）：可行性分析 v2 的 C 项 —— 蒸 Claude Code 出厂条款 "Delivering work at full scope"（ccVersion 2.1.218，经 Piebald-AI/claude-code-system-prompts 收录，MIT）。
**做法**：不新开节，两条并入现有 R2（+334 B）：① 会改变**方案形状**的缺口问在动手前、只影响实现细节的按默认假设做完再标注；② 阻塞式提问只在"任何假设都会不安全或作废"时用，否则先做完不依赖答案的部分。刻意未收同条款里的"疑虑说一句就继续交付""拒绝要克制"——那些偏对话风格，且与 R1/R3 已有内容重叠。
**验证**：注入实测 6,666 B / 16,384 B、未截断（宿主 `/cc/gate.json` 实读，两行均在）；`run-all` 5/5；`verify-session-gate` 39/39。存盘即生效，无需重启。
**至此守则成型**：R1–R3（原创）· R5（Karpathy 四原则）· R6（查证）· R7（谨慎执行）+ R2 时机细化 ≈ 1,670 tokens/请求。

## 1.9.5 — 2026-09-20 · ② 会话守则：新增 R7「谨慎执行」（Claude Code care 条款蒸馏）

**需求**（用户 2026-09-20）：可行性分析 v2 的 B 项 —— 蒸 [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts)（MIT）收录的 Claude Code 出厂条款 "Executing actions with care"（ccVersion 2.1.200）。
**做法**：
- `session-gate.md` 新增 `## R7 谨慎执行：看清可逆性再动手`（959 B，原稿 1,131 B 砍掉 git status 一条——DSH 沙箱与审批门已覆盖大半，且 R1 裁决条款已有不可逆先确认；保留其独有的三条：**授权按当次范围算 / 破坏性操作不当捷径 / 不认识的状态当半成品、能移不删**）。
- 开头写明与既有机制的关系：R1 的可操作版 + DSH 审批门是硬拦截、本节管拦之前怎么选——避免读者以为它替代 approval gate。
- client.js 四处文案同步成六条（规则说明抽屉、面板开关标签、note、chip title）。
- `verify-session-gate.mjs` 防误删断言扩到 R5/R6/R7。
**验证**：注入实测 6,332 B / 16,384 B、未截断（宿主 `/cc/gate.json` 实读）；`run-all` 5/5；`verify-gate-client` 74/74；`verify-session-gate` 39/39。**client.js 文案改动要重启 DSH Desktop 才可见**（规则文本本身存盘即生效）。
**成本**：+959 B ≈ 240 tokens/请求（含子代理与 workflow 子会话各乘一份）。

## 1.9.4 — 2026-09-20 · ② 会话守则：新增 R6「查证再下结论」；verify-session-gate 修好并挪回 CI

**需求**（用户 2026-09-20）：可行性分析 v2 的 A 项 —— R6 蒸馏自 [duolahypercho/andrej-karpathy-skills](https://github.com/duolahypercho/andrej-karpathy-skills) 第 4 条（"最窄的有意义验证；没跑检查就明说"）。
**做法**：
- `session-gate.md` 新增 `## R6 查证再下结论`（437 B）：先查证再断言、未验证标【假设】、完成前跑验收动作并附证据、没跑检查就明说。注入实测 5,372 B / 16,384 B，未截断，存盘即生效。
- **顺手治好一个老排除项**：`verify-session-gate.mjs` 长期 EXCLUDED 的理由是「DEPLOYMENT_PERSONA TypeError + 要读 %APPDATA%」。根因：断言引用了宿主从未导出的 `FIRST_PARTY_SECTION_ORDER.DEPLOYMENT_PERSONA`（真名 `DEPLOYMENT_PERSONA_PREFIX`），套件一直在段序断言处崩 ⇒ **后面 20+ 条从没跑过**。修法：段序判据改从已解析包源码文本取数值；preset 依赖换成仓库内最小夹具（托管块逐字节对照 `compactionConfigLines` 形态）；真实 home 存在才做"未被改动"对照（CI 上 SKIP 并如实打印）。devDependencies 补 `@deepseek-ai/dsh-system-prompt@^0.1.5-rc.2` 及其运行时闭包（cordis/schemastery/dsh-scope/dsh-invariants，版本与本安装宿主一致；`.npmrc` registry 钉死不变，测试执行期仍不出网 —— `npm ci --offline` 通过）。
- 体积断言的 token 换算从 `/2.6` 修正为中文口径 `/4`，且相对 `GATE_MAX_BYTES` 展示。
**验证**：`verify-session-gate` **39/39**（首次完整跑通全部 7 节）；`run-all` **5/5 套件通过**；该套件在 `DSH_APP_MODULES` 指向空目录时仍 39/39（证明不再依赖本机安装路径）。
**生效范围**：仅规则文本与测试基建，插件代码零改动 ⇒ 不需要重启 DSH。

## 1.9.3 — 2026-09-20 · UI：开关/按钮改用宿主官方原子（primitives），并修两条陈旧断言

**需求**（用户 2026-09-20）：可行性分析方案 1 —— 设置页控件与宿主原生一致、随主题与明暗。
**做法**：
- `client.js` 软 require `@deepseek-ai/dsh-client-ui-primitives`（仿 dsh-note-changes：拿不到就退回自带控件）。
- `Switch()` 改为「说明文字在左 + 宿主 Switch 在右」（新 `.cc-swRow`/`.cc-swLabel`），禁用态再兜一层 no-op；
  `Btn()` 包住全部 8 处原 `cc-btn` 按钮（门禁卡 4、存储卡 3、滑杆面板 2）。checkbox 回退路径原样保留。
- 顺带把面板/提示文案里"规则三条 R1–R3"补成含 R5（v1.9.2 遗留的文案漂移）。
- **修两条 6 KB 年代写死的断言**（本次全量复跑才暴露，与本轮改动无关的陈旧失败）：
  `verify-gate-client` E2 段的 19998→5839/上限 6144 改为**相对 host 响应生成**；
  `verify-gate-http` 第 6 段样本 7000 B 不再超 16 KB 上限 ⇒ 样本改 20,000 B、判据改 `< host.GATE_MAX_BYTES`。
  这正是 v1.9.0 对 truncation 套件做过的"数字相对上限生成"改造，补齐到剩下两个套件。
**验证**：`verify-gate-client` **74/74**（新增一条守卫断言：primitives 桩未装载即红，防"只测了回退路径"的假绿）；
`verify-gate-http` 43/43；`verify-ui-appearance` 50/50；`run-all` 4/4；双路径渲染探针实测
primitives 在场 = 8×`role="switch"` + 3×宿主 Button、零 checkbox；不在场 = 恰好镜像（8 checkbox + 3 cc-btn）。
**生效范围**：client 半改动要**重启一次 DSH Desktop**（启动时 compose）；重启前页面照常工作（旧 client 缓存）。

## 1.9.2 — 2026-09-20 · ② 会话守则：新增 R5 编码行为四原则（蒸馏自 multica-ai/andrej-karpathy-skills）

**需求**（用户 2026-09-20）：调研 GitHub 上同类开源实现并蒸馏更新。
**做法**：
- `session-gate.md` 新增 `## R5 少犯错优先：编码行为四原则`：动手前说假设 / 最小实现 / 只动必须动的行 / 任务转成可验证目标。中文重写、压成与 R1–R3 同格式的条目，来源在节标题下署名（MIT）。
- README「② 会话守则」补 R5 一行；同步说明与 R1 的分工（R1 敢反对，R5 少犯错）。
- 规则文件存盘即生效（mtime+size 记忆化），无需重启。注入实测 4,934 B / 上限 16,384 B，未截断。
**验证**：`verify-gate-truncation` 30/30、`verify-panel-and-resizer` 25/25、`verify-settings-payload` 9/9、`run-all` 全绿；`GET /cc/gate.json` 实测 `truncated=false` 且文本含 R5。

## 1.9.1 — 2026-09-16 · ② 会话守则：R4 输出形状摘出，交给 dsh-output-shape

**需求**（用户 2026-09-16）：给 ADHD 规则做了独立插件 `dsh-output-shape`（含 chip 与设置页），并要求它**默认常驻开启**。此时若 R4 还留在本文件，同一套规则会在每个请求注入两遍（约 3.4 KB + 4.9 KB）。

**做法**：

- `session-gate.md` 的 `## R4 输出形状` 整节删除，改留一段**归属声明**（真源在哪、别在这里再抄一份、如何收回）——留声明是因为"删干净"的下一种结局是有人照着 CHANGELOG 又抄回来，变成两处同时注入。
- 原文备份到同目录 `session-gate.R4-backup-2026-09-16.md`（不参与注入，仅供回退）。
- README / package.json description 同步说明 R4 已迁出。
- **16 KB 上限保留不动**：摘出后余量回到宽裕，但那是刹车不是装饰，不因暂时用不满就收紧。

**验证**：`verify-gate-truncation.mjs` **30/30**；`verify-session-gate.mjs` 在 `DEPLOYMENT_PERSONA` 处崩是既有问题（该套件早已排除于 CI，非本次引入），其前面几条断言含「开：R1/R2/R3 三条都在」全通过。

## 1.9.0 — 2026-09-15 · ② 会话守则：加「R4 输出形状」一节，上限 6 KB → 16 KB

**需求**（用户 2026-09-15）：把 [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd)（MIT）的
输出形状 10 条蒸进会话守则。加完后发现 6,144 B 上限只剩 92 B 余量，遂问"这条硬约束有必要吗"。

**判断**：上限**保留**（这段文本每请求重复计费，且会在每个子代理、每个 workflow 子会话里重复注入，
误粘一个十万字节的文件会把成本乘上去），但 6 KB 这个值过紧 ⇒ 放宽到 **16 KB**。

**做法**：
- `session-gate.md` 新增 `## R4 输出形状`：P1 首行即可行动 … P10 无开场白、无客套，含 6 条破例条款
  与发送前自检；中文重写、压成与 R1–R3 同格式（上游原文另存
  `D:\DeepSeek\github-plugins\i-have-adhd\UPSTREAM-SKILL.md`）。
- `index.js`：`GATE_MAX_BYTES` 由 `6 * 1024` 提到 `16 * 1024`，并 **export** 出来（原先没导出，
  测试只能各自写死 6144）。
- `tools/verify-gate-truncation.mjs`：样本长度与期望值一律**相对 `ON_LIMIT` 生成**，不再写死
  19,998 / 5,839 / 10,000 / 5,590 这些"6 KB 年代"的数字；`tools/verify-session-gate.mjs` 的两条
  上限断言改用 `host.GATE_MAX_BYTES`。
- `tools/settings.mjs`：导入前预警阈值手工同步到 16 KB（该脚本不 import 宿主模块）。

**验证**：`npm test` ⇒ 套件 **4/4 通过**，其中 `verify-gate-truncation` **30 通过 / 0 失败**
（比 v1.6.2 的 31 条少 1 条：原「① 保留长度不超上限」已并入新的区间断言）。
`verify-session-gate` 仍因既有的 `DEPLOYMENT_PERSONA TypeError`（与本改动无关）留在 CI 之外。

**生效范围**：`index.js` 的改动要**重启 DSH**（host 半在服务启动时入图）；`session-gate.md` 本身
仍是存盘即生效，无需重启。

## 1.8.0 — 2026-09-14 · ⑤ 存储：各类占用分开看，清理先给候选清单（且只"移入回收"）

**需求**（用户 2026-09-14）：分开显示原始素材 / 预览缓存 / 浏览器缓存 / 任务产物的占用，
并提供清理预览 —— 列清楚候选文件、原因和预计释放空间。

**做法**：设置页「会话策略」新增 **⑤ 存储** 卡；host 半加三条路由。

- `GET /cc/storage`：按**用途**分类统计 —— 会话记录 / 会话投影缓存 / 附件副本 / 浏览器观察窗 /
  生图插件 / 费用记录 / 本插件数据；每类给 文件数 · 字节 · 最新与最旧时间，另有总计与回收目录占用。
  递归统计带 4 万文件上限（`truncated` 标记），不是无限遍历。
- **清理预览**（`cleanCandidates()`）：只收**明确可再生成**的东西，每条写清"为什么能清"与**风险**：
  观察窗截图（无风险）、浏览器 `Default/Cache`·`Code Cache`·`GPUCache` 等缓存目录
  （**刻意不碰 Cookies / Login Data —— 登录态不进这份候选**）、生图产物 md、回收目录本身。
- **只移不删**：`POST /cc/storage/clean` 把候选**移进** `$DSH_HOME/dsh-cache-control/recycle/<时间戳>/`
  （保留相对层级避免重名互撞），返回释放字节与被跳过的项；`POST /cc/storage/purge` 才真正清空回收目录。
- **安全闸**：请求体里的路径必须**命中候选白名单**才允许移动 —— 白名单外以 `不在候选清单内` 跳过，
  并拒绝等于/高于 `$DSH_HOME` 的越界路径。

**验证**：`verify-host-width` 新增 16 项（临时 home 真造目录真跑）：分类字节数、总计=各类之和、
不存在目录 `exists=false` 不报错、`truncated` 标记、候选含截图与 Cache、**候选不含 Cookies**、
**候选不含 sessions**、候选按占用降序、**白名单外（sessions）被拒且原地未动**、
移出后回收目录里能找到（可回溯）、释放字节数正确；`npm test` 4/4 套件通过。
**host 半要重启应用**才有这三条路由。

## v1.7.0 — 2026-09-14 · "隐藏拖拽条"拆成两个开关（两竖杠 / 侧栏分隔条）

**问题**：v1.6.0 的 `hideResizer` 按 `cursor:*-resize` 语义识别，实测同时命中三类元素——
会话区左右两条宽度把手（`._8JRpoa_widthHandle`，拖了没反应的那"两竖杠"）与 AppFrame 的
侧栏/详情栏分隔条（`._1tdjgG_handle`，**拖它仍能改侧栏宽**）。一个开关把死控件和活控件一起藏了。

**改法**：`hideResizer` 语义收窄为只管带 `data-width-handle` 属性的宽度把手（存量盘上值不动：
升级后两竖杠仍被藏、分隔条自动回来）；新增 `hideDivider`（默认关）单独管分隔条。两套标记
（`data-cc-hide-resizer` / `data-cc-hide-divider`）各一条 CSS，互不牵连；`dividerReady` 与
`resizerReady` 同为独立能力位，旧 host 重启前只禁用新开关。顺带补上 `tools/settings.mjs`
导入/导出名单里一直缺席的 `hideResizer`（连同新键一起纳入，否则换机导入会被静默抹掉）。

**数字**：`verify-panel-and-resizer` 19 ⇒ **25 通过 / 0 失败**；`verify-settings-payload` **9**；
`verify-host-width` 全绿；`npm test` 套件 **4/4 通过**。真浏览器实测：只开 `hideResizer` 时
两条宽度把手 `display:none`、分隔条保留。详见 README「④ 对话页」与版本记录。

## 未发布 — CI 装测试依赖 + 恢复 verify-panel-and-resizer（react 进 devDependencies，DSH_APP_MODULES 指向仓库 node_modules）

**问题（"本机全绿、干净机器/CI 全红"）**：`tools/verify-panel-and-resizer.mjs` 要用一份真 `react`
（`const React = await import('file:///' + APP + 'react/index.js')`，把 `client.js` 的面板纯函数真跑起来），
而 `APP` 默认写死了开发机的
`D:/deepseek-harness/DSH Desktop/resources/app/node_modules/`。
CI 上那个路径不存在 ⇒ 只能排除在 CI 之外。

**前置障碍**：本仓库 `.gitignore` 里**忽略了 `package-lock.json`**，
于是"加 devDependencies"这条路走不通（没有 lockfile，`npm ci` 会直接拒绝）。
已把那行删掉并加注释说明为什么必须提交 lock。

**改法**（不重构，四步）：
1. `.gitignore`：不再忽略 `package-lock.json`。
2. `package.json` 加 `devDependencies: { "react": "18.3.1" }`（只装 react ——
   该套件只用 `createElement` 跑面板纯函数，没有 `react-dom` 渲染那一步），并加 `engines.node >= 20`。
3. `tools/run-all.mjs` 的 `ENV` 加 `DSH_APP_MODULES: urlPath(REPO) + '/node_modules/'` ——
   把那个缝**指向仓库自己的 node_modules**，于是本地与 CI 都不再依赖任何人的安装路径。
4. `tools/run-all.mjs` 把 `tools/verify-panel-and-resizer.mjs` 从 `EXCLUDED` 挪进 `SUITES`。
   新增 `.npmrc`（`legacy-peer-deps=true` + 钉 `registry.npmjs.org`），提交 `package-lock.json`（3 个包）。
   `.github/workflows/ci.yml` 加 `npm ci` 与 `cache: npm`，并写明**测试执行期间不出网**。

**数字**：
- `verify-panel-and-resizer`：**19 通过 / 0 失败**（干净环境 + `DSH_APP_MODULES` 指向仓库 `node_modules/`）。
- 反向证据：把 `DSH_APP_MODULES` 指回空目录 ⇒ 立刻
  `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<空目录>/react/index.js'`，退出码 1。
- `npm test` 三档 **Node 20 / 22 / 24 均退出码 0**，套件 **4/4 通过**。

**仍未纳入 CI**（原因也写在 `tools/run-all.mjs` 的 `EXCLUDED` 与 README 里）：

| 套件 | 原因 |
| --- | --- |
| `tools/verify-session-gate.mjs` | 既有失败：`DEPLOYMENT_PERSONA` TypeError（本机复测退出码 1，与本轮无关）；且要读 `%APPDATA%` 下真实安装目录 |
| `tools/verify-gate-client.mjs` | 要 `%APPDATA%` 下的真实 preset / settings.json |
| `tools/verify-gate-http.mjs` | 要 `%APPDATA%` 下的真实 preset。**未做夹具化**：它有几条断言是"逐字节比对**真实** preset 有没有被本次验证改动"，换成仓库内夹具就得重写那几条的比对对象 —— 那属于放宽口径，本轮只允许"等价或更强"，故保持排除 |
| `tools/verify-ui-appearance.mjs` | 要 `%APPDATA%` 下的真实 preset（同 `verify-gate-http`） |
| `tools/probe-userrow.mjs` | 开发用探针脚本（手工跑、看真实 DOM 结构），不是断言式套件 |
