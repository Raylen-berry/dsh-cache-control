// 外观两开关的浏览器实测：用宿主产物里的真实 CSS 片段搭一个滚动会话区，
// 量三件事：① 钉顶到底动没动（sticky 移动量）；② 气泡透明后是否还落在宿主
// overflow:hidden 盒子里（可见性）；③ 关掉开关后痕迹是否清干净。
// 产出 cc-appear-out\{off,on,scrolled}.png
import fs from 'node:fs'
import http from 'node:http'
import crypto from 'node:crypto'
import path from 'node:path'
import { spawn } from 'node:child_process'

const HERE = import.meta.dirname
const CHAT = process.env.DSH_CHAT_BUNDLE || 'D:/deepseek-harness/DSH Desktop/resources/app/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js';
const PLUGIN = process.env.DSH_CC_PLUGIN || 'D:/DeepSeek/dsh-plugins/dsh-cache-control/';
const OUT = HERE + '\\cc-appear-out'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })

// —— 从宿主产物里抠出真实 CSS 规则（不是我手写的近似）——
const bundle = fs.readFileSync(CHAT, 'utf8')
const grab = (name) => {
  const re = new RegExp('\\._7mWUNa_' + name + '\\{[^}]*\\}', 'g')
  return (bundle.match(re) || []).join('\n')
}
const hostCss = [grab('root'), grab('scroll'), grab('column'), grab('flowItem'),
  ...bundle.split('\n').filter((l) => l.includes('[data-conversation-scroll]') && l.includes('_7mWUNa_'))
    .map((l) => (l.match(/\[data-conversation-scroll\][^{]*\{[^}]*\}/g) || []).join('\n'))].join('\n')
