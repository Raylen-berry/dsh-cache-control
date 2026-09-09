// 客户端半的渲染验证：真 React + react-dom/server，把 client.js 当浏览器那样
// 通过 __ModuleLoader__ 装载，fetch 指向本脚本用 host 半真跑起来的 http 服务。
// 证明：磁盘设置 → 路由 → STORE → DOM；两个开关互不牵连；chip 版式＝两段标签+徽标+竖线。
const PLUGIN = process.env.DSH_CC_PLUGIN || 'D:/DeepSeek/dsh-plugins/dsh-cache-control/';
const APP = process.env.DSH_APP_MODULES || 'D:/deepseek-harness/DSH Desktop/resources/app/node_modules/';
const ROOT = process.env.DSH_TOOL_HOME || 'D:/DeepSeek/03-调试临时/gate-client-e2e-home';
const fs = await import('node:fs')
const pathMod = await import('node:path')
const http = await import('node:http')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')) }
}

// ---- 临时 DSH_HOME，含一份 preset 副本，绝不写用户真实文件 ----
fs.rmSync(ROOT, { recursive: true, force: true })
const presetDir = pathMod.join(ROOT, 'profiles/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard')
fs.mkdirSync(presetDir, { recursive: true })
fs.mkdirSync(pathMod.join(ROOT, 'dsh-cache-control'), { recursive: true })
fs.copyFileSync(process.env.APPDATA + '/dsh-desktop/harness/profiles/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml',
  pathMod.join(presetDir, 'agent.cordis.yml'))
process.env.DSH_HOME = ROOT
const settingsFile = pathMod.join(ROOT, 'dsh-cache-control', 'settings.json')
// 用户真实设置的当前快照，收尾比对（本测试只该动临时目录）
const REAL_HOME = process.env.APPDATA + '/dsh-desktop/harness/dsh-cache-control'
const realSettingsBefore = fs.readFileSync(pathMod.join(REAL_HOME, 'settings.json'), 'utf8')
const hadRealGateMd = fs.existsSync(pathMod.join(REAL_HOME, 'gate.md'))

const unwrap = (m) => (m && m.default && (m.default.createElement || m.default.renderToStaticMarkup)) ? m.default : m
const host = await import('file:///' + PLUGIN + 'index.js')
const React = unwrap(await import('file:///' + APP + 'react/index.js'))
const ReactDOMServer = unwrap(await import('file:///' + APP + 'react-dom/server.js'))
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
const checkedCount = (html) => (html.match(/checked=""/g) || []).length
/** chip 版式解析：两段「标签 + 开/关徽标」+ 一根竖线 */
function chipParts(html) {
  const labels = [...html.matchAll(/class="cc-segLabel"[^>]*>([^<]*)</g)].map((m) => m[1])
  const badges = [...html.matchAll(/<span class="cc-badge([^"]*)">([^<]*)<\/span>/g)]
    .map((m) => ({ state: m[2], on: /\bon\b/.test(m[1]), dim: /\bdim\b/.test(m[1]) }))
  const divs = (html.match(/class="cc-div"/g) || []).length
  return { labels, badges, divs }
}
/** 按 label 文本精确取回它前面那个 checkbox 的属性串（判勾选/禁用）。 */
function inputAttrsFor(html, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp('<input([^>]*)><span>' + esc).exec(html)
  return m ? m[1] : null
}
const checked = (html, label) => {
  const a = inputAttrsFor(html, label)
  return a === null ? null : /checked=""/.test(a)
}
const disabled = (html, label) => {
  const a = inputAttrsFor(html, label)
  return a === null ? null : /disabled=""/.test(a)
}
const L_CACHE = '启用压缩策略（作用于之后新建的标准模式会话）'
const L_AUTO = '自动压缩（关闭 = 仅保留手动 /compact）'
const L_GATE = '启用会话守则（下一个请求即生效，含已打开的会话）'
const L_PIN = '把最近一条「我的提问」钉在会话区顶部'
const L_CLEAR = '我的气泡背景透明（露出壁纸）'

console.log('\n— A. 关缓存 / 开门禁 —')
fs.writeFileSync(settingsFile, JSON.stringify({ enabled: false, triggerPct: 30, retainPct: 4, auto: true, gateEnabled: true }))
let c = await bootClient('a' + Date.now())
let pageHtml = render(c.page)
const pageExp = expanded(c)
let chipHtml = render(c.chip)
let parts = chipParts(chipHtml)
ok('设置页渲染成功', pageHtml.length > 500, pageHtml.length + ' chars')
ok('两块卡都在（名称已压到 2–4 字）', pageHtml.includes('① 省缓存') && pageHtml.includes('② 会话守则'),
  'h3=' + (pageHtml.match(/<h3[^>]*>([^<]*)<\/h3>/g) || []).join(' '))
