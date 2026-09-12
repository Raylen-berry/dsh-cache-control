# dsh-cache-control（会话策略：省缓存 / 会话守则 / 气泡置顶 / 对话页）

给 DSH Desktop（dsh 0.7.2-alpha，web profile）加**四个互相独立的开关**，设置页名称就叫
**会话策略**（4 字，四个分区标题 ① 省缓存 / ② 会话守则 / ③ 气泡置顶 / ④ 对话页 一律 2–4 字）：
① ② 在输入框右下角的 chip 上各自可点，③ ④ 在设置页里。

| | ① 省缓存 · 压缩策略 | ② 会话守则 · 长期规则 |
|---|---|---|
| 动的是什么 | standard preset 里 `@deepseek-ai/dsh-compaction-basic` 的 config | system prompt 里一个常驻段（规则文本） |
| 生效时机 | **之后新建的会话**（preset 按组装文件 mtime 分代） | **所有会话的下一个 model step**（含当前会话，无需重启） |
| 会被压缩冲掉吗 | — | 不会：压缩只折叠对话历史，system prompt 每请求重发 |
| 代价 | 无额外 token | 规则体积 × 每请求（含子代理/工作流子会话） |

③ 气泡置顶与 ④ 对话页是纯界面开关，只改样式与 CSS 变量，不动消息数据、不动宿主代码。
只影响 `standard` 之外的说明：会话守则走宿主全局提示词层，对**所有 preset、子代理、workflow 子会话**都生效。

## ① 省缓存 · 压缩策略

设置页（设置 → “会话策略”）与对话区快捷面板里各有一条独立开关：

- **总开关**：启用 → 把下列参数写进 standard preset 的 compaction-basic 行；
  关闭 → 移除该行的 config，恢复 DSH 出厂默认（压力到窗口 80% 自动压缩、逐字保留 16%）。
- **压缩触发点**：占路由模型上下文窗口的百分比，默认 25%（deepseek-v4-flash 窗口 1,000,000
  tokens ⇒ 约 250k 触发）。
- **保留原文尾部**：逐字保留最近内容的窗口百分比（必须小于触发点），默认 5%（⇒ 约 50k）。
- **自动压缩**：`auto` 开关；关闭后不再自动压缩与溢出恢复，仅保留手动 `/compact`。

## ② 会话守则 · 长期规则

插件内的 `session-gate.md` 就是规则本体，作为一份**可长期演进的 md**随包分发：

- **R1 独立研判**：不默认用户是对的；命中「事实/技术错误、目标与手段冲突、与既有约束冲突、
  代价不划算」四类必须指出，且反对要可核查（对象 + 理由 + 替代方案）；最终裁决权在用户，
  但不可逆损失（删数据、覆盖无备份、改生产、花钱、对外发布）必须先确认。
- **R2 必要提问**：只有「不同理解会改变结果」且「答案查不到」时才停下来问；能查的先查；
  一轮最多三问、带候选项与推荐；拿不准但可回滚就先做完再标注。
- **R3 分工固定**：用户定目标、补真实情况、判定可用性；助手负责搜索、执行、制作、验证、交付。
  交付必须可判断（改动路径 + 依据 + 未覆盖项 + 风险与回退）。

界面上：

- **启用开关**独立于省缓存开关，勾选框各管各的。chip 是固定版式的两段状态：
  `省缓存 [开/关] ｜ 提问 [开/关]`，`[开/关]` 复用同一个徽标元件（`.cc-badge`），面板里两个分区头也用它。
- **面板**（输入框右侧）里两块用分隔线分区，可「查看规则」直接看当前生效文本。
- **设置页**里可**编辑规则**：写入 `$DSH_HOME/dsh-cache-control/gate.md`（override），
  不改动插件目录里的内置 `session-gate.md`；点「清除自定义，回到内置」即删除 override。

实现要点（也是几条硬约束的理由）：

- 注入走 `ctx.inject(['systemPrompt']) → systemPrompt.section({ name, order: 400, text })`，
  与 `dsh-web-app` 注入 `app:web-surface` 同一条路；`text` 是**函数**，DSH 每个 model step
  重新 `assemble()`，所以改开关/改文本不用重启也不用新会话。拿不到 `systemPrompt` 服务时只
  关掉会话守则，不影响压缩功能。
- 关 = `text` 返回空串，`renderPrompt` 会丢弃空段 ⇒ 提示词里一个字都不留。
- **文本按 mtime+size 缓存并即时重读**：直接编辑 md 存盘，下一个请求就是新内容（无需重启、无需刷新页面）。
- 注入前把成对花括号 `{{` / `}}` 替换成全角 `｛｛` / `｝｝`：`renderPrompt` 对未知变量引用是
  **抛错**策略，用户编辑规则时写了 `{{...}}` 会让每次请求组装失败 —— 所以宁可改字形也不让会话挂。
- 上限 6 KB（约 2.5k tokens）；超限自动截断并在界面标「超出上限已截断」，避免规则膨胀悄悄吃掉上下文。

