# 变更记录

（本仓库此前没有 changelog，从这一轮开始记。更早的历史见 README 与 `git log`。）

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