ok('门禁卡显示规则体积与行数', /\d+(\.\d+)?\s(B|KB)\s·\s\d+\s行/.test(pageHtml), (pageHtml.match(/\d+(\.\d+)?\s(B|KB)\s·\s\d+\s行/) || [''])[0])
ok('门禁卡列出内置规则路径（展开说明可见）', pageExp.includes('session-gate.md'))
ok('说明默认收进抽屉：总述与各卡长说明正文不在默认页面上',
  !pageHtml.includes('四块互相独立的开关') && !pageHtml.includes('出厂默认（压力达窗口 80% 压缩')
  && !pageHtml.includes('不产生技术硬拦截') && !pageHtml.includes('三项都是纯界面开关'))
ok('展开后说明正文可见', pageExp.includes('不产生技术硬拦截') && pageExp.includes('三项都是纯界面开关'))
ok('门禁开关已勾选', checked(pageHtml, L_GATE) === true)
ok('压缩开关未勾选（互不牵连）', checked(pageHtml, L_CACHE) === false)
ok('自动压缩仍按设置勾选', checked(pageHtml, L_AUTO) === true)
ok('chip 两段标签为 省缓存 / 提问', parts.labels.join(',') === '省缓存,提问', parts.labels.join(','))
ok('chip 徽标：关 与 开', parts.badges.length === 2 && parts.badges[0].state === '关' && parts.badges[1].state === '开',
  JSON.stringify(parts.badges.map((b) => b.state)))
ok('徽标高亮态与开关一致（第一段不亮、第二段亮）', parts.badges[0].on === false && parts.badges[1].on === true)
ok('chip 中间一根竖线', parts.divs === 1, 'divs=' + parts.divs)
ok('chip 是三个按钮（两段可点 + ▾）', (chipHtml.match(/<button/g) || []).length === 3,
  'buttons=' + (chipHtml.match(/<button/g) || []).length)