### ③ 气泡置顶（纯界面，与①②独立）

| 开关 | 效果 | 实现 |
|---|---|---|
| `pinLastUser` | 滚动时把**已越过会话区上沿的最后一条「我的提问」**钉在顶部：往上翻会换成第 4、3 条……滚到底才钉最近那条（分节标题语义） | 从 `[class*="_userRow"]` 爬到 `[data-chat-flow]` 的直接子元素打 `data-cc-pin` + `position:sticky`；"钉哪一条"按 `rect.top <= 滚动区上沿 + 2px` 判定，`scroll` 触发重选；底衬画在该元素的 `::before` 上（见下） |
| `clearBubble` | 我的气泡背景透明，露出壁纸（配合 dsh-bg-atelier） | `[class*="_userRow"] [class*="_bubble"]{background:transparent}` |
| `pinBlur` | 钉顶底衬的**模糊度**滑杆，0–24px（0 = 只留半透明底、不模糊）；小值有小数档：<3.5 按 0.1 步进（可选 1.3 / 1.5 / 1.7），≥3.5 按 0.5 步进 | `<html style="--cc-pin-blur:Npx">`，底衬规则写 `backdrop-filter:blur(var(--cc-pin-blur,10px))` —— 拖滑杆只改一个变量，不重注入样式 |

我的提问气泡的动态贴合（v1.4.0 起始终生效，无开关；几何由 `probe-userrow.mjs` 用**真浏览器 + 真函数源码**实测）：

**为什么必须用 JS 量一次**：块盒的宽度只跟"可用宽/上限"有关，与文字实际末端无关（inline 盒虽然贴字，
但背景逐行着色、行内 padding 只落在首末片段 ⇒ 框"超"到文字之外、文字也不垂直居中）。所以：

- **CSS 定骨架（尺寸一律 em / 宿主字号变量）**：`userRow` = `display:block; position:relative;
  box-sizing:border-box; width:fit-content; margin-left:auto`，上限 `min(列宽×.55,
  var(--cc-user-bubble-max,41em))`，右缘再留一条轨道 `padding-right:var(--cc-tail-room,2.4em)`；
  `bubble` = 块盒 + **上下对称 padding .47em** + 圆角 `1.45em`；图标行 `position:absolute;
  right:.13em; left:auto; top:var(--cc-tail-y,auto)` ⇒ 落在轨道里 = **气泡右侧**；图标尺寸
  `calc(1.5em + var(--dsh-content-font-delta,0px))` 跟宿主字号走。字号变、页面缩放变，这些一起变 ——
  不再有任何"某次量出来好看就钉死"的像素数。
- **JS 量一次**（`fitUserBubbles()`）：`Range.getClientRects()` 取逐行矩形 ⇒
  ① `stack.style.width = 最宽行 + 左右内边距`（框贴文字；列宽变窄靠 `max-width:100%` 自动夹回）；
  ② 实测图标行宽高 ⇒ 写 `--cc-tail-room`（轨道 = 图标行宽 + .45×图标高）与 `--cc-tail-y`
  （与**最后一行**同高）。变量必须写在 `userRow` 上：图标行是 row 的子节点，写到 `userStack` 上
  继承不到 —— 这是复制键一度跑偏的直接原因。
- 实测（列宽 1180、字号 15px）：10 字 174px、30 字 444px、长文 579px；复制键距气泡右缘
  **13.1px**（em 轨道，随字号缩放）且与末行同高；上下留白 8/8.1 相等；420px 窄容器不越框。
- **两条踩过的坑（别改回去）**：
  ① 用 `bubble.children.length > 0` 判"含内嵌块就跳过"，会把**带 `@路径` 引用的提问**（宿主渲染
     成 `<span>`）整条漏掉 ⇒ 框宽退回"块宽 = 上限"的固定观感（就是"完全不动态"那次反馈）。现在
     只跳过真的含 `img/video/canvas` 或某行矩形异常高（内嵌块）的气泡。
  ② `applyAppearance()` 里任何一步抛错（例如常量改名）会连带把后面的观察器全跳过 ⇒ 被钉元素
     不出现，看起来就是"模糊度失效"。现在每段各自 `try/catch` + `warnOnce`，首屏再补量两次，并在
     `document.fonts.ready` 后清签名重算（字体切换会改行宽，一次量错会被签名锁住）。
- 设置页 ③ 气泡置顶 卡里带一行**底衬实测读数**：被钉元素有/无、`--cc-pin-blur`、
  `getComputedStyle(el,'::before').backdropFilter`、底衬宽、会话字号 +「重读」按钮 ⇒
  以后"看起来失效"能当场分辨是哪一种成因。
- 只处理纯文字气泡；`data-cc-fit` 记签名，流式输出不会每帧重排；停用插件时 `stopFitWatch()`
  把 `stack.style.width` / `--cc-tail-*` / `data-cc-fit` 全撤干净。
- **时间戳零占位**：平时 `opacity:0` 却仍占位 ⇒ `max-width:0;padding:0;overflow:hidden`，
  `:hover` 才展开（展开后的内边距也是 em）。
