// 钉顶置右 / 提问气泡宽度：把**宿主编译产物里的真实 CSS** + **插件真实的 fitUserBubbles 实现**
// 一起搬进无头 Edge 里量一次。为什么必须这样量：这两轮的根因都在"谁在改宽度"上 ——
//   ① 行上写 max-width 会先把行夹死 ⇒ margin-left:auto 退化成 0 ⇒ 气泡停在左半边（看着像居中）
//   ② 旧量宽口径量的是"已经折好行的矩形" ⇒ 内联宽一旦被写小就自锁成窄框（用户实测的 192px）
// 只看截图分辨不出来。这个探针把量宽实现与 CSS 都跑起来，直接断言左右与宽度。
//
// 用法：node tools/verify-pin-width.mjs [列宽px] [提问宽度%]
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const PLUGIN = path.resolve(import.meta.dirname, '..')
const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const OUT = path.join(import.meta.dirname, 'pin-out')
const CACHE = path.join(import.meta.dirname, '.cache')
// 宿主 chat 包的编译产物（类名哈希与宿主 CSS 都在里面）。三种来源，按顺序找：
//   ① DSH_CHAT_BUNDLE 显式指定；② tools/.cache 下抽过的那份；③ 本机装了 DSH Desktop 时
//      **自己从 asar 里抽**（不依赖任何解包工具：asar 头就是个长度前缀的 JSON 目录，按偏移量切字节）。
const ASAR = process.env.DSH_ASAR || 'E:/DeepSeek Harness/resources/app.asar'
const ASAR_ENTRY = 'dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js'

/** 从 Electron asar 里切出一个文件（asar = 8B 头 + JSON 目录 + 数据段）。 */
function extractFromAsar(asarPath, entry) {
  const fd = fs.openSync(asarPath, 'r')
  try {
    const head = Buffer.alloc(16)
    fs.readSync(fd, head, 0, 16, 0)
    const jsonSize = head.readUInt32LE(12)
    const jbuf = Buffer.alloc(jsonSize)
    fs.readSync(fd, jbuf, 0, jsonSize, 16)
    const base = 16 + jsonSize
    const tree = JSON.parse(jbuf.toString('utf8'))
    const parts = entry.split('/')
    let node = tree
    for (const p of parts) {
      node = node && node.files ? node.files[p] : null
      if (!node) return null
    }
    if (!node.offset) return null
    const size = node.size
    const buf = Buffer.alloc(size)
    fs.readSync(fd, buf, 0, size, base + Number(node.offset))
    return buf
  } finally {
    fs.closeSync(fd)
  }
}

function resolveHost() {
  const explicit = process.env.DSH_CHAT_BUNDLE
  if (explicit && fs.existsSync(explicit)) return explicit
  const cached = path.join(CACHE, 'dsh-client-ui-chat-lib-client.js')
  if (fs.existsSync(cached)) return cached
  if (!fs.existsSync(ASAR)) return null
  try {
    const buf = extractFromAsar(ASAR, ASAR_ENTRY)
    if (!buf) return null
    fs.mkdirSync(CACHE, { recursive: true })
    fs.writeFileSync(cached, buf)
    return cached
  } catch (e) {
    return null
  }
}

// 缺浏览器 / 抽不出宿主 bundle 时**自己 SKIP 并退出 0**：这两样都不是本仓库能保证的，
// 换台机器不该让 CI 变红（但要把"这次没验"说清楚，见 run-all 的输出）。
const HOST = resolveHost()
if (!HOST) {
  console.log('SKIP 拿不到宿主 chat bundle：设 DSH_CHAT_BUNDLE 指到 dsh-client-ui-chat/lib/client.js，'
    + '或让默认 asar 路径存在（当前 ' + ASAR + '）')
  process.exit(0)
}
if (!fs.existsSync(EDGE)) {
  console.log('SKIP 找不到无头浏览器（未设 EDGE 且默认路径不存在）：' + EDGE)
  process.exit(0)
}
fs.mkdirSync(OUT, { recursive: true })

const host = fs.readFileSync(HOST, 'utf8')
const grab = (name) => {
  const re = new RegExp('\\.([A-Za-z0-9_$]{4,12})_' + name + '\\{[^}]*\\}', 'g')
  return [...new Set([...host.matchAll(re)].map((m) => m[0]))].join('\n')
}
const hostCss = ['userRow', 'userStack', 'bubble', 'flowItem', 'actions'].map(grab).join('\n')
if (!/userRow/.test(hostCss) || !/flowItem/.test(hostCss)) throw new Error('宿主 CSS 抽取失败')

