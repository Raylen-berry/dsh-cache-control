// 客户端半的渲染验证：真 React + react-dom/server，把 client.js 当浏览器那样
// 通过 __ModuleLoader__ 装载，fetch 指向本脚本用 host 半真跑起来的 http 服务。
// 证明：磁盘设置 → 路由 → STORE → DOM；两个开关互不牵连；chip 版式＝两段标签+徽标+竖线。
const PLUGIN = process.env.DSH_CC_PLUGIN || 'D:/DeepSeek/dsh-plugins/dsh-cache-control/';
const APP = process.env.DSH_APP_MODULES || 'D:/deepseek-harness/DSH Desktop/resources/app/node_modules/';
const fs = await import('node:fs')
const pathMod = await import('node:path')
const os = await import('node:os')
const ROOT = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'cc-gate-client-'))
process.on('exit', () => fs.rmSync(ROOT, { recursive: true, force: true }))
const http = await import('node:http')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')) }
}

// ---- 临时 DSH_HOME，含一份最小 preset 夹具，绝不写用户真实文件 ----
// v1.10.2 夹具化（同 verify-session-gate v1.9.4 的口径）：以前这里 copyFileSync 真 %APPDATA%
// 下的 agent.cordis.yml、收尾又读真实 settings.json 做对照 —— 本机绿纯属"这台机器装过 DSH"。
// 本套件的 client 侧断言只消费 preset 的**文本结构**（compaction-basic 行块），仓库自带夹具足够；
// "真实文件未被改动"的守护在真实 home 存在时照比，不存在就 SKIP 并如实打印 ⇒ CI/干净机器可跑。
const presetDir = pathMod.join(ROOT, 'profiles/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard')
fs.mkdirSync(presetDir, { recursive: true })
fs.mkdirSync(pathMod.join(ROOT, 'dsh-cache-control'), { recursive: true })
const MINIMAL_PRESET = [
  '# minimal fixture for verify-gate-client (structure mirrors the real standard preset)',
  '- id: persona',
  "  name: '@deepseek-ai/dsh-persona'",
  '  config:',
  '    suffix: Your working directory is {{cwd}}.',
  '- id: compaction',
  '  name: cordis:group',
  '  group: true',
  '  isolate:',
  '    compaction: true',
  '  config:',
  '    - id: compaction-basic',
  "      name: '@deepseek-ai/dsh-compaction-basic'",
  '      # managed by dsh-cache-control (auto-rewritten)',
  '      config:',
  '        thresholdRatio: 0.30',
  '        retainRatio: 0.04',
  '        auto: true',
  '',
].join('\n')
fs.writeFileSync(pathMod.join(presetDir, 'agent.cordis.yml'), MINIMAL_PRESET, 'utf8')
process.env.DSH_HOME = ROOT
const settingsFile = pathMod.join(ROOT, 'dsh-cache-control', 'settings.json')
// 用户真实设置的当前快照，收尾比对（本机装了 DSH 才有；CI 上跳过那两条并如实标注）
const REAL_HOME = pathMod.join(process.env.APPDATA || '', 'dsh-desktop', 'harness', 'dsh-cache-control')
const haveRealHome = fs.existsSync(pathMod.join(REAL_HOME, 'settings.json'))
const realSettingsBefore = haveRealHome ? fs.readFileSync(pathMod.join(REAL_HOME, 'settings.json'), 'utf8') : null
const hadRealGateMd = haveRealHome && fs.existsSync(pathMod.join(REAL_HOME, 'gate.md'))

const unwrap = (m) => (m && m.default && (m.default.createElement || m.default.renderToStaticMarkup)) ? m.default : m
const host = await import('file:///' + PLUGIN + 'index.js')
const React = unwrap(await import('file:///' + APP + 'react/index.js'))
const ReactDOMServer = unwrap(await import('file:///' + APP + 'react-dom/server.js'))
// 宿主原子包（Switch/Button…）：client 半经 require('@deepseek-ai/dsh-client-ui-primitives') 取用。
// Node 下它 import 'clsx' 解析不到（打包产物在浏览器里由 seed 提供），所以这里**不 import 真身**，
// 而是按真签名复刻一份桩；读宿主 lib/index.js 只为确认签名没变（变了说明桩该跟着改）。
// 于是本套件不再依赖"这台机器装过 DSH"：CI/干净机器上桩照样装载，断言口径不变。
const PRIM_REL = '@deepseek-ai/dsh-client-ui-primitives/lib/index.js'
const SW_SIG = 'function Switch({ checked, onChange, label, disabled'
// 仓库自己的 node_modules 根（run-all 会把 DSH_APP_MODULES 指到这里；直接手工跑时也要能找到）
const REPO_ROOT = pathMod.resolve(new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))
const makePrimitives = () => ({
  Switch: (p) => React.createElement('button', {
    type: 'button', role: 'switch', 'aria-checked': p.checked, 'aria-label': p.label,
    title: p.title, disabled: p.disabled, className: p.className,
    onClick: () => p.onChange(!p.checked),
  }, React.createElement('span', { className: 'pr-thumb' })),
  Button: ({ variant, size, icon, className, children, ...rest }) => React.createElement('button',
    Object.assign({ type: 'button', className: 'pr-btn pr-' + variant + ' pr-' + size + (className ? ' ' + className : '') }, rest), children),
})
let primitives = null
try {
  // 依次看 DSH_APP_MODULES、仓库自己的 node_modules、本机 DSH 安装目录；任一处签名对得上即确认。
  const primCandidates = [pathMod.join(APP, PRIM_REL), pathMod.join(REPO_ROOT, 'node_modules', PRIM_REL),
    'D:/deepseek-harness/DSH Desktop/resources/app/node_modules/' + PRIM_REL]
  let sigFound = false
  for (const p of primCandidates) {
    try { if (fs.readFileSync(p, 'utf8').indexOf(SW_SIG) >= 0) { sigFound = true; break } } catch { /* 下一个 */ }
  }
  primitives = makePrimitives()
  if (!sigFound) console.log('  NOTE  未读到宿主 primitives 源码 ⇒ 桩未经签名核对（本机与 CI 都可能这样）：' + primCandidates[0])
} catch { primitives = null }
ok('primitives 桩已装载（否则本套件只测了回退路径）', primitives !== null)
const h = React.createElement

