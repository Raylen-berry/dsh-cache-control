// 省缓存插件 · 外观底衬的最小可跑验证
// 背景：本沙箱里 PowerShell 无法以管道捕获子进程输出，CDP over WebSocket 也拿不到回包，
// 所以这里完全不碰 CDP —— 用 headless Chrome 的 --dump-dom，让页面自己把测量结果
// 写进 <pre id="out">，stdout 直接重定向到文件（stdio 用文件描述符，不是命名管道）。
// 产出：cc-appear-out\probe-{state}.html（每态一页）+ probe-{state}.json（页内测量）
//      + probe-{state}.png（截图，肉眼判断左侧是否还糊着）
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const HERE = import.meta.dirname
const CHAT = process.env.DSH_CHAT_BUNDLE || 'D:/deepseek-harness/DSH Desktop/resources/app/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js';
const PLUGIN = process.env.DSH_CC_PLUGIN || 'D:/DeepSeek/dsh-plugins/dsh-cache-control/';
const OUT = path.join(HERE, 'cc-appear-out')
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
fs.mkdirSync(OUT, { recursive: true })

// —— 宿主真实 CSS（从产物里抠，不是手写近似）——
const bundle = fs.readFileSync(CHAT, 'utf8')
const grab = (name) => (bundle.match(new RegExp('\\._7mWUNa_' + name + '\\{[^}]*\\}', 'g')) || []).join('\n')
const hostCss = [grab('root'), grab('scroll'), grab('column'), grab('flowItem')].join('\n')
const prefixMatch = bundle.match(/\.([A-Za-z0-9]{4,10})_userRow\{/)
if (!prefixMatch) throw new Error('产物里找不到 _userRow 规则')
const PREFIX = prefixMatch[1]
const itemCss = (bundle.match(new RegExp('\\.' + PREFIX + '_(userRow|userStack|bubble)\\{[^}]*\\}', 'g')) || []).join('\n')
if (!/_7mWUNa_column\{/.test(hostCss) || !/_userRow\{/.test(itemCss)) {
  throw new Error('没抠到宿主 CSS：host ' + hostCss.length + 'B / item ' + itemCss.length + 'B')
}

// —— 插件自己的外观 CSS：装载 client.js，捕获它注入的样式文本 ——
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
await import('file:///' + PLUGIN + 'client.js?pb' + Date.now())
capLoader.factory((name) => { if (name === 'react') return ReactA; throw new Error('bad require ' + name) })
  .apply({ get: (n) => (n === 'slots' ? { inject: (name, fn) => fn((e) => e), register: (e) => e } : undefined), effect: (fn) => fn() })
const appearCss = capCss.split('\n').filter((l) => /data-cc-|_userRow|_bubble/.test(l)).join('\n')
if (!/data-cc-pin-last-user/.test(appearCss) || !/::before/.test(appearCss) || !/backdrop-filter/.test(appearCss)) {
  throw new Error('没取全插件外观 CSS（' + appearCss.length + 'B）\n' + appearCss)
}
console.log('宿主 CSS ' + hostCss.length + 'B + 插件外观 CSS ' + appearCss.length + 'B（前缀 ' + PREFIX + '）')

// —— 三种状态：全关 / 打开(默认模糊) / 打开(模糊 0) / 打开(模糊 20) ——
const STATES = [
  { key: 'off', pin: false, clear: true, blur: null, scroll: true },
  { key: 'on-default', pin: true, clear: true, blur: null, scroll: true },
  { key: 'on-blur0', pin: true, clear: true, blur: 0, scroll: true },
  { key: 'on-blur20', pin: true, clear: true, blur: 20, scroll: true },
  { key: 'on-noclear', pin: true, clear: false, blur: 14, scroll: true },
]

const rows = Array.from({ length: 8 }, (_, i) =>
  `<div class="_7mWUNa_flowItem" data-chat-flow-key="t${i}">
     ${i === 5 ? `<div class="${PREFIX}_userRow"><div class="${PREFIX}_userStack"><div class="${PREFIX}_bubble">我的提问 ${i}：这一条要在滚动时钉在会话区顶部，底衬只糊气泡那一段。</div></div></div>` : ''}
     <div class="${PREFIX}_bubble">回答 ${i}：${'这里放一段较长的正文，用来看钉顶那条左边是否还被糊住。'.repeat(3)}</div>
   </div>`).join('')
  + `<div class="_7mWUNa_flowItem" data-chat-flow-key="long">${
    Array.from({ length: 30 }, (_, k) => `<div class="${PREFIX}_bubble">长回答第 ${k + 1} 段：给上面的钉顶条目留出滚动余量，sticky 才有地方可移动。</div>`).join('')
  }</div>`

const page = (st) => {
  const pinLine = st.pin ? "de.setAttribute('data-cc-pin-last-user', '1')" : ''
  const clearLine = st.clear ? "de.setAttribute('data-cc-clear-bubble', '1')" : ''
  const blurLine = st.blur === null ? '' : "de.style.setProperty('--cc-pin-blur', '" + st.blur + "px')"
  const markLine = st.pin ? `
    var n = rows[rows.length - 1]
    while (n && n.parentElement && n.parentElement !== flow) n = n.parentElement
    if (n && n.parentElement === flow) n.setAttribute('data-cc-pin', '1')` : ''
  return `<!doctype html><html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#15161a;color:#e6e6e6;font:14px/1.7 system-ui;--dsw-specific-bubble:#2f2f34;--dsw-alias-bg-layer-1:#202024;--dsw-alias-border-l1:#333}
#root{transform:translateZ(0);height:100vh;display:flex;flex-direction:column;--dsh-chat-content-width:748px}
${hostCss}
${itemCss}
#scroller{flex:1;min-height:0;overflow-y:auto}
${appearCss}
</style>
<div id="root"><div id="scroller" data-conversation-scroll>
  <div class="_7mWUNa_column" data-chat-flow>${rows}</div>
</div></div>
<pre id="out" style="position:fixed;left:0;bottom:0;max-height:30vh;overflow:auto;font-size:10px;background:#000c;color:#8f8;margin:0;padding:6px;width:100%;box-sizing:border-box"></pre>
<script>
(function () {
  var de = document.documentElement
  ${pinLine}
  ${clearLine}
  ${blurLine}
  var flow = document.querySelector('[data-chat-flow]')
  var rows = [].slice.call(document.querySelectorAll('.${PREFIX}_userRow'))
  ${markLine}
  var sc = document.getElementById('scroller')
  sc.scrollTop = sc.scrollHeight
  function run() {
    var pinned = document.querySelector('[data-cc-pin]')
    // 关掉时没有元素被标记，就没有 ::before 可量 —— 退回量"本该被钉的那一行"，
    // 这样才能断言"规则真的不生效"（底衬透明），而不是拿 null 当证据。
    var marked = pinned || document.querySelector('[data-chat-flow-key="t5"]')
    var row = rows[rows.length - 1]
    var cs = marked ? getComputedStyle(marked, '::before') : null
    var m = marked ? marked.getBoundingClientRect() : null
    var b = row ? row.querySelector('.${PREFIX}_bubble').getBoundingClientRect() : null
    var o = {
      marked: !!pinned,
      rowBg: marked ? getComputedStyle(marked).backgroundColor : null,
      rowBackdrop: marked ? (getComputedStyle(marked).backdropFilter || 'none') : null,
      plateBg: cs ? cs.backgroundColor : null,
      plateBackdrop: cs ? (cs.backdropFilter || cs.webkitBackdropFilter || 'none') : null,
      plateRadius: cs ? cs.borderRadius : null,
      platePos: cs ? cs.position + '/z' + cs.zIndex : null,
      plateW: cs ? cs.width : null,
      plateRight: cs ? cs.right : null,
      rowW: m ? Math.round(m.width) : null,
      rowRight: m ? Math.round(m.right) : null,
      plateLeftEdge: (m && cs) ? Math.round(m.right - parseFloat(cs.width)) : null,
      bubbleW: b ? Math.round(b.width) : null,
      bubbleRight: b ? Math.round(b.right) : null,
      bubbleLeft: b ? Math.round(b.left) : null,
      pinnedTop: (m && sc) ? Math.abs(m.top - sc.getBoundingClientRect().top) < 40 : null,
      blurVar: getComputedStyle(de).getPropertyValue('--cc-pin-blur').trim() || '(unset)',
      colorMix: CSS.supports('color', 'color-mix(in srgb, white 50%, transparent)')
    }
    document.getElementById('out').textContent = 'MEASURE ' + JSON.stringify(o)
  }
  // 同步量一次（--dump-dom 可能在虚拟时间跑完前就出牌），再用 rAF 覆盖一次。
  try { run() } catch (e) { document.getElementById('out').textContent = 'ERR ' + e }
  requestAnimationFrame(function () { requestAnimationFrame(run) })
})()
<\/script></html>`
}

let bad = 0
const t = (name, cond, extra) => { if (cond) { console.log('  PASS  ' + name) } else { bad++; console.log('  FAIL  ' + name + '  [' + extra + ']') } }
const alphaOf = (bg) => {
  if (typeof bg !== 'string' || !bg) return null
  // Chrome 把 color-mix() 结果留成 color(srgb r g b / .58)，也可能是 / 58% 或旧式 rgba(...)
  let m = /\/\s*([\d.]+)%\s*\)?/.exec(bg)
  if (m) return +(parseFloat(m[1]) / 100).toFixed(2)
  m = /\/\s*([\d.]+)\s*\)?/.exec(bg)
  if (m) return +Number(m[1]).toFixed(2)
  m = /^rgba?\(([^)]+)\)$/.exec(bg)
  if (m) { const ps = m[1].split(/[\s,]+/).map(parseFloat); return ps.length > 3 ? +ps[3].toFixed(2) : 1 }
  return null
}
const blurPx = (s) => { const m = /blur\(\s*([\d.]+)px\s*\)/.exec(String(s)); return m ? Number(m[1]) : NaN }