- 可调点：`USER_BUBBLE_MAX_EM`（上限，默认 41em；测试缝 `internals.setBubbleMaxEm` /
  `setBubbleMaxPx`）、`--cc-tail-room`（轨道宽 = 复制键离框缘的距离，JS 自动量、也可手动覆盖）、
  `FIT_ICON_H`（仅量不到图标时的兜底高度）。钉顶底衬宽度自 **v1.4.2** 起按这条提问的**实测宽度**
  写入 `--cc-pin-w`（量不到才退回 `min(列宽×.55, 上限) + .8em` 的旧上限）。

底衬形态的三次选定：
2026-09-07 选**半透明毛玻璃**（不是实底、不是无底衬）；
2026-09-07 改成**圆角矩形**——原先把毛玻璃铺在被钉住的整行上，而行宽 = 整个会话列宽，
于是气泡**左边一大片空白也在模糊**。现在：

- 行自身只留 `position:sticky`，`background` / `backdrop-filter` 一律不再铺；
- 底衬画在 `::before` 上：`right:-6px`（右缘贴住气泡右缘，宿主 `.userRow` 是 `align-items:flex-end`
  右对齐），宽度 `var(--cc-pin-w, calc(min(calc(var(--dsh-chat-content-width,748px) * .55), 100%) + 12px))`
  —— **v1.4.2 起 `--cc-pin-w` 由 JS 按这条提问的实测宽度写入**（气泡含右侧图标轨道的像素宽 + `.8em` 呼吸位），
  短句就是短底衬、长文就是长底衬；读不到几何时（`getBoundingClientRect` 拿不到正宽）退回括号里那个
  "列宽 × .55 + 12px" 的旧上限兜底；
- 长文钉顶时不再无限撑高：气泡本体 `max-height:38vh` + `overflow-y:auto` +
  `overscroll-behavior:contain`（在气泡内滚，滚到底才交还给会话流），`scrollbar-width:thin`；
- `border-radius:16px` 圆角矩形；四周出 2–6px 呼吸位（`top:-2px;bottom:-2px`，不加 padding ⇒ 不挤动布局）；
- `z-index:-1`：被钉行有 `z-index:6` 自成堆叠上下文，负层因此落在"正文之上、气泡之下"，
  `backdrop-filter` 采到的正是身后滚过去的正文；
- 模糊度走 `--cc-pin-blur` 可调变量，默认 10px。

宽度怎么来的（v1.4.2）：`updatePinPlate()` 在"钉住哪一条"确定后、以及每次重排（`fitUserBubbles`）
结束时各跑一次 —— 量被钉行里 `[class*="_userRow"]` 的实际像素宽，加上 `根字号 × .8` 当呼吸位，
`Math.ceil` 后写进该行的 `--cc-pin-w`；量不到就 `removeProperty`，让 CSS 里的旧上限接管。

一个必须知道的真实边界：sticky 的移动量 = 父级高度 − 自身高度，所以**只有当你那条提问下面
还有比它更高的内容（通常是长回答）时，钉顶才看得出来**；短回答或空会话里它就像没生效。

为什么不是纯 CSS 一行：`sticky` 的移动量 = 父级高度 − 自身高度。真实结构（读自
`dsh-client-ui-chat` 的产物）是
`[data-conversation-scroll] > … > [data-chat-flow] > [data-chat-flow-key] > .userRow > .userStack > .bubble`，
给内层 `.userRow` 直接加 sticky 不会动（父级等高、没有剩余高度），所以要钉的是
`[data-chat-flow]` 的**直接子元素**（每条消息一层）。找行用 `[class*="_userRow"]`，
定层用宿主的稳定属性 `[data-chat-flow]`（该属性在 `column` 上、每条消息的 `data-chat-flow-key`
在其子层，均在产物里核实过）；属性不在时退回"按剩余高度往上爬"的通用判据。
气泡透明只能按类名匹配，而 `uSmzmW_` 这类前缀是构建哈希 ⇒ 用后缀选择器
`[class*="_userRow"] [class*="_bubble"]`，宿主升级改名时最坏结果是这条样式不生效，不会连累其它功能。
设置页会把"钉到了哪个元素 + 共几条提问"打印出来供自检。

观察器分两条：**钉顶**那条只在开关打开时挂 `document.body`（childList + subtree，rAF 去抖），关闭即断开并清掉所有
`data-cc-pin`；**气泡贴合**那条只挂 `[data-chat-flow]` 容器（+ `scroll` / `resize`，90ms 去抖），负责重算框宽、
字尾位置和"钉哪一条"。插件停用/卸载时 `stopFitWatch()` 会撤掉观察器并清干净 `stack.style.width`、
`--cc-tail-*`、`data-cc-fit` 三样内联痕迹。

