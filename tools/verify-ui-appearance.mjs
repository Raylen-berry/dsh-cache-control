// 验证 ③ 会话区外观 + chip 点击语义。
// 没有 jsdom，所以按真实结构手搓一棵树来验 pinTarget 的爬升判断：
//   [data-conversation-scroll] > column > flowItem > .userRow > .userStack > .bubble
// 关键：sticky 的移动量 = 父高 − 自身高；.userRow 的父级 .userStack 等高 ⇒ 必须往上爬
// 到 flowItem（它的父级 column 有剩余高度）才算钉对。
const PLUGIN = process.env.DSH_CC_PLUGIN || 'D:/DeepSeek/dsh-plugins/dsh-cache-control/';
const APP = process.env.DSH_APP_MODULES || 'D:/deepseek-harness/DSH Desktop/resources/app/node_modules/';
const ROOT = process.env.DSH_TOOL_HOME || 'D:/DeepSeek/03-调试临时/ui-appearance-home';
const fs = await import('node:fs')
const pathMod = await import('node:path')
const http = await import('node:http')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')) }
}

// ---- 临时 DSH_HOME + 真 host 半（chip 点击会经 PUT 写盘，必须落在临时目录）----
fs.rmSync(ROOT, { recursive: true, force: true })
const presetDir = pathMod.join(ROOT, 'profiles/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard')
fs.mkdirSync(presetDir, { recursive: true })
fs.mkdirSync(pathMod.join(ROOT, 'dsh-cache-control'), { recursive: true })
fs.copyFileSync(process.env.APPDATA + '/dsh-desktop/harness/profiles/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml',
  pathMod.join(presetDir, 'agent.cordis.yml'))
process.env.DSH_HOME = ROOT
const settingsFile = pathMod.join(ROOT, 'dsh-cache-control', 'settings.json')
fs.writeFileSync(settingsFile, JSON.stringify({ enabled: true, triggerPct: 30, retainPct: 4, auto: true, gateEnabled: true, pinLastUser: false, clearBubble: false }))

const host = await import('file:///' + PLUGIN + 'index.js')
const unwrap = (m) => (m && m.default && m.default.createElement) ? m.default : m
const React = unwrap(await import('file:///' + APP + 'react/index.js'))

