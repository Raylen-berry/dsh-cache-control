// 用真实浏览器引擎看一次：把 client.js 真实产出的 chip/panel 标记与 CSS 塞进
// 一个复刻宿主约束的壳（transform 根 + overflow:hidden 输入卡片），对比
// "面板留在插槽里"（旧写法）与"portal 到 body"（新写法）。
// 产出 cc-fixture-out\A-inline.png / B-body.png 与几何报告。
import fs from 'node:fs'
import http from 'node:http'
import crypto from 'node:crypto'
import path from 'node:path'
import { spawn } from 'node:child_process'

const HERE = import.meta.dirname
const PLUGIN = process.env.DSH_CC_PLUGIN || 'D:/DeepSeek/dsh-plugins/dsh-cache-control/';
const APP = process.env.DSH_APP_MODULES || 'D:/deepseek-harness/DSH Desktop/resources/app/node_modules/';
const OUT = HERE + '\\cc-fixture-out'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const unwrap = (m) => (m && m.default && (m.default.createElement || m.default.renderToStaticMarkup)) ? m.default : m
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

fs.mkdirSync(OUT, { recursive: true })
const React = unwrap(await import('file:///' + APP + 'react/index.js'))
const ReactDOMServer = unwrap(await import('file:///' + APP + 'react-dom/server.js'))

// ---- 装载 client 半：捕获注入的 CSS，拿到 chip 槽组件 ----
let captured = null
let cssText = ''
let chipComp = null
globalThis.window = { __ModuleLoader__: { load: (m) => { captured = m } }, innerWidth: 1440, innerHeight: 900 }
globalThis.document = {
  createElement: () => ({ setAttribute() {}, textContent: '', type: '' }),
  head: { appendChild: (el) => { if (el && el.textContent) cssText += el.textContent } },
}
globalThis.fetch = () => Promise.reject(new Error('离线夹具不联网'))
await import('file:///' + PLUGIN + 'client.js?fx' + Date.now())
if (!captured) throw new Error('client.js 没注册 factory')
const ex = captured.factory((name) => {
  if (name === 'react') return React
  if (name === 'react-dom') return { createPortal: (node) => node }
  throw new Error('bad require ' + name)
})
ex.apply({
  get: (n) => (n === 'slots' ? {
    inject: (name, fn) => fn((entry, comp) => { if (entry && entry.name === 'conversation.input.right') chipComp = comp; return entry }),
    register: (entry, comp) => { if (entry && entry.name === 'conversation.input.right') chipComp = comp; return entry },
  } : undefined),
  effect: (fn) => fn(),
})
await sleep(60)
ex.internals.STORE.set({
  loading: false, loaded: true, gateReady: true, appearanceReady: true, error: '', gateError: '',
  enabled: true, gateEnabled: true, pinLastUser: true, clearBubble: false,
  triggerPct: 30, retainPct: 4, auto: true, applied: true, saving: false,
  gateBytes: 2709, gateLines: 32, gateSource: 'builtin', gateMaxBytes: 6144,
  windowTokens: 1000000, triggerTokens: 300000, retainTokens: 40000,
  gateText: '# 会话门禁 · 长期规则\nR1 独立研判 / R2 必要提问 / R3 分工固定\n',
})
if (!chipComp) throw new Error('没拿到 chip 槽组件')
console.log('CSS 捕获 ' + cssText.length + ' B')

// ---- 渲染展开态（走 internals.setForceOpen 测试缝），拆出 chip 与 panel ----
ex.internals.setForceOpen(true)
const opened = ReactDOMServer.renderToStaticMarkup(chipComp())
ex.internals.setForceOpen(false)
const chipStart = opened.indexOf('<span class="cc-chip')
const panelStart = opened.indexOf('<div class="cc-panel"')
if (chipStart < 0 || panelStart < 0) {
  throw new Error('没拆出 chip/panel：渲染长度=' + opened.length)
}
const chipHtml = opened.slice(chipStart, panelStart)
function balancedDiv(s, from) {
  let depth = 0
  const tags = /<div\b|<\/div>/g
  tags.lastIndex = from
  let m
  while ((m = tags.exec(s))) { depth += m[0] === '</div>' ? -1 : 1; if (depth === 0) return s.slice(from, tags.lastIndex) }
  return s.slice(from)
}
const panelHtml = balancedDiv(opened, panelStart)
if (!chipHtml.includes('cc-chip') || !panelHtml.includes('cc-panel') || !panelHtml.includes('① 省缓存')) {
  throw new Error('拆分不完整：panel ' + panelHtml.length + 'B')
}