**输入框右下角 chip 里的「开 / 关」徽标不吃背景**（2026-09-07）：`.cc-chip .cc-badge` 三条规则
把 `background` / `border-color` 都置 `transparent`，状态只靠文字颜色区分（开=品牌蓝、关=三级灰、
未装载=警示黄）。面板与分区头里的同名徽标**保持原样**（那里有底色对比的需要），所以规则限定在
`.cc-chip` 作用域内。

### ④ 对话页（固定会话列宽，v1.3.0 从 dsh-bg-atelier 移入）

| 开关 | 效果 |
|---|---|
| `chatWidthEnabled` + `chatWidth` | 关闭 = 跟随 DSH 自适应；打开 = 把会话列宽钉在 640–3840px（含 1280/1600/1920/2560/3840 快捷键） |

- 钉法：先按 `[data-composer-card]` 往上找到内联带 `--dsh-conversation-column-width` 的那个祖先
  （= 会话根，宿主 `publishWidths` 就在它身上标定列宽），再往它身上写
  `--dsh-chat-content-width` / `--dsh-composer-card-max-width`（宽 +32）/ `--dsh-chat-user-width`
  三个变量并带 `!important`，绕过宿主的响应式 clamp；另有一条 `:root{--dsh-chat-user-width:…!important}`
  兜底，覆盖 composer 还没挂上的窗口期。关闭时逐个 `removeProperty` + 删掉兜底样式，交回自适应。
- 会话根随切会话/导航会重建 ⇒ 另挂一条 MutationObserver（300ms 去抖）**只在开关开着时**存在，
  根节点一重建就把变量补写回去。
- 滑杆拖动过程中只做即时预览（局部 state + 直接钉 CSS 变量），松手/失焦/方向键才 `STORE.set` → 存盘：
  否则每拖一格都会把设置页整页重渲染一遍，手感发涩。
- 与 ③ 的联动：底衬宽度 v1.4.2 起跟随**这条提问的实测宽度**（`--cc-pin-w`），读不到几何时才退回
  `--dsh-chat-content-width × .55` 的旧上限；所以这里改列宽，只在"兜底路径"下才会等比影响钉顶底衬。
- **一次性迁移**：这两项原先存在 `$DSH_HOME/dsh-bg-atelier/settings.json`。host 启动时若发现自家
  `settings.json` 缺 `chatWidth` / `chatWidthEnabled`，就读底图工坊那份搬过来并写盘
  （`migrateFromAtelier()`，日志 `对话页宽度已从 dsh-bg-atelier 迁入`）；搬完之后自家有字段就不再读对方，
  你之后改的值不会被对方旧值盖回。bg-atelier v1.3.0 起客户端不再声明这两个字段，也就不会再 PUT 回去。

## 安装

前提：DSH Desktop（`dsh` CLI 可用），并在装完后**重启桌面应用一次**。DSH 关闭状态下任选其一：

1. 从本仓库装（推荐）：
   ```powershell
   git clone https://github.com/Raylen-berry/dsh-cache-control.git D:\dsh-plugins\dsh-cache-control
   dsh plugin --profile web add link:D:/dsh-plugins/dsh-cache-control
   ```
   （Linux/macOS 把路径换成自己的绝对路径即可；`link:` 改动即生效，便于边改边试。）
2. 手工接线：在 `profiles/web/package.json` 的 `dependencies` 与 `dsh.profile.bundles` 里加
   `dsh-cache-control`，并把 `profiles/web/node_modules/dsh-cache-control` 做成指向本目录的
   junction / symlink。

装完后 host 半（`index.js`，含会话守则段注册）随 profile 装载。

⚠️ **改了 `client.js` 必须重启，光刷新页面没有用**（我此前说过"刷新即可"，那是错的）。
依据（宿主 `dsh-client-modules` 的产物 + 实测）：插件 client 半不是按请求从磁盘读的 —— 它在
**服务启动时一次性 compose** 成带 rev 哈希的 combo，挂在 `/plugins` 前缀下、以
`cache-control: public, max-age=31536000, immutable` 提供。原始路径
`/plugins/dsh-cache-control/client.js` 实测是 **404**（我先前在这里写过它，是错的），
只有 compose 后的哈希 URL 才有响应。唯一能让新字节进图的入口是 `rebuilt(id)`，
而它属于 HMR watch（需要 `pnpm run dev:web` 在跑）。打包运行的桌面应用没有这个 watch
⇒ 磁盘上的新 `client.js` 只有重启才会进组合。重启后 rev 变了、index 注入的是新 URL，
所以浏览器那份一年期 immutable 缓存不会挡住新版。

此后：改规则 md 立即生效（host 每次组装重读磁盘）；开关与滑杆改动即时写盘；
压缩参数对之后新建的会话生效；界面与 chip 的改动要重启才可见。

## 换台机器：可迁移性与**必须手动的步骤**

> 给后续在任何一台机器上接手的人或 agent：**本插件装起来不需要任何手工点击**，
> 但下面几条"换机后不生效 / 得手动做"的事，必须先看清楚，别以为"克隆下来就完事"。
> （起因：用户 2026-09-12 反馈"工作电脑上传、回家发现可用性很差、必须手动操作"。）