const src = fs.readFileSync(path.join(PLUGIN, 'client.js'), 'utf8')
const cssStart = src.indexOf('var CSS = [')
const cssEnd = src.indexOf("].join('\\n')", cssStart)
if (cssStart < 0 || cssEnd < 0) throw new Error('插件 CSS 数组没截到')
const pluginCss = eval(src.slice(cssStart + 'var CSS = '.length, cssEnd + 1)).join('\n')

/** 按大括号配对截取函数体（跳过字符串/注释），拿到的就是线上那份实现。 */
function grabFn(name) {
  let i = src.indexOf('function ' + name + '(')
  if (i < 0) { const eq = src.indexOf(name + ' = function'); if (eq >= 0) i = src.indexOf('function', eq) }
  if (i < 0) throw new Error('client.js 里找不到 ' + name)
  const open = src.indexOf('{', i)
  let depth = 0, k = open, str = '', esc = false, line = false, block = false
  for (; k < src.length; k++) {
    const c = src[k], nx = src[k + 1]
    if (line) { if (c === '\n') line = false; continue }
    if (block) { if (c === '*' && nx === '/') { block = false; k++ } continue }
    if (str) { if (esc) { esc = false; continue } if (c === '\\') { esc = true; continue } if (c === str) str = ''; continue }
    if (c === '/' && nx === '/') { line = true; k++; continue }
    if (c === '/' && nx === '*') { block = true; k++; continue }
    if (c === '"' || c === "'" || c === '`') { str = c; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) { k++; break } }
  }
  return src.slice(i, k)
}
const FIT_ICON_H = Number((src.match(/var FIT_ICON_H = (\d+)/) || [])[1]) || 22
const jsFns = 'var FIT_ICON_H = ' + FIT_ICON_H + ';\n'
  + 'var APPEAR_ATTRS = { pin: "data-cc-pin", on: "1" };\n'
  + 'var fitNaturalCache = (typeof WeakMap === "function") ? new WeakMap() : null;\n'
  // v1.16.16：宽度上限改由 applyStackCap 逐条写 inline，它读 STORE.state 里的两个百分比。
  + 'var STORE = { state: { outputCapEnabled: false, pinWidthPct: ' + (process.argv[7] || 0 || process.argv[3] || 58) + ', userWidthPct: ' + (process.argv[3] || 58) + ' } };\n'
  + 'function clampPinWidthPct(v){ v = Math.round(Number(v)); if (!Number.isFinite(v) || v <= 0) v = 55; return Math.min(100, Math.max(30, v)) }\n'
  + 'function clampUserWidthPct(v){ v = Math.round(Number(v)); if (!Number.isFinite(v) || v <= 0) v = 58; return Math.min(100, Math.max(30, v)) }\n'
  + 'function domReady(){ return true }\n'
  + 'function warnOnce(){}\n'
  + grabFn('lineBoxes') + '\n'
  + grabFn('naturalBubbleWidth') + '\n'
  + grabFn('updatePinPlate') + '\n'
  + grabFn('applyOutputCap') + '\n'
  + grabFn('applyStackCap') + '\n'
  + grabFn('fitUserBubbles')

const COL_W = Number(process.argv[2] || 1140)
const USER_PCT = Number(process.argv[3] || 58)
// 会话列宽 = 会话区宽 × 对话页宽度%。默认等于会话区宽（= 对话页 100%）；传 80 验证
// 「对话页 80% × 气泡 80% = 会话区的 64%」（用户第七轮）。
const CHAT_PCT = Number(process.argv[6] || 0)
// 钉顶那条的宽度上限（「钉顶气泡宽度」滑杆）。默认与 USER_PCT 相同；分开传就能验证
// "两个滑杆各管各的"（用户第八轮：原来两个滑杆共用一个变量，提问滑杆实际在控钉顶）。
const PIN_PCT_CAP = Number(process.argv[7] || 0) || USER_PCT
// 参数位：argv[2]=会话区px argv[3]=提问气泡% argv[4]=正文重复次数 argv[5]=变体
//        argv[6]=对话页% argv[7]=钉顶气泡%
const COL_ACTUAL = CHAT_PCT > 0 ? Math.round(COL_W * CHAT_PCT / 100) : COL_W
const TEXTS = [
  ['t1', '短'],
  ['t2', '中等长度的一条提问，大概三十来个字，气泡应当刚好包住它不折行。'.repeat(1)],
  ['t3', '很长的提问正文：' + '用来观察气囊宽度上限与折行行为是否合理。'.repeat(24)],
]

