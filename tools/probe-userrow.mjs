// 用户消息行保真探针（第 3 版）：宿主真实 CSS + 插件真实 CSS + **插件真实 JS 函数**
// （从 client.js 源码抽出 lineBoxes / fitUserBubbles 注入页面，跑的就是线上那份实现）。
// 判定：① 框宽 = 最宽文字行 + 内边距（贴文字，无死宽度）
//       ② 复制键到"最后一个字"的距离（跟着字尾走，不占位顶远）
//       ③ 上下留白相等 ⇒ 文字在框内垂直居中
//       ④ 任何容器宽度下文字都不越框。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const HERE = import.meta.dirname
const CHAT = process.env.DSH_CHAT_BUNDLE || 'D:/deepseek-harness/DSH Desktop/resources/app/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js';
const APP = process.env.DSH_APP_MODULES || 'D:/deepseek-harness/DSH Desktop/resources/app/node_modules/';
const PLUGIN = process.env.DSH_CC_PLUGIN || 'D:/DeepSeek/dsh-plugins/dsh-cache-control/';
const OUT = path.join(HERE, 'userrow-out')
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
fs.mkdirSync(OUT, { recursive: true })

const bundle = fs.readFileSync(CHAT, 'utf8')
// 整串 css15 含转义引号会被粗暴截断(上一版探针的坑)，只按"完整规则"抽需要的段落。
function grabRules(text, prefix, names) {
  let out = ''
  for (const n of names) {
    const hits = text.match(new RegExp('\\.' + prefix + '_' + n + '\\{[^}]*\\}', 'g')) || []
    out += hits.join('\n')
  }
  return out
}
const hostCss = grabRules(bundle, 'uSmzmW', ['userRow', 'userStack', 'bubble'])
  + '\n' + grabRules(bundle, 'npc0Lq', ['actions', 'timeStart', 'timeEnd', 'action'])
if (!hostCss.includes('_userRow') || !hostCss.includes('npc0Lq_actions')) throw new Error('宿主规则抽取失败')

// ---- 插件全量 CSS：boot client 捕获注入的样式文本 ----
const unwrap = (m) => (m && m.default && m.default.createElement) ? m.default : m
const React = unwrap(await import('file:///' + APP + 'react/index.js'))
let capCss = ''
globalThis.window = { __ModuleLoader__: { load: (m) => { globalThis.__cap = m } }, innerWidth: 1400, innerHeight: 900 }
globalThis.document = {
  createElement: () => ({ setAttribute() {}, textContent: '', type: '' }),
  head: { appendChild: (el) => { if (el && el.textContent) capCss += el.textContent + '\n' } },
  body: { nodeName: 'BODY', appendChild() {}, contains() { return false } },
}
globalThis.fetch = () => Promise.reject(new Error('offline'))
await import('file:///' + PLUGIN + 'client.js?ur' + Date.now())
if (!globalThis.__cap) throw new Error('client.js 未注册 factory')
const ex = globalThis.__cap.factory((name) => {
  if (name === 'react') return React
  if (name === 'react-dom') return { createPortal: (n) => n }
  throw new Error('bad require ' + name)
})
ex.apply({ get: () => undefined, effect: (fn) => fn() })
const pluginCss = capCss

// ---- 插件真实 JS 函数源码（花括号配对截取，保证浏览器里跑的是同一份实现）----
const src = fs.readFileSync(PLUGIN + 'client.js', 'utf8')
function grabFn(name) {
  const at = src.indexOf('function ' + name + '(')
  if (at < 0) throw new Error('client.js 里找不到 ' + name)
  let depth = 0, i = src.indexOf('{', at), end = -1
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
  }
  if (end < 0) throw new Error(name + ' 花括号不配对')
  return src.slice(at, end)
}
const FIT_ICON_H = Number((src.match(/var FIT_ICON_H = (\d+)/) || [])[1])
const BUBBLE_MAX = Number((src.match(/var USER_BUBBLE_MAX_PX = (\d+)/) || [])[1])
if (!FIT_ICON_H || !BUBBLE_MAX) throw new Error('常量没抓到: FIT_ICON_H=' + FIT_ICON_H + ' MAX=' + BUBBLE_MAX)
const jsFns = 'var FIT_ICON_H = ' + FIT_ICON_H + ';\n' + grabFn('lineBoxes') + '\n' + grabFn('fitUserBubbles')
console.log('pluginCss len=' + pluginCss.length + ' BUBBLE_MAX=' + BUBBLE_MAX + ' FIT_ICON_H=' + FIT_ICON_H + ' jsFns len=' + jsFns.length)