const results = {}
for (const st of STATES) {
  const file = path.join(OUT, 'probe-' + st.key + '.html')
  fs.writeFileSync(file, page(st))
  const dump = path.join(OUT, 'probe-' + st.key + '.json.txt')
  const shot = path.join(OUT, 'probe-' + st.key + '.png')
  // 每个状态用独立的 user-data-dir：共用默认 profile 时，后启动的实例会把请求转交给
  // 已存在的浏览器进程然后自己退出 —— dump-dom 就成了空文件（首轮 3 个 null 就是这么来的）。
  const profile = path.join(process.env.TEMP || OUT, 'cc-pro-' + st.key)
  fs.rmSync(profile, { recursive: true, force: true })
  const args = [
    '--headless=new', '--no-first-run', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--window-size=1280,760',
    '--virtual-time-budget=4000', '--user-data-dir=' + profile,
  ]
  const r = spawnSync(CHROME, args.concat(['--dump-dom', 'file:///' + file.replace(/\\/g, '/')]),
    { stdio: ['ignore', fs.openSync(dump, 'w'), fs.openSync(dump + '.err', 'w')] })
  const html = fs.readFileSync(dump, 'utf8')
  const m = /MEASURE (\{.*?\})<\/pre>/.exec(html)
  results[st.key] = m ? JSON.parse(m[1]) : null
  if (!m) console.log('  (chrome exit ' + r.status + ') stderr: ' + fs.readFileSync(dump + '.err', 'utf8').slice(0, 300))
  spawnSync(CHROME, args.concat(['--screenshot=' + shot, 'file:///' + file.replace(/\\/g, '/')]), { stdio: 'ignore' })
  fs.rmSync(profile, { recursive: true, force: true })
}
console.log(JSON.stringify(results, null, 1))

