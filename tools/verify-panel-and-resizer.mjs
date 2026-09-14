// 验证 2026-09-14 的两处修复（都不需要真浏览器，也不起 host 半）：
//
// 1) 滑杆面板"点 ▾ 没反应"的真因是**定位数学发散**：校正 effect 把"距底距离"
//    和"视口 Y 坐标"两个量纲相减 ⇒ dy 恒不为 0，又把 dy 累加回 bottom ⇒ 每帧误差翻倍。
//    修复把数学抽成纯函数 computePanelPatch()，这里断言它的量纲、收敛性与量级闸门。
// 2) "隐藏原生拖拽把手"（v1.6.0 一个开关，v1.7.0 拆成两个）：断言两类把手各归各的开关、
//    只标记 cursor 含 resize 的可见元素、排除自己的面板、关掉时把标记撤干净、
//    能力位缺失时不误改宿主 DOM。
//
// 假 DOM 用的结构与真实页面一致的关键点：
//   会话区两竖杠 = <div data-width-handle="left" style="cursor:col-resize">（._8JRpoa_widthHandle）
//   侧栏分隔条   = <div style="cursor:col-resize">，**没有** data-width-handle（._1tdjgG_handle）
const PLUGIN = process.env.DSH_CC_PLUGIN || 'D:/DeepSeek/dsh-plugins/dsh-cache-control/'
const APP = process.env.DSH_APP_MODULES || 'D:/deepseek-harness/DSH Desktop/resources/app/node_modules/'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')) }
}

// ---- 手搓 DOM ----
const allNodes = []
function makeStyle() {
  const props = {}
  return {
    setProperty: (k, v) => { props[k] = String(v) },
    removeProperty: (k) => { delete props[k] },
    getPropertyValue: (k) => (props[k] === undefined ? '' : props[k]),
  }
}
/**
 * @param {object} o  { cls, cursor, visible, inPanel, attrsInit }
 * visible=false ⇒ offsetParent 为 null（隐藏元素，插件必须跳过）
 * inPanel=true  ⇒ 有 .cc-panel 祖先（插件自己的元素，必须跳过）
 * attrsInit     ⇒ 建节点时就带上的属性（如 data-width-handle）
 */
function node(tag, o = {}) {
  const n = {
    tag, className: o.cls || '', offsetParent: o.visible === false ? null : { tag: 'div' },
    attrs: Object.assign({}, o.attrsInit), parentElement: null, style: makeStyle(), _cursor: o.cursor || 'auto',
  }
  n.setAttribute = (k, v) => { n.attrs[k] = v }
  n.getAttribute = (k) => (n.attrs[k] === undefined ? null : n.attrs[k])
  n.removeAttribute = (k) => { delete n.attrs[k] }
  n.closest = (sel) => {
    const want = sel.replace(/^\./, '')
    let p = n
    while (p) {
      if (sel.startsWith('.') ? String(p.className || '').split(/\s+/).indexOf(want) >= 0 : p.attrs[want] !== undefined) return p
      p = p.parentElement
    }
    return null
  }
  allNodes.push(n)
  return n
}
const html = node('html')
const body = node('body')
html.children = [body]; body.parentElement = html

const panelHost = node('div', { cls: 'cc-panel' })
panelHost.parentElement = body
const panelChild = node('textarea', { cls: 'cc-textarea', cursor: 'col-resize', inPanel: true })
panelChild.parentElement = panelHost

// 会话区两竖杠（宽度把手）：可见 + col-resize + data-width-handle。左右各一条。
const widthLeft = node('div', { cls: '_8JRpoa_widthHandle', cursor: 'col-resize', attrsInit: { 'data-width-handle': 'left' } })
widthLeft.parentElement = body
const widthRight = node('div', { cls: '_8JRpoa_widthHandle', cursor: 'col-resize', attrsInit: { 'data-width-handle': 'right' } })
widthRight.parentElement = body
// 侧栏分隔条：可见 + col-resize，但没有 data-width-handle。
const divider = node('div', { cls: '_1tdjgG_handle', cursor: 'col-resize' })
divider.parentElement = body
// 同类但隐藏的（宿主预渲染/切页留下的），不该被标记
const hiddenHandle = node('div', { cls: '_1tdjgG_handle', cursor: 'col-resize', visible: false })
hiddenHandle.parentElement = body
// 普通元素（默认 cursor），必须完全不受影响
const plain = node('div', { cls: 'uSmzmW_column' })
plain.parentElement = body