const SHORT = '这条短消息应该很窄。'
const MID = '中等长度的一条提问，大概三十来个字，气泡应当刚好包住它。'
const LONG = '很长的正文：' + '用来观察框是否贴住最宽那一行、文字是否始终在框内垂直居中、复制图标是否紧跟最后一个字。'.repeat(12)

function rowOf(id, text, boxW) {
  return `<div style="width:${boxW};margin-bottom:18px" data-case="${id}">
    <div class="uSmzmW_userRow">
      <div class="uSmzmW_userStack">
        <div class="uSmzmW_bubble">${text}</div>
      </div>
      <div class="npc0Lq_actions uSmzmW_actions">
        <span class="npc0Lq_timeStart">09:41</span>
        <button type="button" class="npc0Lq_action" aria-label="copy"><svg width="16" height="16" viewBox="0 0 16 16"><rect x="3" y="3" width="9" height="9" rx="1.5" fill="none" stroke="currentColor"/><path d="M6 6h6v6" fill="none" stroke="currentColor"/></svg></button>
      </div>
    </div>
  </div>`
}

const page = `<!doctype html><html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#101216;color:#e8e8e8;font-family:"Microsoft YaHei","PingFang SC",system-ui}
#root{width:1180px;margin:0 auto;padding:18px 0;--dsh-chat-content-width:1180px;--dsh-content-font-size:15px;--cc-user-bubble-max:${BUBBLE_MAX}px}
${hostCss}
${pluginCss}
</style>
<div id="root">
${rowOf('short', SHORT, '100%')}
${rowOf('mid', MID, '100%')}
${rowOf('long', LONG, '100%')}
${rowOf('narrow', LONG, '420px')}
</div>
<pre id="out"></pre>
<script>
${jsFns}
(function () {
  function R(el){ var r = el.getBoundingClientRect(); return { w: Math.round(r.width*10)/10, top: Math.round(r.top*10)/10, bottom: Math.round(r.bottom*10)/10, left: Math.round(r.left*10)/10, right: Math.round(r.right*10)/10 } }
  function check(id){
    var wrap = document.querySelector('[data-case="'+id+'"]')
    var bubble = wrap.querySelector('.uSmzmW_bubble')
    var actions = wrap.querySelector('.npc0Lq_actions')
    var copy = actions.querySelector('.npc0Lq_action')
    var lines = lineBoxes(bubble)
    var br = R(bubble), cr = R(copy)
    var widestRight = 0, leftest = Infinity
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].right > widestRight) widestRight = lines[i].right
      if (lines[i].left < leftest) leftest = lines[i].left
    }
    var first = lines[0], last = lines[lines.length - 1]
    var cs = getComputedStyle(bubble)
    return {
      lines: lines.length,
      bubbleW: br.w,
      expectW: Math.round(widestRight - leftest + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)),
      padTop: Math.round((first.top - br.top) * 10) / 10,
      padBottom: Math.round((br.bottom - last.bottom) * 10) / 10,
      tailGap: Math.round((cr.left - last.right) * 10) / 10,
      // 复制键应在**气泡右侧的轨道**里：与气泡右缘的间距 0..16，且完全让开最后一行文字
      headGap: Math.round((cr.left - br.right) * 10) / 10,
      clearsLastLine: cr.left >= last.right - 1,
      tailOnLastLine: cr.top >= last.top - 8 && cr.bottom <= last.bottom + 8,
      timeW: Math.round(R(actions.querySelector('.npc0Lq_timeStart')).w),
      inside: lines.every(function(L){ return L.right <= br.right + 1 && L.left >= br.left - 1 && L.top >= br.top - 1 && L.bottom <= br.bottom + 1 })
    }
  }
  function run() {
    var n = 0
    try { n = fitUserBubbles(); n = fitUserBubbles() }         // 跑两遍: 第二遍应命中签名缓存
    catch (e) { document.getElementById('out').textContent = 'ERR ' + e; return }
    var out
    try {
      out = { fit: n, viewport: window.innerWidth, bubbleMax: ${BUBBLE_MAX},
        short: check('short'), mid: check('mid'), long: check('long'), narrow: check('narrow') }
    } catch (e) { out = { err: String(e) } }
    document.getElementById('out').textContent = 'MEASURE ' + JSON.stringify(out)
  }
  try { run() } catch (e) { document.getElementById('out').textContent = 'ERR ' + e }
  requestAnimationFrame(function () { requestAnimationFrame(run) })
})()
<\/script></html>`