const routes = new Map()
const webServer = { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }
await host.apply({
  get: (n) => (n === 'webServer' ? webServer : undefined),
  effect: (fn) => fn(),
  inject: (deps, cb) => cb({ systemPrompt: { section: () => () => {} } }),
})
const server = http.createServer((req, res) => {
  const pathname = (req.url || '').split('?')[0]
  const h = routes.get(pathname)
  if (!h) { res.writeHead(404); res.end('{}'); return }
  h(req, res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port
const nodeFetch = globalThis.fetch
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const puts = []
const recordedFetch = (u, o) => {
  if (o && /PUT|POST/.test(String(o.method || ''))) { try { puts.push(JSON.parse(o.body)) } catch {} }
  return nodeFetch(base + String(u), o)
}

// ---- 手搓 DOM ----
const allNodes = []
/**
 * 真·style 替身：插件的外观/宽度引擎全靠 setProperty / getPropertyValue /
 * removeProperty 三件事（CSS 变量 + !important），空壳对象会让整条链路假成功，
 * 所以这里把三个方法都做出来，断言才有东西可查。
 */
function makeStyle() {
  const props = {}
  return {
    _p: props,
    setProperty: (k, v) => { props[k] = String(v) },
    removeProperty: (k) => { delete props[k] },
    getPropertyValue: (k) => (props[k] === undefined ? '' : props[k]),
  }
}
function node(tag, className, offsetHeight, attrs = {}) {
  const n = { tag, className, offsetHeight, attrs: { ...attrs }, removed: 0, parentElement: null, children: [], style: makeStyle() }
  n.setAttribute = (k, v) => { n.attrs[k] = v }
  n.removeAttribute = (k) => { delete n.attrs[k]; n.removed++ }
  n.closest = (sel) => {
    const key = sel.replace(/[[\]"]/g, '').replace('=', '')
    let p = n
    while (p) { if (p.attrs[key] !== undefined || (key === 'data-conversation-scroll' && p.attrs['data-conversation-scroll'] !== undefined)) return p; p = p.parentElement }
    return null
  }
  allNodes.push(n)
  return n
}
const html = node('html', '', 900)
const body = node('body', '', 900)
body.parentElement = html
html.children.push(body)
// 会话根：宿主 publishWidths 会在它身上内联 --dsh-conversation-column-width，
// 插件靠"往上找带这个内联变量的祖先"定位它；composer 卡也在它子树里。
const chatRoot = node('div', 'Sbj43W_root', 900)
chatRoot.parentElement = body
body.children.push(chatRoot)
chatRoot.style.setProperty('--dsh-conversation-column-width', '1400px')
const composerCard = node('div', 'composerCard', 120, { 'data-composer-card': '' })
composerCard.parentElement = chatRoot
chatRoot.children.push(composerCard)
const scroller = node('div', 'uSmzmW_scrollBody', 600, { 'data-conversation-scroll': '' })
scroller.parentElement = chatRoot
chatRoot.children.push(scroller)
const column = node('div', 'uSmzmW_column', 2000)
column.parentElement = scroller
scroller.children.push(column)

function buildTurn(rowHeight, isUser, label) {
  // 真实结构里 flowItem 就是"这一条消息"的高度，包不住额外空间；
  // 剩余高度出现在它的父级 column 上 —— 这正是 pinTarget 该爬到的那一层。
  const flowItem = node('div', 'uSmzmW_flowItem ' + label, rowHeight)
  flowItem.parentElement = column
  column.children.push(flowItem)
  const userRow = node('div', 'uSmzmW_userRow', rowHeight)
  userRow.parentElement = flowItem
  const userStack = node('div', 'uSmzmW_userStack', rowHeight)
  userStack.parentElement = userRow
  const bubble = node('div', 'uSmzmW_bubble', rowHeight - 8)
  bubble.parentElement = userStack
  return isUser ? userRow : flowItem
}
// 三条提问 + 一条回答（回答不是 userRow）
const row1 = buildTurn(60, true, 't1')
const row2 = buildTurn(60, true, 't2')
const answerFlow = node('div', 'uSmzmW_flowItem answer', 1200)
answerFlow.parentElement = column
column.children.push(answerFlow)
const row3 = buildTurn(60, true, 't3')   // 最近一条提问
column.offsetHeight = 60 + 60 + 1200 + 60

const userRows = [row1, row2, row3]
let captured = null
globalThis.window = { __ModuleLoader__: { load: (m) => { captured = m } }, innerWidth: 1400, innerHeight: 900 }
globalThis.document = {
  documentElement: html,
  body,
  createElement: () => ({ setAttribute() {}, textContent: '', type: '' }),
  head: { appendChild() {} },
  querySelector: (sel) => {
    if (sel.includes('data-conversation-scroll')) return scroller
    if (sel.includes('data-chat-flow')) return column
    if (sel.includes('data-composer-card')) return composerCard
    return null
  },
  querySelectorAll: (sel) => {
    if (sel.includes('_userRow')) return userRows.slice()
    if (sel.startsWith('[data-cc-pin')) return allNodes.filter((n) => n.attrs['data-cc-pin'] !== undefined)
    return []
  },
}
let observers = 0
globalThis.MutationObserver = class { constructor(cb) { this.cb = cb } observe() { observers++ } disconnect() { observers-- } takeRecords() { return [] } }
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
globalThis.fetch = recordedFetch

await import('file:///' + PLUGIN + 'client.js?ui' + Date.now())
if (!captured) throw new Error('client.js 未注册 factory')
const exportsObj = captured.factory((name) => { if (name === 'react') return React; throw new Error('bad require ' + name) })
const it = exportsObj.internals
ok('client 暴露了测试缝 internals', !!it && typeof it.flipCache === 'function', Object.keys(it || {}).join(','))
ok('domReady 认这棵树', it.domReady() === true)

console.log('\n— 1. pinTarget 两条路径都要钉到"每条消息"那一层 —')
// 路径 B（宿主属性不在）：按剩余高度爬升
let t3 = it.pinTarget(row3)
ok('回退路径：钉的是 flowItem（父级 column 有剩余高度）', t3 === row3.parentElement, t3.className)
ok('第一条提问同样钉到它自己的 flowItem', it.pinTarget(row1) === row1.parentElement, it.pinTarget(row1).className)
// 路径 A（宿主真实属性在）：closest('[data-chat-flow]') → 该容器的直接子元素
column.setAttribute('data-chat-flow', '')
row3.parentElement.setAttribute('data-chat-flow-key', 'turn-3')
t3 = it.pinTarget(row3)
ok('主路径：钉到 [data-chat-flow] 的直接子元素', t3 === row3.parentElement, t3.className)
ok('钉住的正是带 data-chat-flow-key 的那条消息', row3.parentElement.attrs['data-chat-flow-key'] === 'turn-3')
// 中间多塞一层等高透传包装，仍应爬到消息层
const deepItem = node('div', 'uSmzmW_flowItem deep', 60)
deepItem.parentElement = column
const deepWrap = node('div', 'wrap', 60)
deepWrap.parentElement = deepItem
const deepRow = node('div', 'uSmzmW_userRow', 60)
deepRow.parentElement = deepWrap
ok('多套一层透传包装也钉到消息层', it.pinTarget(deepRow) === deepItem, it.pinTarget(deepRow).className)

console.log('\n— 2. 开钉顶 + 透明 + 可调模糊度 —')
it.applyAppearance({ pinLastUser: true, clearBubble: true, pinBlur: 18, chatWidthEnabled: false, chatWidth: 90 })
await sleep(40)
ok('<html> 上打了 data-cc-pin-last-user', html.attrs['data-cc-pin-last-user'] === '1')
ok('<html> 上打了 data-cc-clear-bubble', html.attrs['data-cc-clear-bubble'] === '1')
ok('模糊度写成 <html> 上的 --cc-pin-blur（钉顶底衬读它）',
  html.style.getPropertyValue('--cc-pin-blur') === '18px', html.style.getPropertyValue('--cc-pin-blur'))
ok('挂了两条 MutationObserver（钉顶 + 宽度）或至少一条', observers >= 1, 'observers=' + observers)
const pinned = allNodes.filter((n) => n.attrs['data-cc-pin'] === '1')
ok('只有 1 个元素被钉（最近那条）', pinned.length === 1, pinned.map((n) => n.className).join(','))
ok('钉的是 t3 的 flowItem', pinned[0] === row3.parentElement)
ok('自检文案写明了钉住目标与提问数', /t3 · 共 3 条提问/.test(String(it.STORE.state.pinMarked)), String(it.STORE.state.pinMarked))

console.log('\n— 3. 新提问出现后钉住位置跟着走 —')
const row4 = buildTurn(60, true, 't4')
userRows.push(row4)
it.applyPin()
await sleep(20)
const pinned2 = allNodes.filter((n) => n.attrs['data-cc-pin'] === '1')
ok('仍然只钉一个', pinned2.length === 1, pinned2.map((n) => n.className).join(','))
ok('换成了最新那条 t4', pinned2[0] === row4.parentElement)

console.log('\n— 3.5 置顶跟着滚动换条（"分节标题"语义，用户要求）—')
// 手搓 DOM 补几何：rect.top = (文档内偏移 − 滚动容器自身偏移) − scrollTop
function docTop(n) {
  let y = 0; let c = n; let p = n.parentElement
  while (p) {
    const i = p.children.indexOf(c)
    for (let j = 0; j < i; j++) y += (p.children[j].offsetHeight || 0)
    c = p; p = p.parentElement
  }
  return y
}
const scroll = { y: 0 }
const SCROLLER_BASE = docTop(scroller)   // composer 卡在滚动区上面(120px)，必须减掉
for (const n of allNodes) {
  n.getBoundingClientRect = () => {
    const top = docTop(n) - SCROLLER_BASE - scroll.y
    return { top, bottom: top + (n.offsetHeight || 0), left: 0, right: 1000, width: 1000, height: n.offsetHeight || 0 }
  }
}
scroller.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 1000, width: 1000, height: 600 })
const flowItems = userRows.map((r) => r.parentElement)   // [t1, t2, t3, t4] 的 flowItem
const pinIdx = (y) => {
  scroll.y = y
  it.applyPin()
  const p = allNodes.filter((n) => n.attrs['data-cc-pin'] === '1')
  if (p.length === 0) return -1
  if (p.length > 1) return -2
  return flowItems.indexOf(p[0])
}
ok('滚到底 → 钉最近一条 t4', pinIdx(1380) === 3, 'idx=' + pinIdx(1380))
ok('停在 3/4 之间 → 钉 t3', pinIdx(1320) === 2)
ok('停在回答中段（2/3 之间）→ 钉 t2', pinIdx(1000) === 1)
ok('停在 1/2 之间 → 钉 t1', pinIdx(50) === 0)
ok('回到最顶 → 仍钉 t1（第一条已贴上沿）', pinIdx(0) === 0)
ok('任何滚动位置都只钉一条', pinIdx(1380) >= 0 && pinIdx(50) >= 0)

console.log('\n— 4. 关钉顶要清干净 —')
it.applyAppearance({ pinLastUser: false, clearBubble: true })
await sleep(20)
ok('data-cc-pin-last-user 已移除', html.attrs['data-cc-pin-last-user'] === undefined)
ok('透明开关仍在', html.attrs['data-cc-clear-bubble'] === '1')
ok('没有残留 data-cc-pin 标记', allNodes.filter((n) => n.attrs['data-cc-pin'] === '1').length === 0)
// 关钉顶后仍留着"气泡贴文字"那一条观察器（它是界面常态能力，不随钉顶开关撤走）
ok('钉顶观察器已撤，只剩气泡贴合这一条', observers === 1, 'observers=' + observers)
it.stopFitWatch()
ok('插件停用后观察器全部断开', observers === 0, 'observers=' + observers)
it.applyAppearance({ pinLastUser: false, clearBubble: false })
ok('两个都关时 <html> 上无残留', !Object.keys(html.attrs).some((k) => k.startsWith('data-cc-')), JSON.stringify(html.attrs))

console.log('\n— 5. chip 点段：点哪段切哪个（经真 PUT 落盘）—')
it.STORE.set({
  loading: false, loaded: true, error: '', applied: true,
  enabled: true, triggerPct: 30, retainPct: 4, auto: true,
  gateEnabled: true, gateReady: true, pinLastUser: false, clearBubble: false,
})
ok('未加载成功时点段是空操作（防默认值盖盘）', (() => {
  it.STORE.set({ loaded: false })
  const before = it.STORE.state.enabled
  puts.length = 0
  it.flipCache(); it.flipGate()
  const same = it.STORE.state.enabled === before && puts.length === 0
  it.STORE.set({ loaded: true })
  return same
})(), String(puts.length))
puts.length = 0
it.flipCache()
ok('点省缓存段 → enabled 变 false', it.STORE.state.enabled === false)
ok('点一下不动门禁', it.STORE.state.gateEnabled === true)
await sleep(500)
ok('PUT 发出去了且带全字段', puts.length >= 1, JSON.stringify(puts[puts.length - 1] || {}))
const disk1 = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
ok('磁盘上 enabled=false 而 gateEnabled 仍 true', disk1.enabled === false && disk1.gateEnabled === true, JSON.stringify(disk1))
ok('只点开关不会动滑杆数值', disk1.triggerPct === 30 && disk1.retainPct === 4, JSON.stringify(disk1))
ok('压缩关了不影响 preset 之外：managed 标记被移除', !fs.readFileSync(pathMod.join(presetDir, 'agent.cordis.yml'), 'utf8').includes('thresholdRatio'))
it.flipGate()
await sleep(500)
const disk2 = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
ok('点提问段 → 只翻转门禁', disk2.gateEnabled === false && disk2.enabled === false && disk2.triggerPct === 30, JSON.stringify(disk2))
ok('外观两字段被一起写盘且保持 false', disk2.pinLastUser === false && disk2.clearBubble === false)
it.STORE.set({ gateReady: false })
it.flipGate()
ok('未装载（旧 host）时点提问段不动它', it.STORE.state.gateEnabled === false)

console.log('\n— 6. 外观开关落盘 —')
it.STORE.set({ loading: false, gateReady: true })
it.setPinLastUser(true)
it.setClearBubble(true)
await sleep(600)
const disk3 = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
ok('pinLastUser / clearBubble 持久化', disk3.pinLastUser === true && disk3.clearBubble === true, JSON.stringify(disk3))
const g = await (await nodeFetch(base + '/cc/settings.json')).json()
ok('host 读回这两个字段（重启/刷新后能恢复）', g.settings.pinLastUser === true && g.settings.clearBubble === true)
ok('压缩参数完全没被外观开关动过', g.settings.enabled === false && g.settings.triggerPct === 30 && g.settings.retainPct === 4)

console.log('\n— 7. 对话页固定宽度（原底图工坊那一节，已移入本插件）—')
it.STORE.set({ loading: false, loaded: true, appearanceReady: true })
puts.length = 0
it.setChatWidthEnabled(true)
it.commitChatWidth(90)
await sleep(600)
ok('三个宽度变量都按**百分比**钉在会话根上（v1.5.0 起；绕过宿主响应式 clamp）',
  chatRoot.style.getPropertyValue('--dsh-chat-content-width') === '90%'
  && chatRoot.style.getPropertyValue('--dsh-composer-card-max-width') === '90%'
  && chatRoot.style.getPropertyValue('--dsh-chat-user-width') === '90%',
  JSON.stringify(chatRoot.style._p))
// 旧 px 值（>100）必须落到默认 80%，而不是被当成 1600% 或原样写 1600px
it.commitChatWidth(1600)
await sleep(50)
ok('旧 px 值 1600 被归一成 80%（单位换百分比后的迁移口径）',
  chatRoot.style.getPropertyValue('--dsh-chat-content-width') === '80%',
  chatRoot.style.getPropertyValue('--dsh-chat-content-width'))
it.commitChatWidth(90)
await sleep(600)
const disk4 = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
ok('chatWidth(%) / chatWidthEnabled 落盘', disk4.chatWidth === 90 && disk4.chatWidthEnabled === true, JSON.stringify(disk4))
it.setPinBlur(99)
ok('模糊度上钳 24 并即时写进 CSS 变量',
  it.STORE.state.pinBlur === 24 && html.style.getPropertyValue('--cc-pin-blur') === '24px', String(it.STORE.state.pinBlur))
it.setPinBlur(-5)
ok('模糊度下钳 0（0 是合法档，不是缺省）',
  it.STORE.state.pinBlur === 0 && html.style.getPropertyValue('--cc-pin-blur') === '0px', String(it.STORE.state.pinBlur))
await sleep(600)
const disk5 = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
ok('pinBlur 落盘', disk5.pinBlur === 0, JSON.stringify(disk5))
it.setChatWidthEnabled(false)
ok('关掉后三个变量从会话根摘掉（交回宿主自适应）',
  chatRoot.style.getPropertyValue('--dsh-chat-content-width') === ''
  && chatRoot.style.getPropertyValue('--dsh-chat-user-width') === '', JSON.stringify(chatRoot.style._p))
await sleep(600)   // 让上面这次 scheduleSave 落盘，别拿旧盘去比
it.STORE.set({ appearanceReady: false })
it.setChatWidthEnabled(true)
it.setPinBlur(22)
ok('旧 host（能力未装载）时这三项都是空操作',
  it.STORE.state.chatWidthEnabled === false && it.STORE.state.pinBlur === 0, JSON.stringify(it.STORE.state))
it.STORE.set({ appearanceReady: true })
const g2 = await (await nodeFetch(base + '/cc/settings.json')).json()
ok('host GET 带回全部新字段（刷新页面能原样恢复）',
  g2.settings.chatWidth === 90 && g2.settings.chatWidthEnabled === false && g2.settings.pinBlur === 0
  && g2.settings.pinLastUser === true && g2.settings.clearBubble === true, JSON.stringify(g2.settings))

server.close()
fs.rmSync(ROOT, { recursive: true, force: true })
delete globalThis.window; delete globalThis.document; delete globalThis.fetch
delete globalThis.MutationObserver; delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame
console.log('\n' + pass + ' passed, ' + fail + ' failed\n')
process.exitCode = fail === 0 ? 0 : 1