// 第一条行模拟"被钉住的那条"（`data-cc-pin="1"` ⇒ 吃 --cc-pin-width-cap）；
// 其余两条是普通提问气泡（吃 --cc-user-width-pct）。两个滑杆必须各管各的（用户第八轮）。
// POLL_ONLY=1（argv[8]=1）时只渲染第一条 —— 复现用户第九轮那个"页面上只有一条（新会话/折叠历史）"
// 的场景：那条同时是"最近提问"与"钉顶那条"，必须只跟钉顶滑杆。
const ONLY_ONE = Number(process.argv[8] || 0) === 1
const ROWS_USED = ONLY_ONE ? TEXTS.slice(0, 1) : TEXTS
const rows = ROWS_USED.map(([id, text], i) => `
    <div class="xz4KEq_flowItem" id="pick-${id}"${i === 0 ? ' data-cc-pin="1"' : ''}>
      <div class="cJsG2q_userRow" id="row-${id}">
        <div class="cJsG2q_userStack" id="stack-${id}">
          <div class="cJsG2q_bubble" id="bubble-${id}">${text}</div>
        </div>
        <div class="xD_KDq_actions"><span class="xD_KDq_timeStart">09:41</span><button type="button" class="xD_KDq_action">c</button></div>
      </div>
    </div>`).join('')

const page = `<!doctype html><html data-cc-pin-last-user="1" style="--cc-user-width-pct:${USER_PCT};--cc-pin-width-pct:${PIN_PCT_CAP};--cc-pin-width-cap:${PIN_PCT_CAP};--cc-area-w:${COL_W}px;--cc-col-w:${COL_ACTUAL}px;--dsh-chat-content-width:${COL_W}px;--dsh-content-font-size:15px">
<head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#101216;color:#e8e8e8;font-family:"Microsoft YaHei",system-ui;font-size:15px}
#scroll{width:${COL_W}px;height:800px;overflow-y:auto;margin:0 auto;border:1px dashed #555}
#col{max-width:var(--dsh-chat-content-width);width:100%;margin:0 auto;display:flex;flex-direction:column}
${hostCss}
${pluginCss}
</style></head>
<body>
<div id="scroll"><div id="col" data-chat-flow="">${rows}</div></div>
<pre id="out"></pre>
<script>
${jsFns}
(function () {
  function R(el){ var r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) } }
  function run(){
    var col = document.getElementById('col')
    // 模拟"对话页宽度 = CHAT_PCT%"：会话区还是 COL_W，但消息列被压到 COL_ACTUAL。
    // 列宽由**两个来源**共同表示，装到页面上就都要写：CSS 变量（气泡基数）与实际 max-width。
    var root = document.documentElement
    if (${CHAT_PCT} > 0) {
      root.style.setProperty('--cc-col-w', '${COL_ACTUAL}px')
      col.style.maxWidth = '${COL_ACTUAL}px'
    }
    var colRight = Math.round(col.getBoundingClientRect().right)
    var res = { colW: ${COL_W}, colActual: Math.round(col.getBoundingClientRect().width), chatPct: ${CHAT_PCT}, userPct: ${USER_PCT}, pinPct: ${PIN_PCT_CAP}, items: {} }
    try { res.fit = fitUserBubbles() } catch (e) { res.err = String(e && e.stack || e) }
    for (var i = 0; i < ${ROWS_USED.length}; i++) {
      var id = ${JSON.stringify(ROWS_USED.map(([id]) => id))}[i]
      var row = document.getElementById('row-' + id)
      var stack = document.getElementById('stack-' + id)
      var bubble = document.getElementById('bubble-' + id)
      var picks = document.getElementById('pick-' + id)
      res.items[id] = {
        textLen: (bubble.textContent || '').length,
        row: R(row), stack: R(stack), bubble: R(bubble), pick: R(picks),
        gapRight: colRight - R(bubble).r,
        stackInline: stack.style.width || '(none)',
        rowDisplay: getComputedStyle(row).display,
        stackMaxW: getComputedStyle(stack).maxWidth,
        // v1.16.8：钉顶那层自己**不能有任何宽度上限** —— 它是行右对齐的天花板。
        // 线上实测就是这里被 em"保险"夹成 688px（列 1476），行再 auto 也只能贴到列中间。
        pickMaxW: getComputedStyle(picks).maxWidth,
        pickWidthCss: getComputedStyle(picks).width,
        bubbleLines: (function () {
          try { var r = document.createRange(); r.selectNodeContents(bubble)
            var rects = r.getClientRects(), tops = {}
            for (var j = 0; j < rects.length; j++) if (rects[j].width > 0) tops[Math.round(rects[j].top)] = 1
            return Object.keys(tops).length
          } catch (e) { return -1 }
        })()
      }
    }
    document.getElementById('out').textContent = 'MEASURE ' + JSON.stringify(res)
  }
  try { run() } catch (e) { document.getElementById('out').textContent = 'MEASURE ' + JSON.stringify({ err: String(e && e.stack || e) }) }
})()
<\/script></body></html>`