ok('每段各有 hover 介绍（title）', (chipHtml.match(/title="/g) || []).length === 3,
  'titles=' + (chipHtml.match(/title="/g) || []).length)
ok('介绍里写清了"点这一段=直接开/关"与生效范围',
  chipHtml.includes('点这一段 = 直接开/关') && chipHtml.includes('只影响之后新建的') && chipHtml.includes('下一个请求'))
ok('▾ 带 aria-expanded（未展开为 false）', /aria-expanded="false"/.test(chipHtml))
ok('容器是 span 不是 button（避免 button 套 button）', /<span class="cc-chip/.test(chipHtml))
ok('③ 气泡置顶卡存在（含可调模糊度滑杆）', pageHtml.includes('③ 气泡置顶') && pageHtml.includes('钉顶底衬模糊度'),
  'h3=' + (pageHtml.match(/<h3[^>]*>([^<]*)<\/h3>/g) || []).join(' '))
ok('外观两开关可用且默认关（新 host 会带回这两个字段）',
  checked(pageHtml, L_PIN) === false && checked(pageHtml, L_CLEAR) === false && disabled(pageHtml, L_PIN) === false)
ok('关着时不显示自检行', !pageHtml.includes('钉住位置自检'))

console.log('\n— B. 开缓存 / 关门禁 —')
fs.writeFileSync(settingsFile, JSON.stringify({ enabled: true, triggerPct: 30, retainPct: 4, auto: false, gateEnabled: false }))
c = await bootClient('b' + Date.now())
chipHtml = render(c.chip)
pageHtml = render(c.page)
const pageExpB = expanded(c)
parts = chipParts(chipHtml)
ok('chip 徽标翻成 开 / 关', parts.badges[0].state === '开' && parts.badges[1].state === '关',
  JSON.stringify(parts.badges.map((b) => b.state)))
ok('标签不随状态改名（版式稳定）', parts.labels.join(',') === '省缓存,提问')
ok('压缩已勾选、门禁未勾选', checked(pageHtml, L_CACHE) === true && checked(pageHtml, L_GATE) === false)
ok('自动压缩子开关独立关着', checked(pageHtml, L_AUTO) === false)
ok('门禁卡仍列出三条规则摘要（展开说明可见）',
  pageExpB.includes('R1') && pageExpB.includes('R2') && pageExpB.includes('R3'))
ok('门禁卡有编辑/重读按钮', pageHtml.includes('编辑规则') && pageHtml.includes('重新读取'))
ok('门禁声明了"约束而非硬拦截"（展开说明可见）', pageExpB.includes('不产生技术硬拦截'))

console.log('\n— C. 全开（压缩 + 门禁 + 外观两项）—')
fs.writeFileSync(settingsFile, JSON.stringify({ enabled: true, triggerPct: 25, retainPct: 5, auto: true, gateEnabled: true, pinLastUser: true, clearBubble: true }))
c = await bootClient('c' + Date.now())
chipHtml = render(c.chip)
pageHtml = render(c.page)
const pageExpC = expanded(c)
parts = chipParts(chipHtml)
ok('chip 两个徽标都亮', parts.badges.length === 2 && parts.badges.every((b) => b.state === '开' && b.on === true))
ok('五个勾选框全勾（压缩 + 自动压缩 + 门禁 + 钉顶 + 透明）', checkedCount(pageHtml) === 5, 'checked=' + checkedCount(pageHtml))
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
fs.writeFileSync(settingsFile, JSON.stringify({ enabled: true, triggerPct: 30, retainPct: 4, auto: true, gateEnabled: true, pinLastUser: false, clearBubble: false }))
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
ok('面板含标题与两个分区（正文没被裁掉的等价证据；分区名同样已缩短）',
  panelTag !== '' && opened.includes('会话策略') && opened.includes('① 省缓存') && opened.includes('② 会话守则'))
ok('面板带 data-cache-control-panel 便于对账', panelTag.includes('data-cache-control-panel="1"'))
ok('面板用 bottom 定位（往 chip 上方开，不开到屏幕外）',
  /left:\d+px/.test(panelTag) && /bottom:\d+px/.test(panelTag) && !/;top:\d+px/.test(panelTag), panelTag.slice(0, 120))
ok('展开态下 chip 三段仍在（开关交互没被面板取代）',
  opened.includes('省缓存') && opened.includes('提问') && chipParts(opened).divs === 1)
ok('展开渲染无 React 警告', warnings.length === 0, warnings[0] ? warnings[0].slice(0, 90) : '')

console.log('\n— H. 本轮四项改动（名称长度 / 底衬形态 / 徽标无背景 / 对话页搬过来了）—')
const ALLCSS = injectedCss.join('\n')
const clientSrc = fs.readFileSync(PLUGIN + 'client.js', 'utf8')
// ① 设置页名称：导航条目与四个分区标题都要 2–4 字（编号圈符不算名字的一部分）
//    先写一份"新 host 全字段 + 对话页宽度开着"的盘，④ 卡里的滑杆才会渲染出来。
fs.writeFileSync(settingsFile, JSON.stringify({
  enabled: true, triggerPct: 30, retainPct: 4, auto: true, gateEnabled: true,
  pinLastUser: true, clearBubble: true, pinBlur: 12, chatWidth: 1920, chatWidthEnabled: true,
}))
c = await bootClient('h' + Date.now())
const navLabel = c.pageEntry ? String(c.pageEntry.label) : ''
const h3s = (render(c.page).match(/<h3[^>]*>([^<]*)<\/h3>/g) || [])
  .map((s) => s.replace(/<[^>]+>/g, '').replace(/^[①②③④]\s*/, ''))
ok('导航条目名 ≤4 字', navLabel.length > 0 && navLabel.length <= 4, navLabel + ' (' + navLabel.length + ')')
ok('四个分区标题都 ≤4 字', h3s.length >= 4 && h3s.every((x) => x.length <= 4), JSON.stringify(h3s))
// ② 钉顶底衬：从"整行铺毛玻璃"改成"定长圆角矩形画在 ::before 上"，模糊度走 CSS 变量
const pinRule = (ALLCSS.match(/html\[data-cc-pin-last-user="1"\] \[data-cc-pin="1"\]\{[^}]*\}/) || [''])[0]
const plateRule = (ALLCSS.match(/html\[data-cc-pin-last-user="1"\] \[data-cc-pin="1"\]::before\{[^}]*\}/) || [''])[0]
ok('被钉行自身只留 sticky（不再铺背景/模糊）',
  /position:sticky/.test(pinRule) && !/background/.test(pinRule) && !/backdrop-filter/.test(pinRule), pinRule.slice(0, 120))
ok('底衬画在 ::before 上', plateRule.includes('::before') && /content:""/.test(plateRule), plateRule.slice(0, 60))
ok('底衬定长（按会话列宽 ×.55 与 em 上限折算，不写死像素）',
  plateRule.includes('--dsh-chat-content-width') && plateRule.includes('* .55')
  && /width:calc\(min\(/.test(plateRule) && plateRule.includes('var(--cc-user-bubble-max,41em)')
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
// ④ 对话页固定宽度：整节已从底图工坊移进本插件，那边不再碰这三个变量
const pageHtml4 = render(c.page)
ok('设置页出现「④ 对话页」卡（开关 + 640–3840 滑杆 + 常用宽度快捷键）',
  pageHtml4.includes('④ 对话页') && /min="640"/.test(pageHtml4) && /max="3840"/.test(pageHtml4)
  && pageHtml4.includes('1920') && pageHtml4.includes('启用固定对话页宽度'),
  'has=' + pageHtml4.includes('④ 对话页'))
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

console.log('\n— F. 收尾 —')
gServer.close()
const realSettingsNow = fs.readFileSync(pathMod.join(REAL_HOME, 'settings.json'), 'utf8')
ok('用户真实 settings.json 全程未被本测试改动', realSettingsNow === realSettingsBefore, realSettingsNow.trim().replace(/\s+/g, ' '))
ok('用户真实 gate.md 状态未变', fs.existsSync(pathMod.join(REAL_HOME, 'gate.md')) === hadRealGateMd)
fs.rmSync(ROOT, { recursive: true, force: true })
delete globalThis.window
delete globalThis.document
console.error = origError
console.log('\n' + pass + ' passed, ' + fail + ' failed\n')
process.exitCode = fail === 0 ? 0 : 1