let observers = 0
globalThis.window = {
  __ModuleLoader__: { load: (m) => { captured = m } },
  innerWidth: 1424, innerHeight: 805,
  getComputedStyle: (el) => ({ cursor: el && el._cursor ? el._cursor : 'auto' }),
}
let captured = null
globalThis.document = {
  documentElement: html,
  body,
  createElement: () => ({ setAttribute() {}, textContent: '', type: '', parentNode: null }),
  head: { appendChild() {} },
  querySelector: () => null,
  querySelectorAll: (sel) => {
    if (sel === '*') return allNodes.slice()
    const hasW = (n) => n.attrs['data-cc-hide-resizer'] !== undefined
    const hasD = (n) => n.attrs['data-cc-hide-divider'] !== undefined
    if (sel.indexOf('data-cc-hide-resizer') >= 0 && sel.indexOf('data-cc-hide-divider') >= 0) {
      return allNodes.filter((n) => hasW(n) || hasD(n))
    }
    if (sel.indexOf('data-cc-hide-resizer') >= 0) return allNodes.filter(hasW)
    if (sel.indexOf('data-cc-hide-divider') >= 0) return allNodes.filter(hasD)
    return []
  },
}
globalThis.MutationObserver = class {
  constructor(cb) { this.cb = cb }
  observe() { observers++ }
  disconnect() { observers-- }
  takeRecords() { return [] }
}
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
globalThis.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })

const React = await import('file:///' + APP + 'react/index.js')
const unwrap = (m) => (m && m.default && m.default.createElement) ? m.default : m
await import('file:///' + PLUGIN + 'client.js?pr' + Date.now())
if (!captured) throw new Error('client.js 未注册 factory')
const ex = captured.factory((name) => {
  if (name === 'react') return unwrap(React)
  throw new Error('bad require ' + name)
})
const it = ex.internals

console.log('\n— 0. 测试缝与假 DOM —')
ok('client 暴露了测试缝', !!it && typeof it.computePanelPatch === 'function', Object.keys(it || {}).length + ' 项')
ok('domReady 认这棵树', it.domReady() === true)
ok('isWidthHandle 只认带 data-width-handle 的', it.isWidthHandle(widthLeft) && it.isWidthHandle(widthRight) && !it.isWidthHandle(divider))

console.log('\n— 1. computePanelPatch：量纲必须一致（这就是那个发散的根因）—')
const vh = 805, gap = 6
// chip 在视口 y=465..489（真实实测值）；面板下沿应贴在 465-6=459
const chipRect = { top: 465, bottom: 489 }
// place() 算出的 bottom=346 ⇒（无变换时）面板下沿 Y = vh - 346 = 459 ⇒ 已经对齐，不该再补
ok('已对齐 ⇒ 返回 null（原实现这里算出 dy=-113 并开始发散）',
  it.computePanelPatch({ left: 653, bottom: 346, top: null }, { top: 14, bottom: 459 }, chipRect, gap) === null)
// 有 +113px 的变换偏移（bottom=346 实际渲染在 Y=572）⇒ 应一次性补成 459
const patched = it.computePanelPatch({ left: 653, bottom: 346, top: null }, { top: 127, bottom: 572 }, chipRect, gap)
ok('有偏移 ⇒ 一步补到位（bottom 346 → 459）', patched && Math.round(patched.bottom) === 459, JSON.stringify(patched))
ok('一步之后即收敛（再算一次为 null）',
  it.computePanelPatch({ left: 653, bottom: 459, top: null }, { top: 14, bottom: 459 }, chipRect, gap) === null)
// 量级闸门：正是这条能把 2026-09-14 那次"甩到 3355 万像素外"拦住
ok('离谱的测量值被闸门挡掉（原实现会把 bottom 推到 -6.7e7）',
  it.computePanelPatch({ left: 653, bottom: 346, top: null }, { top: 0, bottom: 33554004 }, chipRect, gap) === null,
  'MAX=' + it.MAX_PANEL_PATCH)
ok('NaN 测量值也挡掉（不产生 NaN 样式）',
  it.computePanelPatch({ left: 653, bottom: 346, top: null }, { top: 0, bottom: NaN }, chipRect, gap) === null)
// 翻转分支（面板往 chip 下方开）：上沿该贴在 489+6=495
ok('翻转分支同样用视口 Y（top 400 → 495）',
  (function () { const p = it.computePanelPatch({ left: 653, bottom: null, top: 400 }, { top: 400, bottom: 828 }, chipRect, gap); return p && Math.round(p.top) === 495 })(),
  '期望上沿 = chip.bottom + gap')

console.log('\n— 2. markResizers：两类把手各归各的开关 —')
// 只开"两竖杠"开关：宽度把手被标记，分隔条**不**被标记（v1.7.0 的收窄）。
it.STORE.set({ hideResizer: true, resizerReady: true, hideDivider: false, dividerReady: true })
const n1 = it.markResizers()
ok('只开 hideResizer ⇒ 两条宽度把手被标记、分隔条不动',
  n1 === 2 && widthLeft.attrs['data-cc-hide-resizer'] === '1' && widthRight.attrs['data-cc-hide-resizer'] === '1'
  && divider.attrs['data-cc-hide-resizer'] === undefined && divider.attrs['data-cc-hide-divider'] === undefined, '标记数=' + n1)