**A. 装（agent 可全自动）**

```powershell
git clone https://github.com/Raylen-berry/dsh-cache-control.git <你放插件的绝对路径>
dsh plugin --profile web add link:<同一个绝对路径>
```
`link:` 挂载的意义：改完即生效（开发态），不需要每次重装。

**B. 必须重启 DSH Desktop（人工触发，agent 不能替你决定）**
client 半在**服务启动时**才 compose 进图（依据见上一节），所以"装完刷新页面"是没用的。
重启会掐断正在跑的会话轮次 —— 让用户自己挑时间。

**C. 设置**不随仓库走**（换机器后四项开关全是默认关）**
所有状态都在 `$DSH_HOME/dsh-cache-control/`：`settings.json`（四个开关 + 数值）、
`gate.md`（② 会话守则的自定义覆盖，可选）。**仓库里没有它们**，因此换机器后要重新打开：
① 省缓存 / ② 会话守则 / ③ 气泡置顶 / ④ 对话页 —— 否则会表现为"插件装了但什么都没发生"。

**D. ① 省缓存改的是 preset，不是插件目录**
它把参数写进 `$DSH_HOME/profiles/**/standard/agent.yml` 里 `compaction-basic` 那一行
（带 `# managed by dsh-cache-control` 标记）。换机器/换 profile 后，**必须在新机器上再打开一次总开关**
才会重新写进去；关闭总开关会移除该 config、恢复 DSH 出厂默认。

**E. 已知的宿主坑：插件会被 generation 迁移搬走（本机踩过）**
部分 DSH Desktop 版本在启动时会做 `installGeneration` 迁移，会把 `link:` 挂载的插件重新 stage
一遍，期间把一个**绝对路径当相对路径拼接**⇒ `ENOENT`、迁移被 defer，
`profiles/web/.install-complete` 永远写不出来的同时插件也可能不加载。
本机的处置是给应用 bundle 打一个本地补丁（把本插件加进 `KEEP_IN_SHARED_TREE`）——**该补丁不在本仓库里**，
它属于"每台机器各自的 DSH 应用目录"。识别方法：启动日志出现 `migration deferred` /
`could not stage`，或 `profiles/web/.generations-deferred.json` 反复生成。
遇到就按本机 `dsh-local-patches/README.md` 的脚本处理（DSH 每次升级都会覆盖该补丁，升级后要重跑）。

**G. 设置导出/导入（换机器一键搬配置，v1.5.0 新增）**

```powershell
node tools/settings.mjs export --out D:\cc-settings.json    # 旧机器
node tools/settings.mjs import D:\cc-settings.json --yes    # 新机器（覆盖前自动备份 settings.json / gate.md）
```
`show` 看当前值；不带 `--yes` 演练。它连 **`gate.md`（② 会话守则的自定义规则）一起搬** ——
这是本插件最不该手抄的东西。导入会按与 host `sanitize` 同口径的规则钳制
（触发点 5–95、保留尾部 < 触发点、底衬模糊 0–24 且 1 位小数、钉顶上限 12–80vh、
对话页宽度 30–100% 且旧 px 值归一 80%），未知字段丢弃并列出来；
**host 读盘时还会再 sanitize 一次**，所以口径即使漂了也不会写坏引擎侧。
⚠ ① 省缓存**不在这个文件里**：它改的是 `$DSH_HOME` 里 standard preset 的那一行，
新机器导入后在设置页把总开关关一次再打开即可重新写入。

**F. 换机后自查（30 秒）**

```powershell
node tools/verify-audit.mjs 2>$null; node tools/verify-host-width.mjs   # 期望全绿 / 无 FAIL
# 设置页应出现「会话策略」四项；④ 对话页默认 80%（百分比，v1.5.0 起）
```

## 验证

回归与探针脚本都在本仓库 `tools/` 下（**只用于开发，不进 npm 包**，见 `package.json` 的 `files`）。
分两层：**逻辑回归**（Node 里跑，写盘全部落在临时 home，不碰你真实的 `$DSH_HOME`）与
**浏览器实测**（无头 Chrome，把宿主产物里的真实 CSS 规则与真实类名塞进复刻约束的夹具，判定用数字不用肉眼）。

```powershell
node tools/verify-session-gate.mjs    # 规则解析 / 花括号防御 / 截断 / 压缩行无回归
node tools/verify-gate-http.mjs       # host 半真起 http 服务：路由、两开关正交、异常输入
node tools/verify-gate-client.mjs     # client 半真渲染：磁盘 → 路由 → STORE → DOM（含抽屉展开态）
node tools/verify-ui-appearance.mjs   # 外观引擎 + 置顶跟随滚动选条 + chip 点击语义 + 对话页宽度钉法
node tools/verify-host-width.mjs      # host：字段钳制 + 从底图工坊的一次性迁移（临时 DSH_HOME）
```

浏览器侧（会往 `tools/*-out/` 落 HTML/JSON/PNG，已在 `.gitignore` 里）：