// 气泡与提问行的真实规则（MessageItem 的哈希前缀长度不定，从首次出现处取）
const prefixMatch = bundle.match(/\.([A-Za-z0-9]{4,10})_userRow\{/)
if (!prefixMatch) throw new Error('产物里找不到 _userRow 规则')
const PREFIX = prefixMatch[1]
const bubbleRules = (bundle.match(new RegExp('\\.' + PREFIX + '_(userRow|userStack|bubble|meta)\\{[^}]*\\}', 'g')) || []).join('\n')
if (!/_7mWUNa_column\{/.test(hostCss) || !/_userRow\{/.test(bubbleRules)) {
  throw new Error('没抠到宿主 CSS：host ' + hostCss.length + 'B / bubble ' + bubbleRules.length + 'B')
}
console.log('宿主 CSS 片段：chat ' + hostCss.length + 'B，MessageItem ' + bubbleRules.length + 'B（前缀 ' + PREFIX + '）')

// —— 插件自己的外观 CSS：不再用正则去啃源码（样式条目里有字符串拼接，啃法会截出一半），
// 而是真的装载 client.js、捕获它注入的样式文本 —— 与浏览器实际拿到的字节同源。
const APP_MOD = process.env.DSH_APP_MODULES || 'D:/deepseek-harness/DSH Desktop/resources/app/node_modules/'
const unwrap = (m) => (m && m.default && m.default.createElement) ? m.default : m
const ReactA = unwrap(await import('file:///' + APP_MOD + 'react/index.js'))
let capCss = ''
let capLoader = null
globalThis.window = { __ModuleLoader__: { load: (m) => { capLoader = m } }, innerWidth: 1280, innerHeight: 760 }
globalThis.document = {
  createElement: () => ({ setAttribute() {}, textContent: '', type: '' }),
  head: { appendChild: (el) => { if (el && el.textContent) capCss += el.textContent + '\n' } },
}
globalThis.fetch = () => Promise.reject(new Error('夹具不联网'))
await import('file:///' + PLUGIN + 'client.js?ap' + Date.now())
capLoader.factory((name) => { if (name === 'react') return ReactA; if (name === 'react-dom') return { createPortal: (n) => n }; throw new Error('bad require ' + name) })
  .apply({
    get: (n) => (n === 'slots' ? { inject: (name, fn) => fn((e) => e), register: (e) => e } : undefined),
    effect: (fn) => fn(),
  })
const appearCss = capCss.split('\n').filter((l) => /data-cc-|_userRow|_bubble/.test(l)).join('\n')
if (!/data-cc-pin-last-user/.test(appearCss) || !/backdrop-filter/.test(appearCss)) {
  throw new Error('没取全插件外观 CSS（' + appearCss.length + 'B）')
}
console.log('插件外观 CSS ' + appearCss.length + 'B（装载 client.js 实取）')

// 直接用宿主真实类名（连哈希前缀一起），这样插件里 [class*="_userRow"] 这类
// 后缀选择器是被原样检验的，而不是被我改名的近似版。
const rows = Array.from({ length: 14 }, (_, i) =>
  `<div class="_7mWUNa_flowItem" data-chat-flow-key="t${i}">
     ${i % 3 === 0 ? `<div class="${PREFIX}_userRow"><div class="${PREFIX}_userStack"><div class="${PREFIX}_bubble">我的提问 ${i}：这一条要在滚动时钉在会话区顶部。</div></div></div>` : ''}
     <div class="${PREFIX}_bubble">回答 ${i}：${'这里放一段较长的正文，用来看钉顶的那条会不会被压住、以及透明后好不好读。'.repeat(2)}</div>
   </div>`).join('')
  // 真实用法里，最后一条提问下面是一篇长回答 —— 没有内容垫在下面，sticky 就没有移动量，
  // 测出来的"没钉住"是夹具不真实，不是功能坏。补一条 30 段长回答。
  + `<div class="_7mWUNa_flowItem" data-chat-flow-key="long">${
    Array.from({ length: 30 }, (_, k) => `<div class="${PREFIX}_bubble">长回答第 ${k + 1} 段：这一段存在的意义是给上面的钉顶条目留出滚动余量，让 sticky 有地方可移动。</div>`).join('')
  }</div>`

const html = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#15161a;color:#e6e6e6;font:14px/1.7 system-ui;--dsw-specific-bubble:#2f2f34;--dsw-alias-bg-layer-1:#202024}
/* 宿主把 --dsh-chat-content-width 声明在会话根（.Sbj43W_root）上并由它算出列宽；
   夹具不装载 conversation 那半个包，所以在这里按真机同值给出，钉顶底衬的"定长"
   公式（× .702）才有东西可解析。 */
#root{--dsh-chat-content-width:748px}
#root{transform:translateZ(0);height:100vh;display:flex;flex-direction:column}
${hostCss}
${bubbleRules}
#scroller{flex:1;min-height:0;overflow-y:auto}
${appearCss}
</style>
<div id="root"><div id="scroller" data-conversation-scroll>
  <div class="_7mWUNa_column" data-chat-flow>${rows}</div>
</div></div>
<script>
window.__cc = {
  measure() {
    const sc = document.getElementById('scroller')
    const rows = [...document.querySelectorAll('.${PREFIX}_userRow')]
    const marked = document.querySelector('[data-cc-pin]')
    const row = rows[rows.length - 1]
    const rb = row ? row.getBoundingClientRect() : null
    return JSON.stringify({
      htmlAttrs: [...document.documentElement.attributes].map(a => a.name).filter(n => n.startsWith('data-cc')),
      markedCount: document.querySelectorAll('[data-cc-pin]').length,
      markedTag: marked ? (marked.className + '|' + (marked.getAttribute('data-chat-flow-key') || '')) : null,
      markedIsFlowItem: !!marked && marked.parentElement === document.querySelector('[data-chat-flow]'),
      lastUserRowTop: rb ? Math.round(rb.top) : null,
      // 滚到底部时，最近一条提问是否仍贴在滚动区顶（sticky 生效的直接证据）
      scrollerTop: Math.round(sc.getBoundingClientRect().top),
      pinnedAtTop: rb ? Math.abs(rb.top - sc.getBoundingClientRect().top) < 40 : null,
      bubbleBg: row ? getComputedStyle(row.querySelector('.${PREFIX}_bubble')).backgroundColor : null,
      // 钉住那条的底衬改画在 ::before 上（2026-09-09）：必须是"定长 + 右对齐 + 圆角矩形"，
      // 行本身（= 整个会话列宽）不能再有背景/模糊，否则左边一大片又被糊住。
      // 只回原始字符串，alpha 在 Node 侧解析 —— 嵌进模板字符串的字面量里不能写正则：
      // \\/ 与 \\s 会被模板字符串当转义吃掉，正则会变成 // 行注释，整段页内脚本报语法错。
      rowBg: marked ? getComputedStyle(marked).backgroundColor : null,
      rowBackdrop: marked ? (getComputedStyle(marked).backdropFilter || getComputedStyle(marked).webkitBackdropFilter || 'none') : null,
      plateBg: marked ? getComputedStyle(marked, '::before').backgroundColor : null,
      plateBackdrop: marked ? (getComputedStyle(marked, '::before').backdropFilter || getComputedStyle(marked, '::before').webkitBackdropFilter || 'none') : null,
      plateRadius: marked ? getComputedStyle(marked, '::before').borderRadius : null,
      platePos: marked ? getComputedStyle(marked, '::before').position + '|' + getComputedStyle(marked, '::before').zIndex : null,
      // 定长检验：::before 的盒子 vs 整行盒子（左侧必须留白），以及气泡自身的位置
      plateBox: marked ? (function () { const b = marked.getBoundingClientRect(); const cs = getComputedStyle(marked, '::before'); return { rowW: Math.round(b.width), rowRight: Math.round(b.right), rowTop: Math.round(b.top), rowH: Math.round(b.height), declaredW: cs.width, declaredRight: cs.right } })() : null,
      bubbleBox: row ? (function () { const b = row.querySelector('.${PREFIX}_bubble').getBoundingClientRect(); return { w: Math.round(b.width), right: Math.round(b.right), left: Math.round(b.left) } })() : null,
      blurVar: marked ? getComputedStyle(document.documentElement).getPropertyValue('--cc-pin-blur').trim() : null,
    })
  },
  scrollToEnd() { const sc = document.getElementById('scroller'); sc.scrollTop = sc.scrollHeight },
  debug() {
    const sc = document.getElementById('scroller')
    const flow = document.querySelector('[data-chat-flow]')
    const m = document.querySelector('[data-cc-pin]')
    const fr = flow.getBoundingClientRect(), mr = m ? m.getBoundingClientRect() : null
    const cs = m ? getComputedStyle(m) : null
    return JSON.stringify({
      scroller: { scrollTop: Math.round(sc.scrollTop), clientH: sc.clientHeight, scrollH: sc.scrollHeight },
      flowRect: fr ? { y: Math.round(fr.y), h: Math.round(fr.height) } : null,
      flowDisplay: flow ? getComputedStyle(flow).display : null,
      marked: mr ? { y: Math.round(mr.y), h: Math.round(mr.height) } : null,
      markedPos: cs ? cs.position : null, markedTop: cs ? cs.top : null, markedZ: cs ? cs.zIndex : null,
      markedParentOverflow: m ? getComputedStyle(m.parentElement).overflow : null,
      // 该元素之后还有多少内容（sticky 的移动量 = 父级底 - 自身底）
      travelPx: (m && fr && mr) ? Math.round(fr.bottom - mr.bottom) : null,
    })
  },
  setFlags(on, clear, blur) {
    const de = document.documentElement
    if (on) de.setAttribute('data-cc-pin-last-user', '1'); else de.removeAttribute('data-cc-pin-last-user')
    if (clear) de.setAttribute('data-cc-clear-bubble', '1'); else de.removeAttribute('data-cc-clear-bubble')
    // 模拟插件 applyAppearance：模糊度只是一个写在 <html> 上的 CSS 变量
    if (blur === undefined) de.style.removeProperty('--cc-pin-blur')
    else de.style.setProperty('--cc-pin-blur', blur + 'px')
    // 模拟插件的 applyPin：把标记打在最后一条提问对应的 [data-chat-flow] 直接子元素上
    document.querySelectorAll('[data-cc-pin]').forEach(e => e.removeAttribute('data-cc-pin'))
    if (!on) return 'off'
    const flow = document.querySelector('[data-chat-flow]')
    const rows = [...document.querySelectorAll('.${PREFIX}_userRow')]
    const last = rows[rows.length - 1]
    let n = last
    while (n && n.parentElement && n.parentElement !== flow) n = n.parentElement
    if (n && n.parentElement === flow) n.setAttribute('data-cc-pin', '1')
    return n ? n.className : 'none'
  }
}
<\/script>`
fs.writeFileSync(OUT + '\\appear.html', html)

// —— CDP ——
async function withChrome(fn) {
  const port = 9700 + Math.floor(Math.random() * 150)
  const userDir = path.join(process.env.TEMP, 'cdp_ap_' + crypto.randomBytes(3).toString('hex'))
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--remote-allow-origins=*', '--force-device-scale-factor=1', '--window-size=1280,760',
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
  const call = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
    if (r.exceptionDetails) throw new Error('页内异常 ' + JSON.stringify(r.exceptionDetails).slice(0, 200))
    return r.result.value
  }
  try {
    await new Promise((res, rej) => {
      ws.addEventListener('open', res)
      ws.addEventListener('error', () => rej(new Error('ws')))
      setTimeout(() => rej(new Error('ws 超时')), 8000)
    })
    await send('Runtime.enable')
    await send('Page.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 760, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url: 'file:///' + (OUT + '\\appear.html').replace(/\\/g, '/') })
    await sleep(700)
    await fn({ send, call, shot: async (name) => {
      const s = await send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(OUT + '\\' + name + '.png', Buffer.from(s.data, 'base64'))
      return OUT + '\\' + name + '.png'
    } })
  } finally {
    try { ws.close() } catch {}
    chrome.kill()
  }
}

const report = {}
await withChrome(async ({ call, shot }) => {
  report['off'] = JSON.parse(await call('__cc.measure()'))
  await shot('01-off')
  const marked = await call('__cc.setFlags(true, true, 10)')
  report.markedTarget = marked
  report['on-top'] = JSON.parse(await call('__cc.measure()'))
  await call('__cc.scrollToEnd()')
  await sleep(250)
  report['on-scrolledToEnd'] = JSON.parse(await call('__cc.measure()'))
  report.debug = JSON.parse(await call('__cc.debug()'))
  await shot('02-on-scrolled')
  await call('__cc.setFlags(true, false, 10)')
  await sleep(120)
  report['on-noClear'] = JSON.parse(await call('__cc.measure()'))
  // 可调模糊度：把写在 <html> 上的 --cc-pin-blur 改成 0 / 20，量 backdrop-filter 跟不跟。
  await call('__cc.setFlags(true, true, 0)')
  await sleep(120)
  report['blur0'] = JSON.parse(await call('__cc.measure()'))
  await call('__cc.setFlags(true, true, 20)')
  await sleep(120)
  report['blur20'] = JSON.parse(await call('__cc.measure()'))
  await shot('04-blur20')
  await call('__cc.setFlags(false, false)')
  await sleep(120)
  report['offAgain'] = JSON.parse(await call('__cc.measure()'))
  await shot('03-off-again')
})

const J = (o) => JSON.stringify(o)
// Chrome 把 color-mix() 结果留成 color(srgb r g b / a)，也可能是 rgb(r g b / 58%) 或
// 旧式 rgba(r,g,b,a) —— 三种写法都要认，否则会把"半透明"误读成"不透明"。
const alphaOf = (bg) => {
  if (typeof bg !== 'string' || !bg) return null
  let m = /\/\s*([\d.]+)%\s*\)?/.exec(bg)
  if (m) return +(parseFloat(m[1]) / 100).toFixed(2)
  m = /\/\s*([\d.]+)\s*\)?/.exec(bg)
  if (m) return +parseFloat(m[1]).toFixed(2)
  m = /^rgba?\(([^)]+)\)$/.exec(bg)
  if (m) { const ps = m[1].split(/[\s,]+/).map(parseFloat); return ps.length > 3 ? +ps[3].toFixed(2) : 1 }
  return null
}
console.log('\n— 关掉 —\n  ' + J(report.off))
console.log('— 打开并滚到底 —\n  ' + J(report['on-scrolledToEnd']) + '\n  钉住元素: ' + report.markedTarget)
console.log('  几何: ' + J(report.debug))
console.log('— 只关透明、留钉顶 —\n  ' + J(report['on-noClear']))
console.log('— 再关掉 —\n  ' + J(report.offAgain))

let bad = 0
const t = (name, cond, extra = '') => { if (cond) { console.log('  PASS  ' + name) } else { bad++; console.log('  FAIL  ' + name + '  [' + extra + ']') } }
console.log('\n— 判定 —')
t('关掉时 <html> 上没有 data-cc 属性', report.off.htmlAttrs.length === 0, J(report.off.htmlAttrs))
t('钉住的是 [data-chat-flow] 的直接子元素（每条消息一层）', report['on-top'].markedIsFlowItem === true, J(report['on-top']))
t('同时只有一个元素被钉', report['on-scrolledToEnd'].markedCount === 1, String(report['on-scrolledToEnd'].markedCount))
t('滚到底后最近一条提问仍在滚动区顶部（sticky 真的动了）',
  report['on-scrolledToEnd'].pinnedAtTop === true, J(report['on-scrolledToEnd']))
t('未开透明时气泡背景不是 transparent', /rgba?\(0,\s*0,\s*0,\s*0\)/.test(report['on-noClear'].bubbleBg) === false, String(report['on-noClear'].bubbleBg))
t('全关后痕迹清空', report.offAgain.htmlAttrs.length === 0 && report.offAgain.markedCount === 0, J(report.offAgain))
// 底衬按用户 2026-09-09 选定形态：定长圆角矩形毛玻璃，画在 ::before 上；整行不再有背景。
// alpha 必须 > 0：没有 background 时算出来也是 0，那是"没底衬"不是"半透明"。
const semiTransparent = (a) => a !== null && a > 0 && a < 1
const blurPx = (s) => (typeof s === 'string' ? Number((/blur\(\s*([\d.]+)px\s*\)/.exec(s) || [])[1]) : NaN)
t('钉住条目底衬是半透明（0<alpha<1）· 透明气泡开时',
  semiTransparent(alphaOf(report['on-scrolledToEnd'].plateBg)),
  alphaOf(report['on-scrolledToEnd'].plateBg) + ' / ' + report['on-scrolledToEnd'].plateBg)
t('钉住条目底衬是半透明（0<alpha<1）· 透明气泡关时',
  semiTransparent(alphaOf(report['on-noClear'].plateBg)),
  alphaOf(report['on-noClear'].plateBg) + ' / ' + report['on-noClear'].plateBg)
t('底衬带 backdrop-filter 模糊（毛玻璃）· 开透明', blurPx(report['on-scrolledToEnd'].plateBackdrop) === 10,
  String(report['on-scrolledToEnd'].plateBackdrop))
t('底衬带 backdrop-filter 模糊（毛玻璃）· 关透明', blurPx(report['on-noClear'].plateBackdrop) === 10,
  String(report['on-noClear'].plateBackdrop))
t('底衬不会挡住气泡自己的透明效果', report['on-scrolledToEnd'].bubbleBg === 'rgba(0, 0, 0, 0)',
  String(report['on-scrolledToEnd'].bubbleBg))
const moved = report['off'].lastUserRowTop !== report['on-scrolledToEnd'].lastUserRowTop
t('对比未打开时同一滚动位置的行顶坐标（说明钉住改变了可见位置）', moved,
  report['off'].lastUserRowTop + ' vs ' + report['on-scrolledToEnd'].lastUserRowTop)
// ↓ 2026-09-09 三条新要求：左侧不糊 / 圆角矩形定长 / 模糊度可调
t('整行不再有背景（左侧不再被糊）· 透明开', alphaOf(report['on-scrolledToEnd'].rowBg) === 0,
  String(report['on-scrolledToEnd'].rowBg))
t('整行不再有背景（左侧不再被糊）· 透明关', alphaOf(report['on-noClear'].rowBg) === 0,
  String(report['on-noClear'].rowBg))
t('整行不再有 backdrop-filter', /blur/.test(String(report['on-scrolledToEnd'].rowBackdrop)) === false,
  String(report['on-scrolledToEnd'].rowBackdrop))
t('底衬是圆角矩形（border-radius 16px）', /^16px$/.test(String(report['on-scrolledToEnd'].plateRadius)),
  String(report['on-scrolledToEnd'].plateRadius))
const pb = report['on-scrolledToEnd'].plateBox
const bb = report['on-scrolledToEnd'].bubbleBox
const plateW = Number((/^([\d.]+)px$/.exec(String(pb && pb.declaredW)) || [])[1])
const rowW = pb ? pb.rowW : 0
t('底衬是定长（按会话列宽 ×0.702 折算，非整行宽）', Number.isFinite(plateW) && plateW > 0 && plateW < rowW,
  'plate ' + plateW + ' vs row ' + rowW)
t('底衬比整行明显窄（左侧留出干净区）', Number.isFinite(plateW) && plateW <= rowW * 0.8,
  'plate ' + plateW + ' / row ' + rowW)
t('底衬右缘贴住气泡右缘（±8px）', pb && bb && Math.abs((pb.rowRight + 6) - bb.right) <= 8,
  'rowRight ' + (pb && pb.rowRight) + ' bubbleRight ' + (bb && bb.right))
t('可调模糊度：--cc-pin-blur=0 ⇒ blur(0px)', blurPx(report['blur0'].plateBackdrop) === 0,
  report['blur0'].plateBackdrop + ' / var=' + report['blur0'].blurVar)
t('可调模糊度：--cc-pin-blur=20 ⇒ blur(20px)', blurPx(report['blur20'].plateBackdrop) === 20,
  report['blur20'].plateBackdrop + ' / var=' + report['blur20'].blurVar)
console.log('\n截图：' + OUT + '\\01-off.png / 02-on-scrolled.png / 03-off-again.png / 04-blur20.png')
process.exitCode = bad === 0 ? 0 : 1