ok('隐藏的同类元素不动', hiddenHandle.attrs['data-cc-hide-resizer'] === undefined && hiddenHandle.attrs['data-cc-hide-divider'] === undefined)
ok('普通元素不动', plain.attrs['data-cc-hide-resizer'] === undefined && plain.attrs['data-cc-hide-divider'] === undefined)
ok('自己面板内的元素不动', panelChild.attrs['data-cc-hide-resizer'] === undefined && panelChild.attrs['data-cc-hide-divider'] === undefined)
ok('RESIZER_CURSOR_RE 认各种 resize 光标', ['col-resize', 'ew-resize', 'nwse-resize'].every((c) => it.RESIZER_CURSOR_RE.test(c)) && !it.RESIZER_CURSOR_RE.test('pointer'))
// 再开"分隔条"开关：两类同时被标记，互不干扰。
it.STORE.set({ hideDivider: true })
const n2 = it.markResizers()
ok('两个开关都开 ⇒ 分隔条也被标记（且宽度把手标记不变）',
  divider.attrs['data-cc-hide-divider'] === '1' && widthLeft.attrs['data-cc-hide-resizer'] === '1', '本轮标记数=' + n2)
// 关掉"两竖杠"开关：只剩分隔条被标记 —— 关一个不能把另一个也撤了。
it.STORE.set({ hideResizer: false })
it.markResizers()
ok('关掉 hideResizer ⇒ 只撤两竖杠的标记，分隔条仍藏着',
  widthLeft.attrs['data-cc-hide-resizer'] === undefined && widthRight.attrs['data-cc-hide-resizer'] === undefined
  && divider.attrs['data-cc-hide-divider'] === '1')
// clearResizers：两套标记一起撤干净。
const n3 = it.clearResizers()
ok('clearResizers 两类标记都撤干净', n3 === 1 && divider.attrs['data-cc-hide-divider'] === undefined, '撤销数=' + n3)

console.log('\n— 3. 能力位：旧 host 不认识键时不误改宿主 DOM —')
it.STORE.set({ resizerReady: false, hideResizer: true, dividerReady: false, hideDivider: true })
ok('两个能力位都缺 ⇒ 不隐藏，applyResizerHiding 返回 false',
  it.applyResizerHiding() === false && widthLeft.attrs['data-cc-hide-resizer'] === undefined && divider.attrs['data-cc-hide-divider'] === undefined)
it.STORE.set({ resizerReady: true })
ok('只恢复 hideResizer 的能力位 ⇒ 只有两竖杠被藏，分隔条（有反应的）保留',
  it.applyResizerHiding() === true && widthLeft.attrs['data-cc-hide-resizer'] === '1' && divider.attrs['data-cc-hide-divider'] === undefined && observers === 1, 'observers=' + observers)
it.STORE.set({ dividerReady: true, hideResizer: false })
it.markResizers()
ok('hideResizer 关、hideDivider 能力位回来后开 ⇒ 只藏分隔条',
  widthLeft.attrs['data-cc-hide-resizer'] === undefined && divider.attrs['data-cc-hide-divider'] === '1')

console.log('\n— 4. setHideResizer / setHideDivider 走同一条路 —')
it.STORE.set({ hideResizer: false, hideDivider: false })
it.applyResizerHiding()
it.setHideResizer(true)
ok('setHideResizer 落 STORE 并生效', it.STORE.state.hideResizer === true && widthLeft.attrs['data-cc-hide-resizer'] === '1')
it.setHideResizer(false)
ok('再关一次也是干净的', it.STORE.state.hideResizer === false && widthLeft.attrs['data-cc-hide-resizer'] === undefined)
it.STORE.set({ dividerReady: false })
it.setHideDivider(true)
ok('dividerReady 缺失 ⇒ setHideDivider 是 no-op（不写 STORE）', it.STORE.state.hideDivider === false)
it.STORE.set({ dividerReady: true })
it.setHideDivider(true)
ok('能力位齐 ⇒ setHideDivider 落 STORE 并生效', it.STORE.state.hideDivider === true && divider.attrs['data-cc-hide-divider'] === '1')
it.setHideDivider(false)
ok('关掉 ⇒ 标记与观察器都拆干净', it.STORE.state.hideDivider === false && divider.attrs['data-cc-hide-divider'] === undefined && observers === 0, 'observers=' + observers)

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail === 0 ? 0 : 1)