// 三种组合，只动"父级"和"朝向"两个变量：
//   A = 留在插槽里 + 旧朝向（top: chip 下沿+6）→ 底部工具条下方，等于开到视口外
//   B = portal 到 body + 新朝向（bottom: chip 上沿+6）→ 现方案
//   C = 留在插槽里 + 新朝向 → 用来判断 portal 到底有没有起作用
const OLD_STYLE = 'left:1080px;top:891px;max-height:420px'
const NEW_STYLE = 'left:1080px;bottom:60px;max-height:420px'
const styleFor = { A: OLD_STYLE, B: NEW_STYLE, C: NEW_STYLE }
const placedFor = {}
for (const k of ['A', 'B', 'C']) {
  const p = panelHtml.replace(/style="[^"]*"/, 'style="' + styleFor[k] + '"')
  if (p === panelHtml) throw new Error('面板没有可替换的 style')
  placedFor[k] = p
}

const turns = Array.from({ length: 26 }, (_, i) =>
  `<div class="flowItem"><div class="x_userRow"><div class="x_userStack"><div class="x_bubble">正文第 ${i + 1} 段 —— 用来观察钉顶与面板遮挡。</div></div></div></div>`).join('')
const page = (mode) => `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#1b1b1d;color:#ddd;font:13px/1.6 system-ui}
#root{transform:translateZ(0);height:100vh;display:flex;flex-direction:column}
#scroller{flex:1;overflow-y:auto;padding:14px}
.flowItem{margin:0 0 14px}
.x_bubble{background:#2f2f34;border:1px solid #45454c;border-radius:10px;padding:8px 10px}
#composerCard{overflow:hidden;position:relative;display:flex;align-items:center;justify-content:flex-end;gap:8px;height:52px;border-top:1px solid #555;background:#232326;padding:0 14px}
${cssText}
</style>
<div id="root">
  <div id="scroller" data-conversation-scroll>${turns}</div>
  <div id="composerCard">${mode === 'B' ? chipHtml : chipHtml + placedFor[mode]}</div>
</div>
${mode === 'B' ? '<div style="display:contents">' + placedFor.B + '</div>' : ''}
`
fs.writeFileSync(OUT + '\\A-inline-oldtop.html', page('A'))
fs.writeFileSync(OUT + '\\B-body-newbottom.html', page('B'))
fs.writeFileSync(OUT + '\\C-inline-newbottom.html', page('C'))
console.log('夹具：A/B/C 三个 html 已写入 ' + OUT)

// ---- headless Chrome：量几何 + 截图 ----
const MEASURE = `(() => {
  const p = document.querySelector('.cc-panel'), c = document.querySelector('.cc-chip'), card = document.getElementById('composerCard');
  const r = p.getBoundingClientRect(), cr = c.getBoundingClientRect(), kr = card.getBoundingClientRect();
  // 可见比例 = 面板与视口的交叠面积 / 面板面积（被裁到卡片里 与 开到屏幕外 都会体现在这里）
  const iw = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
  const ih = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
  const vis = Math.max(0, iw) * Math.max(0, ih);
  const cx = r.left + r.width / 2, cy = r.top + Math.min(60, r.height / 2);
  const inVp = cx >= 0 && cx <= innerWidth && cy >= 0 && cy <= innerHeight;
  const hit = inVp ? document.elementFromPoint(cx, cy) : null;
  const head = p.querySelector('.cc-panelHead');
  return JSON.stringify({
    panelRect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    chipTop: Math.round(cr.top), cardBox: Math.round(kr.y) + ',' + Math.round(kr.height), viewport: innerWidth + 'x' + innerHeight,
    fullyInViewport: r.top >= 0 && r.bottom <= innerHeight,
    aboveChip: r.bottom <= cr.top + 2,
    offBottomPx: Math.max(0, Math.round(r.bottom - innerHeight)),
    visibleRatio: +(vis / (r.width * r.height)).toFixed(3),
    hitAtPanelUpperHalf: hit ? ((hit.className || hit.tagName) + '').slice(0, 30) : null,
    hitInsidePanel: !!(hit && p.contains(hit)),
    headText: head ? head.textContent.trim() : null,
    sliders: p.querySelectorAll('input[type=range]').length,
    sections: [...p.querySelectorAll('.cc-sectTitle')].map(e => e.textContent.trim()),
  })
})()`