```powershell
node tools/probe-userrow.mjs          # 气泡贴文字 / 复制键在气泡右侧轨道 / 上下留白对称（跑的是 client.js 里的真函数源码）
node tools/cc-appear-probe.mjs        # 钉顶底衬形态与模糊度：--dump-dom 让页面自量自报
node tools/cc-fixture.mjs             # 面板朝向与 portal：插槽/portal × 旧朝向/新朝向
node tools/cc-appear-fixture.mjs      # 同一批判定的 CDP 版
```

脚本里的默认路径是**本机（Windows + DSH Desktop）的绝对路径**，换机器用环境变量覆盖即可：
`DSH_CC_PLUGIN`（本插件目录）、`DSH_APP_MODULES`（宿主 `node_modules`）、`DSH_CHAT_BUNDLE`
（`dsh-client-ui-chat/lib/client.js`）、`DSH_CC_INDEX`、`DSH_TOOL_HOME`（临时 home）、
`DSH_TOOL_OUT`（夹具输出目录）、`CHROME`（Chrome 可执行文件）。
`verify-gate-client.mjs` 里对底图工坊的交叉断言在找不到对面插件时会自动 SKIP（`DSH_BGA_CLIENT` 可指定）。

夹具里量出来的关键数字（写在这里，下次改动好比对是否退化）：
旧朝向面板可见比例 `0.021`（超出视口底部 411px）；新朝向完整可见。
钉顶：`position:sticky`、`top:0px`、被钉元素 `y:0 h:84`、`travelPx:676`、滚动 1298px 后仍在滚动区顶；
透明：开 `rgba(0, 0, 0, 0)` / 关 `rgb(47, 47, 52)`（后者是宿主 `--dsw-specific-bubble` 的真值）。
底衬（2026 形态，`cc-appear-probe.mjs` 实量，夹具视口 1280 / 列宽 748）：整行
`rowBg rgba(0, 0, 0, 0)` + `rowBackdrop none`（左侧干净）；`::before` 底衬
**v1.4.2 起按该条提问实测宽度**：夹具里 411px 宽的气泡 ⇒ `--cc-pin-w ≈ 423.4px`
（= 411 + 根字号 15 × .8，向上取整），对整行 `748px` ⇒ 左边留出 ~324px 不糊；短句提问则底衬跟着变短。
（v1.4.2 之前是"定长"：`423.4px` = 748×.55 + 12，短消息时明显比气泡宽；v1.4.0 之前是 `537.094px` = 748×.702 + 12。）
`border-radius:16px`；
`position:absolute / z-index:-1`；右缘 `right:-6px` 与气泡右缘差 6px；
`--cc-pin-blur` 未设 ⇒ `blur(10px)`，设 `0px` ⇒ `blur(0px)`，设 `20px` ⇒ `blur(20px)`。
注意夹具的坑：最后一条提问下面若没有长回答，sticky 没有移动量，量出来会误判成"没钉住"；
`--dump-dom` 那条还必须给每个状态独立的 `--user-data-dir`，否则后启动的实例会把活儿交给
已在跑的浏览器进程、自己退出，dump 出来就是空文件。

## 卸载 / 回退

1. 关闭省缓存总开关（把 standard 还原为出厂默认），或手动删除组装文件里带
   `# managed by dsh-cache-control` 的 config 块；关闭会话守则开关即可让规则段消失。
2. 在 profile 移除依赖与 bundle 项、删除 junction；或 `dsh plugin --profile web remove dsh-cache-control`。
3. 重启应用。插件停用/卸载后不残留任何行为改动（`gate.md` override 与 `settings.json` 是数据，需自行删除）。

## 版本与变更记录