const routes = new Map()
const webServer = { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }
const ctx = {
  get: (n) => (n === 'webServer' ? webServer : undefined),
  effect: (fn) => fn(),
  inject: (deps, cb) => cb({ systemPrompt: { section: () => () => {} } }),
}
await host.apply(ctx)
const server = http.createServer((req, res) => {
  const pathname = (req.url || '').split('?')[0]
  const handler = routes.get(pathname)
  if (!handler) { res.writeHead(404); res.end('{}'); return }
  handler(req, res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
let base = 'http://127.0.0.1:' + server.address().port
const nodeFetch = globalThis.fetch
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const warnings = []
const origError = console.error
console.error = function (...args) { warnings.push(args.map(String).join(' ')) }

/** 装载一份全新的 client 半（query 破缓存取新实例），返回两个槽里的元素。 */
const portalTargets = []
// 顺带把插件注入的样式原文收下：三项外观要求（定长圆角底衬 / 可调模糊 / chip 徽标
// 无背景）都是纯 CSS 层面的事，只有拿到真实注入文本才算检验，而不是读源码字符串。
const injectedCss = []
const fakeReactDOM = {
  createPortal: (node, container) => { portalTargets.push(container); return node },
}
async function bootClient(tag) {
  let captured = null
  globalThis.window = { __ModuleLoader__: { load: (m) => { captured = m } }, innerWidth: 1400, innerHeight: 900 }
  globalThis.document = {
    createElement: () => ({ setAttribute() {}, textContent: '', type: '' }),
    head: { appendChild(el) { if (el && el.textContent) injectedCss.push(el.textContent) } },
    body: { nodeName: 'BODY', appendChild() {}, contains() { return false } },
  }
  globalThis.fetch = (u, o) => nodeFetch(base + String(u), o)
  await import('file:///' + PLUGIN + 'client.js?' + tag)
  if (!captured) throw new Error('client.js did not call __ModuleLoader__.load')
  const slots = []
  const fakeCtx = {
    get: (n) => (n === 'slots' ? {
      inject: (name, fn) => { fn((entry, comp) => { slots.push({ entry, comp }); return entry }) },
      register: (entry, comp) => { slots.push({ entry, comp }); return entry },
    } : undefined),
    effect: (fn) => fn(),
  }
  const exportsObj = captured.factory((name) => {
    if (name === 'react') return React
    if (name === 'react-dom') return fakeReactDOM
    // v1.9.3：client 半软 require 宿主原子包；这里喂**真包**（它只 import react，
    // Node 条件导出解析到源码、clsx 在 APP 下可解析），Switch/Button 才走真实实现。
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error('unexpected require: ' + name)
  })
  exportsObj.apply(fakeCtx)
  await sleep(150)
  const page = slots.find((s) => s.entry.name === 'settings.section')
  const chip = slots.find((s) => s.entry.name === 'conversation.input.right')
  return { page: page && page.comp(), chip: chip && chip.comp(), pageEntry: page && page.entry, ex: exportsObj }
}

const render = (el) => ReactDOMServer.renderToStaticMarkup(el)
/** 用「设置页说明抽屉默认展开」重渲染一份页面 —— 长说明正文只在展开态出现。 */
const expanded = (c) => {
  c.ex.internals.setFoldsOpen(true)
  const hh = render(c.page)
  c.ex.internals.setFoldsOpen(false)
  return hh
}
const checkedCount = (html) => (html.match(/checked=""/g) || []).length + (html.match(/aria-checked="true"/g) || []).length
/** chip 版式解析：两段「标签 + 开/关徽标」+ 一根竖线 */
function chipParts(html) {
  const labels = [...html.matchAll(/class="cc-segLabel"[^>]*>([^<]*)</g)].map((m) => m[1])
  const badges = [...html.matchAll(/<span class="cc-badge([^"]*)">([^<]*)<\/span>/g)]
    .map((m) => ({ state: m[2], on: /\bon\b/.test(m[1]), dim: /\bdim\b/.test(m[1]) }))
  const divs = (html.match(/class="cc-div"/g) || []).length
  return { labels, badges, divs }
}
/** 按 label 文本取回它的开/关控件属性串（判勾选/禁用）。
 *  v1.9.3：primitives 在场时 Switch 渲染 role="switch"、label 走 aria-label；
 *  退回路径仍是 <input type=checkbox><span>{label}。两种形态都认，断言口径不变。 */
function inputAttrsFor(html, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // checkbox 回退路径在前（真包形态下 Switch 的 disabled 不带 =""，先匹配到谁就用谁）
  const m = new RegExp('<input([^>]*)><span>' + esc).exec(html)
  if (m) return m[1]
  const sw = new RegExp('<button([^>]*aria-label="' + esc + '"[^>]*)>').exec(html)
  return sw ? sw[1] : null
}
const checked = (html, label) => {
  const a = inputAttrsFor(html, label)
  return a === null ? null : /checked=""/.test(a) || /aria-checked="true"/.test(a)
}
const disabled = (html, label) => {
  const a = inputAttrsFor(html, label)
  return a === null ? null : /disabled=""/.test(a) || /disabled/.test(a)
}
const L_CACHE = '启用压缩策略（作用于之后新建的标准模式会话）'
const L_AUTO = '自动压缩（关闭 = 仅保留手动 /compact）'
const L_GATE = '启用会话守则（下一个请求即生效，含已打开的会话）'
const L_PIN = '把最近一条「我的提问」钉在会话区顶部'
const L_CLEAR = '我的气泡背景透明（露出壁纸）'
// chip 四段标签（v1.10.0 起第三段是 ponytail「懒码」；v1.12.0 起第四段是输出形状「形状」）。
// 徽标顺序 = 省缓存 / 提问 / 懒码 / 形状。
const CHIP_LABELS = ['省缓存', '提问', '懒码', '形状']
// 输出形状的开关文案（它**默认开**，所以凡是要验"某段是关"的夹具都得显式写 shapeEnabled:false）。
const L_SHAPE = '启用输出形状（下一个请求即生效，含已打开的会话；默认开）'

console.log('\n— A. 关缓存 / 开门禁 —')
// v1.11.0：ponytail / 审查技能显式钉成关（A 段验的是"只开门禁"，ponytail 开着第三段徽标就不是
// 「关」；审查技能按 DEFAULTS **默认开**，不关掉会多一个勾选框、脏掉 checkedCount）。
// v1.12.0：输出形状同理，而且它**默认开** ⇒ 不显式写 false，第四段徽标必然是「开」。
// ⚠ 必须写在 bootClient() **之前**：本插件的 STORE 是模块级单例，bootClient 里那次 GET 才是
// 状态来源 —— 写完盘再 render 不会重读（先写后 render 才拿得到新值）。
fs.writeFileSync(settingsFile, JSON.stringify({ enabled: false, triggerPct: 30, retainPct: 4, auto: true, gateEnabled: true }))
let c = await bootClient('a' + Date.now())
// v1.11.0：A 段还要验"第三段徽标是关"与 checkedCount 基线 ⇒ 显式钉上 ponytailEnabled:false /
// reviewSkillEnabled:false（ponytail 开着第三段就不是「关」；审查技能按 DEFAULTS **默认开**，
// 不关掉会多一个勾选框）。
// ⚠ 必须**重开实例**：本插件的 STORE 是模块级单例，bootClient() 里那次 GET 才是状态来源 ——
// 写完盘只 render 不会重读，读到的是上一次实例留下的状态（第一版栽在这，四条断言集体假失败）。
fs.writeFileSync(settingsFile, JSON.stringify({ enabled: false, triggerPct: 30, retainPct: 4, auto: true, gateEnabled: true, ponytailEnabled: false, reviewSkillEnabled: false, shapeEnabled: false }))
c = await bootClient('a2' + Date.now())
let pageHtml = render(c.page)
const pageExp = expanded(c)
let chipHtml = render(c.chip)
let parts = chipParts(chipHtml)
ok('设置页渲染成功', pageHtml.length > 500, pageHtml.length + ' chars')
ok('两块卡都在（名称已压到 2–4 字，无编号）', pageHtml.includes("cc-h\">省缓存") && pageHtml.includes("cc-h\">会话守则"),
  'h3=' + (pageHtml.match(/<h3[^>]*>([^<]*)<\/h3>/g) || []).join(' '))
ok('门禁卡显示规则体积与行数', /\d+(\.\d+)?\s(B|KB)\s·\s\d+\s行/.test(pageHtml), (pageHtml.match(/\d+(\.\d+)?\s(B|KB)\s·\s\d+\s行/) || [''])[0])
ok('门禁卡列出内置规则路径（展开说明可见）', pageExp.includes('session-gate.md'))
ok('说明默认收进抽屉：总述与各卡长说明正文不在默认页面上',
  !pageHtml.includes('八块互相独立的开关') && !pageHtml.includes('出厂默认（压力达窗口 80% 压缩')
  && !pageHtml.includes('不产生技术硬拦截') && !pageHtml.includes('三项都是纯界面开关'))
ok('展开后说明正文可见', pageExp.includes('不产生技术硬拦截') && pageExp.includes('三项都是纯界面开关'))
ok('门禁开关已勾选', checked(pageHtml, L_GATE) === true)
ok('压缩开关未勾选（互不牵连）', checked(pageHtml, L_CACHE) === false)
ok('自动压缩仍按设置勾选', checked(pageHtml, L_AUTO) === true)
ok('chip 四段标签为 省缓存 / 提问 / 懒码 / 形状', parts.labels.join(',') === CHIP_LABELS.join(','), parts.labels.join(','))
ok('chip 徽标：关 / 开 / 关 / 关（A 段只开门禁）', parts.badges.length === 4
  && parts.badges[0].state === '关' && parts.badges[1].state === '开' && parts.badges[2].state === '关'
  && parts.badges[3].state === '关',
  JSON.stringify(parts.badges.map((b) => b.state)))
ok('徽标高亮态与开关一致（只有第二段亮）',
  parts.badges[0].on === false && parts.badges[1].on === true && parts.badges[2].on === false
  && parts.badges[3].on === false)
ok('chip 三根竖线（四段之间各一根）', parts.divs === 3, 'divs=' + parts.divs)
ok('chip 是五个按钮（四段可点 + ▾）', (chipHtml.match(/<button/g) || []).length === 5,
  'buttons=' + (chipHtml.match(/<button/g) || []).length)
ok('每段各有 hover 介绍（title）', (chipHtml.match(/title="/g) || []).length === 5,
  'titles=' + (chipHtml.match(/title="/g) || []).length)
ok('介绍里写清了"点这一段=直接开/关"与生效范围',
  chipHtml.includes('点这一段 = 直接开/关') && chipHtml.includes('只影响之后新建的') && chipHtml.includes('下一个请求'))
ok('▾ 带 aria-expanded（未展开为 false）', /aria-expanded="false"/.test(chipHtml))
ok('容器是 span 不是 button（避免 button 套 button）', /<span class="cc-chip/.test(chipHtml))
ok('气泡置顶卡存在（含可调模糊度滑杆）', pageHtml.includes('钉顶底衬模糊度') && /cc-h">气泡置顶/.test(pageHtml),
  'h3=' + (pageHtml.match(/<h3[^>]*>([^<]*)<\/h3>/g) || []).join(' '))
ok('外观两开关可用且默认关（新 host 会带回这两个字段）',
  checked(pageHtml, L_PIN) === false && checked(pageHtml, L_CLEAR) === false && disabled(pageHtml, L_PIN) === false)
ok('关着时不显示自检行', !pageHtml.includes('钉住位置自检'))

console.log('\n— B. 开缓存 / 关门禁 —')
fs.writeFileSync(settingsFile, JSON.stringify({ enabled: true, triggerPct: 30, retainPct: 4, auto: false, gateEnabled: false, ponytailEnabled: false, reviewSkillEnabled: false, shapeEnabled: false }))
c = await bootClient('b' + Date.now())
chipHtml = render(c.chip)
pageHtml = render(c.page)
const pageExpB = expanded(c)
parts = chipParts(chipHtml)
ok('chip 徽标翻成 开 / 关 / 关 / 关', parts.badges[0].state === '开' && parts.badges[1].state === '关'
  && parts.badges[2].state === '关' && parts.badges[3].state === '关',
  JSON.stringify(parts.badges.map((b) => b.state)))
ok('标签不随状态改名（版式稳定）', parts.labels.join(',') === CHIP_LABELS.join(','), parts.labels.join(','))
ok('压缩已勾选、门禁未勾选', checked(pageHtml, L_CACHE) === true && checked(pageHtml, L_GATE) === false)
ok('自动压缩子开关独立关着', checked(pageHtml, L_AUTO) === false)
ok('门禁卡仍列出守则摘要（展开说明可见，含 v1.9.2 的 R5）',
  pageExpB.includes('R1') && pageExpB.includes('R2') && pageExpB.includes('R3') && pageExpB.includes('R5'))
ok('门禁卡有编辑/重读按钮', pageHtml.includes('编辑规则') && pageHtml.includes('重新读取'))
ok('门禁声明了"约束而非硬拦截"（展开说明可见）', pageExpB.includes('不产生技术硬拦截'))

console.log('\n— C. 全开（压缩 + 门禁 + ponytail + 输出形状 + 外观两项）—')
fs.writeFileSync(settingsFile, JSON.stringify({ enabled: true, triggerPct: 25, retainPct: 5, auto: true, gateEnabled: true, ponytailEnabled: true, reviewSkillEnabled: false, shapeEnabled: true, pinLastUser: true, clearBubble: true }))
c = await bootClient('c' + Date.now())
chipHtml = render(c.chip)
pageHtml = render(c.page)
const pageExpC = expanded(c)
parts = chipParts(chipHtml)
ok('chip 四个徽标都亮', parts.badges.length === 4 && parts.badges.every((b) => b.state === '开' && b.on === true))
ok('七个勾选框全勾（压缩 + 自动压缩 + 门禁 + ponytail + 输出形状 + 钉顶 + 透明）', checkedCount(pageHtml) === 7, 'checked=' + checkedCount(pageHtml))
ok('输出形状开关已勾选（默认开的段，关得掉也开得回来）', checked(pageHtml, L_SHAPE) === true)
ok('外观两开关已勾选', checked(pageHtml, L_PIN) === true && checked(pageHtml, L_CLEAR) === true)
ok('开着钉顶时给出自检行', pageHtml.includes('钉住位置自检'))
ok('设置页保留三处生效语义说明（展开说明可见）',
  pageExpC.includes('之后新建') && pageExpC.includes('下一个请求') && pageExpC.includes('position:sticky'))

console.log('\n— D. host 不可达时的降级 —')
server.close()
c = await bootClient('d' + Date.now())
chipHtml = render(c.chip)
ok('拿不到数据不崩，chip 仍渲染', chipHtml.includes('cc-chip'))
ok('错误文案可见', render(c.page).includes('加载失败'))

console.log('\n— E. 旧版 host（只刷新页面、没重启）—')
// 模拟 v1.0.0 的 host：只有 /cc/settings.json、响应里没有 gate 字段
const oldServer = http.createServer((req, res) => {
  const pathname = (req.url || '').split('?')[0]
  if (pathname !== '/cc/settings.json') { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); return }
  const body = JSON.stringify({
    settings: { enabled: true, triggerPct: 30, retainPct: 4, auto: true },
    windowTokens: 1000000, triggerTokens: 300000, retainTokens: 40000, applied: true,
  })
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
})
await new Promise((r) => oldServer.listen(0, '127.0.0.1', r))
base = 'http://127.0.0.1:' + oldServer.address().port
c = await bootClient('e' + Date.now())
pageHtml = render(c.page)
chipHtml = render(c.chip)
parts = chipParts(chipHtml)
ok('守则卡明确说未装载需重启', pageHtml.includes('会话守则未装载'))
ok('门禁开关被禁用（防旧版抹字段）', disabled(pageHtml, L_GATE) === true)
ok('外观开关也被禁用（旧 host 不认识 pinLastUser/clearBubble）',
  disabled(pageHtml, L_PIN) === true && disabled(pageHtml, L_CLEAR) === true)
ok('气泡置顶卡说明"写盘会被旧版抹掉，请重启"', pageHtml.includes('写盘会被旧版抹掉'))
ok('未装载时不显示钉住自检行', !pageHtml.includes('钉住位置自检'))
ok('压缩开关不被连带禁用', disabled(pageHtml, L_CACHE) === false)
ok('chip 提问徽标显示弱化态而非假装开', parts.badges[1].state === '关' && parts.badges[1].dim === true,
  JSON.stringify(parts.badges[1]))
ok('全程无 React 警告（含列表 key）', warnings.length === 0, warnings.length ? warnings[0].slice(0, 80) : '')
oldServer.close()

console.log('\n— G. 展开的面板必须 portal 到 body（不然被输入卡片裁掉）—')
// D 段把主 host 关掉了，这里重新起一个同路由的监听（routes 表还在）。
const gServer = http.createServer((req, res) => {
  const handler = routes.get((req.url || '').split('?')[0])
  if (!handler) { res.writeHead(404); res.end('{}'); return }
  handler(req, res)
})
await new Promise((r) => gServer.listen(0, '127.0.0.1', r))
base = 'http://127.0.0.1:' + gServer.address().port
fs.writeFileSync(settingsFile, JSON.stringify({ enabled: true, triggerPct: 30, retainPct: 4, auto: true, gateEnabled: true, shapeEnabled: false, pinLastUser: false, clearBubble: false }))
c = await bootClient('g' + Date.now())
const bodyStub = globalThis.document.body
ok('收起时不往 body 挂任何节点', portalTargets.length === 0, 'calls=' + portalTargets.length)
// 展开态用 internals.setForceOpen 测试缝（按 hook 次序猜 open 太脆，改代码就假失败）
c.ex.internals.setForceOpen(true)
let opened = render(c.chip)
c.ex.internals.setForceOpen(false)
const panelTag = (opened.match(/<div class="cc-panel"[^>]*>/) || [''])[0]
ok('展开时面板被 portal 到 document.body',
  portalTargets.length === 1 && portalTargets[0] === bodyStub, 'targets=' + portalTargets.length)
ok('面板含标题与各分区（正文没被裁掉的等价证据；分区名同样已缩短）',
  panelTag !== '' && opened.includes('会话策略') && opened.includes('省缓存') && opened.includes('会话守则')
  && opened.includes('ponytail') && opened.includes('输出形状'))
ok('面板带 data-cache-control-panel 便于对账', panelTag.includes('data-cache-control-panel="1"'))
ok('面板用 bottom 定位（往 chip 上方开，不开到屏幕外）',
  /left:\d+px/.test(panelTag) && /bottom:\d+px/.test(panelTag) && !/;top:\d+px/.test(panelTag), panelTag.slice(0, 120))
ok('展开态下 chip 四段仍在（开关交互没被面板取代）',
  CHIP_LABELS.every((l) => opened.includes(l)) && chipParts(opened).divs === 3, 'divs=' + chipParts(opened).divs)
ok('展开渲染无 React 警告', warnings.length === 0, warnings[0] ? warnings[0].slice(0, 90) : '')

console.log('\n— H. 本轮四项改动（名称长度 / 底衬形态 / 徽标无背景 / 对话页搬过来了）—')
const ALLCSS = injectedCss.join('\n')
const clientSrc = fs.readFileSync(PLUGIN + 'client.js', 'utf8')
// ① 设置页名称：导航条目与分区标题都要 2–4 字。
//    先写一份"新 host 全字段 + 对话页宽度开着"的盘，对话页卡里的滑杆才会渲染出来。
fs.writeFileSync(settingsFile, JSON.stringify({
  enabled: true, triggerPct: 30, retainPct: 4, auto: true, gateEnabled: true,
  shapeEnabled: true, pinLastUser: true, clearBubble: true, pinBlur: 12, chatWidth: 90, chatWidthEnabled: true,
}))
c = await bootClient('h' + Date.now())
const navLabel = c.pageEntry ? String(c.pageEntry.label) : ''
const pageH3Raw = (render(c.page).match(/<h3[^>]*>([^<]*)<\/h3>/g) || []).map((s) => s.replace(/<[^>]+>/g, ''))
const h3s = pageH3Raw.slice()
ok('导航条目名 ≤4 字', navLabel.length > 0 && navLabel.length <= 4, navLabel + ' (' + navLabel.length + ')')
ok('分区标题都 ≤4 字', h3s.length >= 9 && h3s.filter((x) => x !== 'ponytail').every((x) => x.length <= 4), JSON.stringify(h3s))
// v1.11.1：**标题一律不带序号**。编号是位置属性，插一张卡就得把全部下游引用重排一遍 ——
// v1.10.2（ponytail 曾写作 "②b" ⇒ 页面上出现两个 ②）与 v1.11.0（插入自动审查令后面全部顺延）
// 已经为此返工两次。这条断言就是防止以后又有人往标题里加圈符或字母后缀。
ok('分区标题里没有圈符编号（含总述/关于本页那两处文案）',
  !/[①②③④⑤⑥⑦⑧⑨]/.test(pageH3Raw.join('|') + render(c.page).replace(/<[^>]+>/g, '')),
  pageH3Raw.join('|'))
ok('八个分区名字齐全且顺序正确（顺序即页面顺序，不靠编号表达）',
  ['省缓存', '会话守则', 'ponytail', '输出形状', '自动审查', '气泡置顶', '对话页', '存储']
    .every((nm, i) => pageH3Raw.indexOf(nm) === i + 1), JSON.stringify(pageH3Raw))
// v1.12.0：输出形状卡——并入自 dsh-output-shape 的那一段必须在页面上看得见、能改、说清归属。
const shapePageExp = expanded(c)
ok('输出形状卡在（开关已勾选 + 规则体积与行数）',
  /cc-h">输出形状/.test(render(c.page)) && checked(render(c.page), L_SHAPE) === true
  && /·\s\d+\s行/.test(shapePageExp),
  'has=' + /cc-h">输出形状/.test(render(c.page)))
ok('输出形状卡写明并入来源与段名（不会有人再去找已下线的插件）',
  shapePageExp.includes('dsh-output-shape') && shapePageExp.includes('dsh-cache-control:shape-gate')
  && shapePageExp.includes('R4'))
ok('输出形状卡给出两条路径（内置 / 自定义副本）',
  shapePageExp.includes('shape-gate.md') && shapePageExp.includes('shape.md'))
// ② 钉顶底衬：从"整行铺毛玻璃"改成"定长圆角矩形画在 ::before 上"，模糊度走 CSS 变量
const pinRule = (ALLCSS.match(/html\[data-cc-pin-last-user="1"\] \[data-cc-pin="1"\]\{[^}]*\}/) || [''])[0]
const plateRule = (ALLCSS.match(/html\[data-cc-pin-last-user="1"\] \[data-cc-pin="1"\]::before\{[^}]*\}/) || [''])[0]
ok('被钉行自身只留 sticky（不再铺背景/模糊）',
  /position:sticky/.test(pinRule) && !/background/.test(pinRule) && !/backdrop-filter/.test(pinRule), pinRule.slice(0, 120))
ok('底衬画在 ::before 上', plateRule.includes('::before') && /content:""/.test(plateRule), plateRule.slice(0, 60))
ok('底衬定长（按会话列宽 ×.55 与 em 上限折算，不写死像素）',
  // v1.4.2 起宽度是 `var(--cc-pin-w, calc(min(…)))`：JS 量到实测宽就写 --cc-pin-w，
  // 量不到才落到括号里的 calc 兜底。断言随之更新 —— 原来只认 `width:calc(min(`，
  // 那层 var 一加进来它就一直假失败（早于 v1.5.0 的单位改动，与本轮无关）。
  plateRule.includes('--dsh-chat-content-width') && plateRule.includes('* .55')
  && /width:var\(--cc-pin-w,\s*calc\(min\(/.test(plateRule) && plateRule.includes('var(--cc-user-bubble-max,41em)')
  && plateRule.includes('max-width:calc(100% + .8em)'),
  plateRule.slice(0, 190))
ok('底衬圆角/呼吸位是 em（跟随字号缩放）', /border-radius:1\.07em/.test(plateRule) && /right:-\.4em/.test(plateRule), plateRule.slice(0, 120))
// #3 要求：微调数值不再钉死像素 ⇒ 逐条守：气泡内边距/圆角/图标尺寸/轨道宽/chip 徽标都走 em 或变量
ok('提问气泡尺寸一律 em/变量（没有写死的 px 微调）',
  /_bubble"\]\{display:block !important;padding:\.47em \.8em !important;border-radius:1\.45em/.test(ALLCSS)
  && /width:calc\(1\.5em \+ var\(--dsh-content-font-delta,0px\)\)/.test(ALLCSS)
  && /padding-right:var\(--cc-tail-room,2\.4em\)/.test(ALLCSS)
  && /\.cc-chip \.cc-segLabel\{position:relative;top:\.017em\}/.test(ALLCSS)
  && /\.cc-chip \.cc-badge\{height:1\.13em/.test(ALLCSS), (ALLCSS.match(/(\.47em|1\.45em|2\.4em|\.017em|1\.13em)/g) || []).join(','))
ok('气泡上限用 em 常量（USER_BUBBLE_MAX_EM，随字号缩放）',
  /var\(--cc-user-bubble-max,41em\)/.test(ALLCSS) && /--cc-user-bubble-max', USER_BUBBLE_MAX_EM \+ 'em'/.test(clientSrc), '')
ok('模糊度走可调变量 --cc-pin-blur（默认 10px）',
  plateRule.includes('blur(var(--cc-pin-blur,10px)') && (ALLCSS.match(/--cc-pin-blur/g) || []).length >= 2,
  (ALLCSS.match(/backdrop-filter:[^;]*;/g) || []).join(' '))
ok('外观卡里有模糊度滑杆 0–24', (() => {
  const html2 = render(c.page)
  return /min="0"/.test(html2) && /max="24"/.test(html2) && html2.includes('钉顶底衬模糊度')
})())
// ③ chip 里的「开 / 关」徽标：纯透明，不留背景参与
// 注意：`\.cc-badge\{` 这种写法在整段 CSS 里做子串搜索时，会把 `.cc-chip .cc-badge{…}`
// 也算成"基础规则带背景"，于是"基础规则没被误改"这条永远判不过 ⇒ 必须逐行看行首。
const baseBadgeRules = ALLCSS.split('\n').filter((l) => /^\s*\.cc-badge[^-a-z]/.test(l))
ok('chip 内徽标无背景（面板里的同名徽标不受影响）',
  /\.cc-chip \.cc-badge\{background:transparent/.test(ALLCSS)
  && /\.cc-chip \.cc-badge\.on\{background:transparent/.test(ALLCSS)
  && /\.cc-chip \.cc-badge\.dim\{background:transparent/.test(ALLCSS)
  && baseBadgeRules.length > 0 && !baseBadgeRules.some((l) => /background:transparent/.test(l)),
  '基础规则 ' + baseBadgeRules.length + ' 条：' + baseBadgeRules.join(' ').slice(0, 90))
// 对话页固定宽度：整节已从底图工坊移进本插件，那边不再碰这三个变量
const pageHtml4 = render(c.page)
ok('设置页出现「对话页」卡（开关 + 30–100% 滑杆 + 常用百分比快捷键）',
  /cc-h">对话页/.test(pageHtml4) && /min="30"/.test(pageHtml4) && /max="100"/.test(pageHtml4)
  && pageHtml4.includes('90%') && pageHtml4.includes('启用固定对话页宽度'),
  'has=' + /cc-h">对话页/.test(pageHtml4))
// 对面插件(dsh-bg-atelier)的交叉断言：装了才判，没装就跳过（开源仓库不能硬依赖别人的路径）。
const bgaPath = process.env.DSH_BGA_CLIENT || 'D:/DeepSeek/dsh-plugins/dsh-desktop-wallpaper/client.js'
if (fs.existsSync(bgaPath)) {
  const bgaSrc = fs.readFileSync(bgaPath, 'utf8')
  // 那边源码里还留了"这块搬走了"的注释（是文档，不是代码），所以先把注释剥掉再判。
  const bgaCode = bgaSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/[^:]\/\/.*$/gm, '')
  ok('底图工坊那边已删净：无「对话页」小节、无 pinChatWidth、不再写 --dsh-chat-user-width、无 chatWidth 字段',
    !/Section\('对话页'/.test(bgaCode) && !/pinChatWidth/.test(bgaCode)
    && !/--dsh-chat-user-width/.test(bgaCode) && !/chatWidth/.test(bgaCode),
    '残留: ' + (bgaCode.match(/.{0,40}chatWidth.{0,40}/g) || []).slice(0, 2).join(' ⏎ '))
  ok('底图工坊设置页里仍留一句去处说明', bgaSrc.includes('会话策略'))
} else {
  console.log('  SKIP  底图工坊交叉断言（未找到 ' + bgaPath + '，可用 DSH_BGA_CLIENT 指定）')
}

ok('提问气泡图标区里的宿主 tooltip 被隐藏（"复制"不再飘远处）',
  /\[class\*="_userRow"\] \[class\*="_actions"\] \[role="tooltip"\]\{display:none/.test(ALLCSS),
  (ALLCSS.match(/\[role="tooltip"\][^\n]{0,60}/g) || []).join(' ⏎ ').slice(0, 120))

console.log('\n— E2. 规则被截断时界面必须说清"原多少 → 保留多少"—')
// 缺陷（另一轮只读审计发现）：host 侧"是否截断"原来是 `bytes >= 上限` 猜的，
// 而截断后长度必然小于上限 ⇒ 规则被砍了界面却显示未截断。修法见 index.js 的 truncateBytes：
// 截断函数直接返回 truncated/originalBytes/keptBytes，界面读标记、并把两个字节数摆出来。
// 这里走完整链路：磁盘上的超长 gate.md → host 路由 → STORE → 渲染出的 HTML。
const gateMd = pathMod.join(ROOT, 'dsh-cache-control', 'gate.md')
// 样本与期望值一律**相对 host 的上限生成**（同 verify-gate-truncation 的口径）：
// 写死 19998/5839/6144 是"6 KB 年代"的数字，GATE_MAX_BYTES 放宽到 16 KB 后它们全是错的。
const LONG_RULE = '规'.repeat(6666)          // 19,998 B > 上限 ⇒ 必然触发截断
fs.writeFileSync(gateMd, LONG_RULE, 'utf8')
const cLong = await bootClient('trunc' + Date.now())
const longHtml = render(cLong.page)
const gLong = (await (await nodeFetch(base + '/cc/gate.json', { cache: 'no-store' })).json()).gate
ok('超长规则 ⇒ 界面标出"已截断：原 N B → 保留 M B"（数字来自 host，且确实被砍）',
  gLong.truncated === true && gLong.keptBytes < gLong.maxBytes && gLong.originalBytes > gLong.maxBytes
  && longHtml.includes('已截断：原 ' + gLong.originalBytes + ' B → 保留 ' + gLong.keptBytes + ' B'),
  (longHtml.match(/已截断[^<]*/) || [''])[0])
ok('超长规则 ⇒ 有一句看得懂的话：你的规则被截断了 + 原文/实际注入/上限三个字节数',
  longHtml.includes('你的规则被截断了') && longHtml.includes('原文 ' + gLong.originalBytes + ' 字节')
  && longHtml.includes('实际注入 ' + gLong.keptBytes + ' 字节') && longHtml.includes('上限 ' + gLong.maxBytes + ' 字节'),
  (longHtml.match(/你的规则被截断了[^<]*/) || [''])[0].slice(0, 120))
ok('这句提示用警示色类（cc-warn），不是悄悄混在别的文字里',
  /<p class="cc-warn">你的规则被截断了/.test(longHtml))
ok('界面上的数字来自 host 响应而不是前端自己再算一遍（与前一条 GET 的 gate 字段一致）',
  await (async () => {
    const r = await nodeFetch(base + '/cc/gate.json', { cache: 'no-store' })
    const g = (await r.json()).gate
    return g.truncated === true && longHtml.includes('保留 ' + g.keptBytes + ' B')
      && longHtml.includes('原文 ' + g.originalBytes + ' 字节')
  })())
// 反向：没被截断的规则不许出现截断字样（防止标记恒真）
fs.writeFileSync(gateMd, '# 短规则\n只有一行。', 'utf8')
const cShort = await bootClient('short' + Date.now())
const shortHtml = render(cShort.page)
ok('未截断的规则不出现任何截断字样（标记不是恒真的装饰）',
  !shortHtml.includes('已截断') && !shortHtml.includes('你的规则被截断了'), '')
fs.rmSync(gateMd, { force: true })

// 反向兼容：新 client × **旧 host**（v1.6.1 及以前：有 truncated 但它靠长度猜的，
// 且没有 originalBytes/keptBytes）。界面不许因此显示 NaN 或崩掉 —— 长度字段退化成 bytes。
const oldGateServer = http.createServer((req, res) => {
  const p = (req.url || '').split('?')[0]
  if (p !== '/cc/settings.json') { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); return }
  const body = JSON.stringify({
    settings: { enabled: true, triggerPct: 30, retainPct: 4, auto: true, gateEnabled: true },
    applied: true, hasBackup: false,
    gate: { enabled: true, source: 'override', builtinPath: 'b.md', overridePath: 'g.md',
      bytes: 5839, maxBytes: 6144, lines: 3, truncated: true, text: '规则…省略]' },
  })
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
})
await new Promise((r) => oldGateServer.listen(0, '127.0.0.1', r))
base = 'http://127.0.0.1:' + oldGateServer.address().port
const cOldHost = await bootClient('oldgate' + Date.now())
const oldHostHtml = render(cOldHost.page)
ok('旧 host（无 originalBytes/keptBytes）⇒ 界面不出现 NaN，退化成 bytes 显示',
  !oldHostHtml.includes('NaN') && oldHostHtml.includes('已截断：原 5839 B → 保留 5839 B'),
  (oldHostHtml.match(/已截断[^<]*/) || [''])[0])
oldGateServer.closeAllConnections?.()
await new Promise((r) => oldGateServer.close(r))

console.log('\n— F. 收尾 —')
gServer.close()
if (haveRealHome) {
  const realSettingsNow = fs.readFileSync(pathMod.join(REAL_HOME, 'settings.json'), 'utf8')
  ok('用户真实 settings.json 全程未被本测试改动', realSettingsNow === realSettingsBefore, realSettingsNow.trim().replace(/\s+/g, ' ').slice(0, 120))
  ok('用户真实 gate.md 状态未变', fs.existsSync(pathMod.join(REAL_HOME, 'gate.md')) === hadRealGateMd)
} else {
  console.log('  SKIP  真实 home（%APPDATA%/dsh-desktop/harness）不存在 ⇒ 本机未装 DSH，跳过"真实文件未被改动"两条')
}
fs.rmSync(ROOT, { recursive: true, force: true })
delete globalThis.window
delete globalThis.document
console.error = origError
console.log('\n' + pass + ' passed, ' + fail + ' failed\n')
process.exitCode = fail === 0 ? 0 : 1