async function shoot(file, png) {
  const port = 9600 + Math.floor(Math.random() * 200)
  const userDir = path.join(process.env.TEMP, 'cdp_fx_' + crypto.randomBytes(3).toString('hex'))
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--remote-allow-origins=*', '--force-device-scale-factor=2', '--window-size=1440,900',
    '--remote-debugging-port=' + port, '--user-data-dir=' + userDir, 'about:blank'], { stdio: 'ignore' })
  const wget = (p2) => new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: p2, path: '/json' }, (r) => { let d = ''; r.on('data', (x) => { d += x }); r.on('end', () => res(d)) }).on('error', rej)
  })
  let list = null
  for (let i = 0; i < 40; i++) { try { list = JSON.parse(await wget(port)); break } catch { await sleep(250) } }
  if (!list) throw new Error('devtools 未就绪')
  const wsUrl = list.find((t) => t.type === 'page').webSocketDebuggerUrl.replace(/ws:\/\/[^/]+/, 'ws://127.0.0.1:' + port)
  const ws = new globalThis.WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    let m
    try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString()) } catch { return }
    if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.rej(new Error(m.error.message)) : q.res(m.result) }
  })
  const send = (method, params) => new Promise((res, rej) => {
    const id = ++seq
    const t = setTimeout(() => { pending.delete(id); rej(new Error('CDP 超时 ' + method)) }, 8000)
    pending.set(id, { res: (v) => { clearTimeout(t); res(v) }, rej: (e) => { clearTimeout(t); rej(e) } })
    ws.send(JSON.stringify({ id, method, params }))
  })
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', () => rej(new Error('ws 错误')))
    setTimeout(() => rej(new Error('ws 超时')), 8000)
  })
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false })
  await send('Page.navigate', { url: 'file:///' + file.replace(/\\/g, '/') })
  await sleep(800)
  const ev = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true })
  if (ev.exceptionDetails) throw new Error('量测异常 ' + JSON.stringify(ev.exceptionDetails).slice(0, 240))
  const geo = JSON.parse(ev.result.value)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(png, Buffer.from(shot.data, 'base64'))
  try { ws.close() } catch {}
  chrome.kill()
  return geo
}

const gA = await shoot(OUT + '\\A-inline-oldtop.html', OUT + '\\A-inline-oldtop.png')
const gB = await shoot(OUT + '\\B-body-newbottom.html', OUT + '\\B-body-newbottom.png')
const gC = await shoot(OUT + '\\C-inline-newbottom.html', OUT + '\\C-inline-newbottom.png')
console.log('\n— A 插槽内 + 旧朝向(top: chip 下沿+6) —\n' + JSON.stringify(gA, null, 1))
console.log('\n— B portal 到 body + 新朝向(bottom) —\n' + JSON.stringify(gB, null, 1))
console.log('\n— C 插槽内 + 新朝向(bottom) —\n' + JSON.stringify(gC, null, 1))
const okView = (g) => g.fullyInViewport && g.aboveChip && g.hitInsidePanel && g.sliders === 2 && g.sections.length === 2
console.log('\n判定：')
console.log('  A（旧朝向）可见比例 ' + gA.visibleRatio + '，超出视口底部 ' + gA.offBottomPx + 'px → ' + (gA.visibleRatio < 0.05 ? '基本等于看不见' : '还能看见'))
console.log('  B（现方案）' + (okView(gB) ? '完整可见、在 chip 上方、命中的是它自己' : '有问题 ' + JSON.stringify(gB)))
console.log('  C（不 portal 只改朝向）' + (okView(gC) ? '也完整可见 ⇒ 朝向才是主因，portal 属于加固' : '被裁 ⇒ portal 是必要条件'))
process.exitCode = (gA.visibleRatio < 0.05 && okView(gB)) ? 0 : 1