- **v1.5.0**（④ 对话页：宽度单位 px → **百分比**）
  - 起因（用户 2026-09-12 原话）："改成百分比，具体的数值不仅会随着全屏或是缩小有变动，
    还会因为显示器的比例出现不协调。"固定 640–3840px 在全屏/缩窗时不跟着走，换显示器比例就失配。
  - **改法**：`chatWidth` 语义从 px 变成 **30–100 的百分比**，三个变量写同一个 P% ——
    `--dsh-chat-content-width` / `--dsh-composer-card-max-width` / `--dsh-chat-user-width`
    都写 `P%`（`:root` 兜底那条同样写 `%`）；滑杆 30–100、步长 1，快捷键改成 60/70/80/90/100%。
  - **真浏览器实测**（本机会话区 `clientWidth` 1139，在真会话里量消息列与输入卡）：
    `80%` ⇒ 消息列 **860px**、输入卡 **886px**；`60%` ⇒ 645 / 664；`100%` ⇒ 1075（满宽）/ 1107。
    即三个变量都是"**可用内容区的 P%**"（100% 时 1075 = 1139 − 两侧 32px 内边距），
    而输入卡恰好 = `P% ×(内容区 + 32)` ⇒ **卡片永远比消息列宽 32×P 像素** ——
    与 px 时代"+32px 出挑"的关系**完全一致**，只是整体按比例缩放。
    （一度以为会"复合两次"导致卡片过窄：那是在**空会话**页量的，那页的 composer stack 宽度不同；
    真会话里不复合。这条记在这里，免得下次又被空页面误导。）
  - **迁移**：盘上的旧 px 值（>100，例如你现在的 900）不再按 px 用，一律落到默认 **80%**
    —— 900px 在本机 1139px 会话区里正好≈79%，观感等价；由 `normalizeChatWidth()` 在
    host 与 client **两端**同口径处理（`sanitize` / `clampChatWidth`），
    底图工坊那次一次性迁移（`migrateFromAtelier`）也一并走这条口径。
  - 验证：`verify-host-width.mjs` **全绿**（新增"60 原样 / 10→30 / 900 与 3840 旧 px → 80"四条）；
    `verify-ui-appearance.mjs` **50 passed / 0 failed**（新增"三个变量都是 90%"与"旧 px 1600 → 80%"）；
    `verify-gate-client.mjs` **67 passed / 0 failed**。
  - 顺手修了 `verify-gate-client.mjs` 里一条**早就假失败**的断言：它要求底衬规则含
    `width:calc(min(`，而 v1.4.2 起那层已经是 `width:var(--cc-pin-w, calc(min(…)))`
    （早于本轮的单位改动，与本轮无关，只是这次跑测试才发现）。
    另把 `verify-host-width.mjs` 里"删掉文件再看它不存在"的断言改成**哨兵文件**写法 ——
    本机沙箱会把 `fs.rmSync` 拦成空操作（实测 rmSync 之后 `existsSync` 仍为 true），
    那种写法会假失败，改成"跑完看哨兵内容有没有被改写"，反而更直接地证明"不写盘"。

- **v1.4.2**（钉顶底衬改"实测宽度" + 长文限高）
  - 底衬宽度不再"定长"：新增 `updatePinPlate()`，在钉住哪一条确定后、以及每次气泡重排
    （`fitUserBubbles`）结束时，量出被钉行里 `[class*="_userRow"]` 的实际像素宽 + `根字号 × .8`
    呼吸位，写进该行的 `--cc-pin-w`（短句 ⇒ 短底衬）；量不到就 `removeProperty`，
    由 CSS 里的旧上限 `min(列宽×.55, 上限) + .8em` 兜底。
  - 长提问钉顶不再无限撑高：气泡本体 `max-height:38vh` + `overflow-y:auto` +
    `overscroll-behavior:contain` + `scrollbar-width:thin` —— 超出时在气泡内滚，滚到底才交还会话流。
  - 只动 `client.js` 与版本号；host 半、路由、settings 字段均未变，**不需要重启**（客户端热更新即可）。
- **v1.4.1**（根因修复 + 尺寸自适应）
  - `applyAppearance` 每段各自 `try/catch` + `warnOnce`：一处抛错不再连带把钉顶/贴合观察器全部
    跳过（那会让"底衬模糊度"看着像失效）；首屏补量两次 + `document.fonts.ready` 后清签名重算。
  - 气泡量测不再按 `children.length` 整条跳过（带 `@路径` `<span>` 的提问曾被全漏 ⇒ 框宽退回固定
    上限），改为只跳过真含 `img/video/canvas` 或内嵌块的气泡；轨道宽与纵向对齐改为**实测图标行**。
  - 尺寸全面 em 化：气泡内边距/圆角/图标尺寸/轨道宽/上限(`USER_BUBBLE_MAX_EM` 取代 px 常量)/
    chip 徽标与标签位移一律 em 或实测值，跟随会话字号与页面缩放自适应。
  - 设置页 ③ 新增**底衬实测读数**自检行 +「重读」按钮；提问气泡图标区隐藏宿主 tooltip。

- **v1.4.0**（改名 / 气泡微调 / 小数档）
  - **分区名改**：② 门禁 → **② 会话守则**（chip 工具提示、设置页、规则 md 标题同步）；
    ③ 外观 → **③ 气泡置顶**。
  - **我的提问气泡微调**（始终生效）：宽度上限系数 `.702 → .55`；上下 padding 压到 6px
    （行距/字号不动）；时间/复制那一行从气泡下方挪到气泡**文末右侧同排**，放不下才换行；
    钉顶底衬公式同步改用 `.55`（实测列宽 748 ⇒ 气泡 411px / 底衬 ~423.4px）。
  - **`pinBlur` 支持 1 位小数**：<3.5 按 0.1 步进（可到 1.3 / 1.5 / 1.7），≥3.5 按 0.5 步进；
    host `sanitize` 同口径保留 1 位小数。