const file = path.join(OUT, 'pin.html')
fs.writeFileSync(file, page)
const profile = path.join(OUT, 'prof')
fs.rmSync(profile, { recursive: true, force: true })
const args = ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--window-size=1500,1000', '--virtual-time-budget=3000', '--user-data-dir=' + profile, '--dump-dom',
  'file:///' + file.replace(/\\/g, '/')]
const r = spawnSync(EDGE, args, { encoding: 'utf8', maxBuffer: 1 << 28 })
fs.rmSync(profile, { recursive: true, force: true })
const m = /MEASURE (\{.*?\})<\/pre>/s.exec(r.stdout || '')
if (!m) { console.log('no measure（页面脚本没跑完）\n' + (r.stdout || '').slice(-600)); process.exit(1) }
const J = JSON.parse(m[1])
if (J.err) { console.log('页面脚本抛错: ' + J.err); process.exit(1) }

let fail = 0
const t = (name, cond, extra = '') => { if (!cond) fail++; console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  [' + extra + ']' : '')) }
console.log('会话区 ' + J.colW + ' · 消息列 ' + J.colActual + '（对话页 ' + (J.chatPct || 100) + '%）· 提问气泡 ' + J.userPct + '% · 钉顶气泡 ' + J.pinPct + '% · fit ' + J.fit + ' 条')
for (const id of Object.keys(J.items)) {
  const it = J.items[id]
  console.log('  ' + id + ' 字数=' + it.textLen + ' 行数=' + it.bubbleLines
    + ' · row ' + it.row.l + '-' + it.row.r + ' w' + it.row.w
    + ' · stack w' + it.stack.w + ' 内联[' + it.stackInline + '] maxW[' + it.stackMaxW + ']'
    + ' · bubble w' + it.bubble.w + ' · 右缘差 ' + it.gapRight)
}
const ids = Object.keys(J.items)
// ① 右对齐：气泡右缘与列右缘的差 = 图标轨道（>0 且远小于列宽），绝不能是"半个列宽"
for (const id of ids) {
  const g = J.items[id].gapRight
  t(id + '：气泡贴右（右缘差在 0–48px，不是居中）', g >= 0 && g <= 48, 'gapRight=' + g + '，列宽=' + J.colW)
}
// ② 宽度随文字增长（短句贴文字），且不超过上限（只在渲染满三条时才有意义）
if (ids.length >= 3) {
  const w1 = J.items[ids[0]].bubble.w, w2 = J.items[ids[1]].bubble.w, w3 = J.items[ids[2]].bubble.w
  t('宽度随文字增长（短 < 中 ≤ 长）', w1 < w2 && w2 <= w3 + 1, [w1, w2, w3].join(' < '))
  const cap = Math.round(J.colW * J.userPct / 100)
  t('长句不超过设定上限 ' + cap + 'px', w3 <= cap + 1, 'w3=' + w3)
}
// ③ 行右缘必须落在列右缘上（"右侧车道"）。行是 fit-content，短句时它比列窄是**正确**的
//    （宽度由栈/气泡决定）；真正要拦的是"行被推去左边/居中"。
for (const id of ids) {
  const it = J.items[id]
  const colRight = it.bubble.r + it.gapRight
  const rowGap = colRight - it.row.r
  t(id + '：行贴列右缘（右缘差 0–48px）', J.items[id].rowDisplay === 'block' && rowGap >= 0 && rowGap <= 48,
    'row右缘差=' + rowGap + ' display=' + it.rowDisplay + ' row.w=' + it.row.w)
}
// ④ 栈的内联宽 = 希望的自然宽，不能被写成明显偏小的值（192px 那类）
for (const id of ids) {
  const it = J.items[id]
  const inline = parseFloat(it.stackInline)
  t(id + '：栈内联宽不是被限死的错值', !(inline > 0) || inline >= it.bubble.w - 1, 'inline=' + it.stackInline + ' bubble=' + it.bubble.w)
}
// ⑤ v1.16.8 的关键回归：钉顶那层（flowItem）自己不许有任何宽度上限。
//    线上实测它是 688px（列 1476）⇒ 行再 auto 也只能贴到列中间。这条断言就是为了锁死这个坑。
for (const id of ids) {
  const it = J.items[id]
  const mw = it.pickMaxW
  const capped = mw !== 'none' && parseFloat(mw) < J.colW - 4
  t(id + '：钉顶那层没有被夹窄（maxWidth=' + mw + '）', !capped, 'pick w=' + it.pick.w + ' / 列 ' + J.colW)
  t(id + '：钉顶那层撑满列宽（它是行右对齐的天花板）', it.pick.w >= J.colW - 8 && it.pick.w <= J.colW + 8,
    'pick.w=' + it.pick.w + ' 列=' + J.colW)
}
// ⑥ v1.16.12：两个宽度滑杆**各管各的**（用户第八轮）——
//    第一条是"被钉住那条"，宽度上限由「钉顶气泡宽度」决定；其余是普通气泡，由「提问气泡宽度」决定。
//    以前两者共用 --cc-user-width-pct，于是"提问气泡宽度"实际在控钉顶、普通气泡没有 UI 可调。
//    断言看的是**计算出来的 max-width**（旋钮真的接到哪条规则），短消息实测宽会小于上限是正常的。
{
  const pinned = J.items[ids[0]]
  const normalLong = J.items[ids[2]] || null
  const pinnedCss = parseFloat(pinned.stackMaxW)
  const pinnedCap = Math.round(J.colActual * J.pinPct / 100)
  const userCap = Math.round(J.colActual * J.userPct / 100)
  t('钉顶那条的宽度上限 = 「钉顶气泡宽度」' + J.pinPct + '%（' + pinnedCss + 'px ≈ ' + pinnedCap + '）',
    Math.abs(pinnedCss - pinnedCap) <= 2, 'maxW=' + pinned.stackMaxW + ' 期望=' + pinnedCap)
  // v1.16.13 的关键一条：页面上**只有一条**（新会话 / 折叠历史）时，它既是最新提问又被钉住，
  // 必须**只**跟钉顶滑杆走 —— 拖「提问气泡宽度」不该再动它。
  if (!normalLong) {
    t('只有一条时：它只认「钉顶气泡宽度」，不被「提问气泡宽度」' + J.userPct + '% 影响',
      Math.abs(pinnedCss - pinnedCap) <= 2 && Math.abs(pinnedCss - userCap) > 2,
      'pinCap=' + pinnedCap + ' userCap=' + userCap + ' maxW=' + pinned.stackMaxW)
  }
  if (normalLong) {
    const normalCss = parseFloat(normalLong.stackMaxW)
    t('普通提问气泡的宽度上限 = 「提问气泡宽度」' + J.userPct + '%（' + normalCss + 'px ≈ ' + userCap + '）',
      Math.abs(normalCss - userCap) <= 2, 'maxW=' + normalLong.stackMaxW + ' 期望=' + userCap)
  }
  if (J.pinPct !== J.userPct && normalLong) {
    const normalCss = parseFloat(normalLong.stackMaxW)
    t('两条上限不同 ⇒ 两条规则真的分开（不再共用一个变量）',
      Math.abs(pinnedCss - normalCss) > 4, 'pinned=' + pinnedCss + ' normal=' + normalCss)
    t('长消息的实测宽也分开（钉顶 ' + pinned.bubble.w + ' vs 普通 ' + normalLong.bubble.w + '）',
      Math.abs(normalLong.bubble.w - pinned.bubble.w) > 4,
      'pinned=' + pinned.bubble.w + ' normal=' + normalLong.bubble.w)
  }
}
console.log(fail === 0 ? '\n全部通过' : '\n有 ' + fail + ' 条失败')
process.exitCode = fail === 0 ? 0 : 1
