# 变更记录

（本仓库此前没有 changelog，从这一轮开始记。更早的历史见 README 与 `git log`。）

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