const off = results.off
const d = results['on-default']
const b0 = results['on-blur0']
const b20 = results['on-blur20']
const nc = results['on-noclear']
console.log('\n— 判定 —')
t('夹具本身可用（color-mix 支持）', !!d && d.colorMix === true, d && d.colorMix)
t('打开后确实钉住了（sticky 在滚动区顶部）', !!d && d.marked === true && d.pinnedTop === true, d && (d.marked + '/' + d.pinnedTop))
t('全关时没有任何底衬（::before 无背景）', !!off && alphaOf(off.plateBg) === 0, off && off.plateBg)
t('整行自身不再有背景（左侧不再被糊）', !!d && alphaOf(d.rowBg) === 0, d && d.rowBg)
t('整行自身不再有 backdrop-filter', !!d && !/blur\([1-9]/.test(String(d.rowBackdrop)), d && d.rowBackdrop)
t('底衬是半透明（0<alpha<1）', !!d && (function (a) { return a > 0 && a < 1 })(alphaOf(d.plateBg)), d && alphaOf(d.plateBg) + ' / ' + d.plateBg)
// 圆角一律 em（1.07em）⇒ 断言"是圆角且随字号走"，不再钉死 16px（v1.4.0 起尺寸全面 em 化）
t('底衬是圆角矩形（radius 用 em，实测随字号落在此区间）', !!d && (function (v) { return v >= 8 && v <= 26 })(parseFloat(d.plateRadius)), d && d.plateRadius)
t('底衬定长：明显窄于整行（左侧留干净区）', !!d && parseFloat(d.plateW) < d.rowW - 40, d && (d.plateW + ' vs row ' + d.rowW))
// 气泡改成内联盒后，"整行右缘"= 气泡文字尾端 + 图标 + 内边距；底衬贴的是整行右缘，
// 所以判定改为：底衬右缘要不早于气泡右缘（覆盖住），也不能离谱地宽（≤40px 呼吸位）。
t('底衬右缘覆盖气泡且不外露过多（0..40px）', !!d && (d.rowRight + 6) - d.bubbleRight >= 0 && (d.rowRight + 6) - d.bubbleRight <= 40, d && (d.rowRight + ' vs ' + d.bubbleRight))
t('底衬在气泡之下（z-index:-1 + absolute）', !!d && /absolute\/z-1/.test(String(d.platePos)), d && d.platePos)
t('默认模糊 = 10px（未设变量时走 CSS 兜底）', !!d && blurPx(d.plateBackdrop) === 10, d && d.plateBackdrop)
t('可调模糊度：变量 0 ⇒ blur(0px)', !!b0 && blurPx(b0.plateBackdrop) === 0, b0 && b0.plateBackdrop)
t('可调模糊度：变量 20 ⇒ blur(20px)', !!b20 && blurPx(b20.plateBackdrop) === 20, b20 && b20.plateBackdrop)
t('不透明气泡时底衬照样成立', !!nc && (function (a) { return a > 0 && a < 1 })(alphaOf(nc.plateBg)) && blurPx(nc.plateBackdrop) === 14, nc && (nc.plateBg + ' / ' + nc.plateBackdrop))
console.log('\n截图：' + OUT + '\\probe-<state>.png（肉眼核对左侧是否还糊）')
process.exitCode = bad === 0 ? 0 : 1