- **v1.3.0**（本轮四项）
  - **钉顶底衬改形态**：从"铺满被钉住的整行"改为画在 `::before` 上的**定长圆角矩形**，
    整行不再有 `background` / `backdrop-filter` ⇒ 会话列左侧不再被模糊；新增
    **可调模糊度** `pinBlur`（0–24px，写在 `<html>` 的 `--cc-pin-blur` 上，拖滑杆不重注入样式）。
  - **chip 的「开 / 关」徽标改纯透明**：`.cc-chip .cc-badge` 三条规则去掉背景与描边，
    状态只靠文字颜色；面板内的同名徽标不受影响。
  - **名称一律压到 2–4 字**：设置页导航条目 `会话策略 · 省缓存/守则` → **会话策略**；
    分区标题 → `省缓存` / `会话守则` / `气泡置顶` / `对话页`；快捷面板分区头同步缩短。
    长说明没删，都挪到各卡正文与 hover 里。
  - **接住 bg-atelier 的「对话页固定宽度」**：新增 ④ 对话页卡（开关 + 640–3840px 滑杆 +
    常用宽度快捷键 + 会话根重建时的补写观察器），并由 `migrateFromAtelier()` 在启动时
    一次性把 `$DSH_HOME/dsh-bg-atelier/settings.json` 里的 `chatWidth` / `chatWidthEnabled`
    搬进自家 `settings.json`（只在自家缺这两个字段时读对方，之后不再读）。
  - `sanitize` 新增三字段钳制：`pinBlur` 0–24（v1.4.0 起保留 1 位小数）、`chatWidth` 640–3840、`chatWidthEnabled` 只认 `true`。
  - 验证补三条：`cc-appear-probe.mjs`（无 CDP 的浏览器实量，本沙箱里唯一跑得通的那条）、
    `verify-host-width.mjs`（钳制 + 迁移幂等）、`verify-bga-trim.mjs`（对面插件的回归）。
- **v1.2.0**
  - 新增 **③ 会话区外观**：`pinLastUser`（最近一条「我的提问」钉顶）、`clearBubble`（我的气泡背景透明）。
    纯客户端样式 + 运行时打标记，设置项持久化在同一个 `settings.json`。
    两项形态按用户选定实现：钉在**会话滚动区顶部**、钉住条目自带**半透明毛玻璃底衬**。
    开关默认 `false`，不由插件替用户打开。
  - chip 改为**三段可点**：`省缓存 [开/关] ｜ 提问 [开/关] ｜ ▾`。点前两段直接切对应开关，
    ▾ 才弹滑杆与规则面板（不用进设置页）；每段 hover 有独立介绍。
  - **修"点开面板看不见"**：旧写法 `top: chip 下沿 + 6`，而输入条贴在视口底部 ⇒ 面板整块开到屏幕外。
    无头 Chrome 夹具实测（`03-调试临时/cc-fixture.mjs`，三个 variant 只动「父级」与「朝向」两个变量）：
    旧朝向可见比例 **0.021**（超出视口底部 411px）；改成贴 chip 上沿 + `max-height` 锁进可用空间后完整可见。
    同时把面板 portal 到 `body`（与宿主 `dsh-client-ui-attachment` 同源做法）——**实测它不是主因**：
    朝向正确时留在插槽里也完整可见；portal 消除的是 `contain:paint`／"裁剪盒恰是包含块"这类组合。
  - 新增两道能力/状态闸：`loaded`（没成功读到设置就拒绝保存，防止默认值盖掉真实配置）、
    `gateReady` / `appearanceReady`（旧 host 不认识的字段一律禁用对应开关，避免写盘被抹）。
  - 修 `readBody` 超限时 `req.destroy()` 打断连接的缺陷（客户端 ECONNRESET + Windows libuv 断言），改为排空后回 400。
- **v1.0.0** 仅省缓存（压缩策略）单开关。

> 说明：本插件只写 `$DSH_HOME/dsh-cache-control/*` 与 standard preset 的 `compaction-basic` 行。
> 任何替你改动运行时开关值的行为都应算作越界——v1.1.0 曾直接写入过 `gateEnabled: true`，已记在此处。

## 说明与限制

- **会话守则是软约束**：它让规则每请求都在提示词里、且不被压缩稀释，但不产生技术硬拦截 —— 模型仍可违反。
  真要拦截得走工具层/审批钩子，那是另一件事。
- 修改点位于打包目录（app 安装的 node_modules，profile 以 junction 指向它）；
  若 DSH 升级重建该文件，插件启动时会自动对账并重新应用当前设置（写回标记行）。
- 浏览器端刻意不编辑组装文本；本插件的“编辑”由其 host 进程完成，页面只有开关、滑杆与规则编辑器。
- 数值换算显示用 `ROUTED_CONTEXT_WINDOW = 1_000_000` 这个常量（当前路由 qwen3.8-flash 声明的窗口
  也是 1,000,000，所以对你这台机器是对的）；若换到别的窗口的模型，界面上的 token 数会失真，
  但引擎侧是**比例式阈值**，实际触发点仍按窗口同比变化。token 数为 token-meter 的估算口径。
- v1.2.0 起 chip 固定为三段：`省缓存 [开/关] ｜ 提问 [开/关] ｜ ▾`，前两段点击即切换、
  ▾ 弹滑杆与规则面板；标签不随状态改名（v1.1.0 那套"两个都开就叫会话策略"已去掉）。