const file = path.join(OUT, 'probe-userrow.html')
fs.writeFileSync(file, page)
const dump = path.join(OUT, 'probe-userrow.json.txt')
const shot = path.join(OUT, 'probe-userrow.png')
const profile = path.join(process.env.TEMP || OUT, 'ur-prof')
fs.rmSync(profile, { recursive: true, force: true })
const args = ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--window-size=1280,1500', '--virtual-time-budget=4000', '--user-data-dir=' + profile]
spawnSync(CHROME, args.concat(['--dump-dom', 'file:///' + file.replace(/\\/g, '/')]),
  { stdio: ['ignore', fs.openSync(dump, 'w'), fs.openSync(dump + '.err', 'w')] })
spawnSync(CHROME, args.concat(['--screenshot=' + shot, 'file:///' + file.replace(/\\/g, '/')]), { stdio: 'ignore' })
fs.rmSync(profile, { recursive: true, force: true })
const html = fs.readFileSync(dump, 'utf8')
const m = /MEASURE (\{.*?\})<\/pre>/.exec(html)
if (!m) { console.log('no measure; err: ' + fs.readFileSync(dump + '.err', 'utf8').slice(0, 400)); process.exit(1) }
const J = JSON.parse(m[1])
console.log(JSON.stringify(J, null, 1))

let fail = 0
const t = (n, c, x = '') => { if (!c) fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')) }
t('fitUserBubbles 处理了 4 条', J.fit === 4, 'fit=' + J.fit)
for (const k of ['short', 'mid', 'long', 'narrow']) {
  const C = J[k]
  t(k + ': 框宽 = 最宽行 + 内边距(±3px)', Math.abs(C.bubbleW - C.expectW) <= 3, C.bubbleW + ' vs ' + C.expectW)
  t(k + ': 文字全在框内', C.inside === true)
  t(k + ': 上下留白相等(垂直居中)', Math.abs(C.padTop - C.padBottom) <= 1.5, C.padTop + '/' + C.padBottom)
  t(k + ': 复制键在气泡右侧轨道内(距框缘 0..16px)', C.headGap >= 0 && C.headGap <= 16 && C.clearsLastLine === true, 'headGap=' + C.headGap)
  t(k + ': 复制键与最后一行同高', C.tailOnLastLine === true, 'tailGap=' + C.tailGap)
  t(k + ': 时间戳零占位', C.timeW === 0, 'w=' + C.timeW)
}
t('三档宽度递增(动态跟随文字)', J.short.bubbleW < J.mid.bubbleW && J.mid.bubbleW < J.long.bubbleW,
  [J.short.bubbleW, J.mid.bubbleW, J.long.bubbleW].join(' < '))
t('长文顶到上限即停(≤' + J.bubbleMax + ')', J.long.bubbleW <= J.bubbleMax + 1, String(J.long.bubbleW))
console.log('截图: ' + shot)
process.exitCode = fail === 0 ? 0 : 1
