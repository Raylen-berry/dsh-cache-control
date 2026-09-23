// 结构断言 + 行为断言：client 保存载荷必须与 host 的 DEFAULTS **字段对齐**。
//
// 起因（2026-09-14 审计附带发现）：v1.6.0 新增 hideResizer 时，开关、状态、host 默认值都加了，
// 唯独 client.js 的 saveNow() PUT 载荷漏了这个字段 —— 界面上拨得动、请求里却不带，
// 于是**永远不落盘**，刷新就回到旧值。这类"加了字段忘了接线"的漏，功能测试往往抓不到
// （因为状态本身是变的），但结构上一比就露。
//
// 两段对账，口径同源（都以 host 导出的 DEFAULTS 为准）：
//   ① 静态（1–3 组）：扫 client.js 源码里的载荷块 —— 快、不依赖运行时，但实现形态一改锚点就会漂
//      （v1.12.2 把 `fetch + JSON.stringify` 收进 putJson 时漂过一次：断言假失败，代码没坏）。
//   ② 行为（4 组）：真起 http 服务、真装载 client 半、真翻一次开关，看实际 PUT 提交了什么。
//      这条抓得住静态那条抓不住的东西，且不依赖源码文本。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')

// 待对齐字段以 host 的 DEFAULTS 为**单一真源**（不再在本文件里另抄一份白名单）。
// 注意 import 时机：host 里所有路径都是函数、每次现取，所以先加载再改 DSH_HOME 也安全
// （verify-ponytail-gate 第 2 组踩过"模块加载期就把路径定下来"的反面）。
const host = await import('file:///' + REPO.replace(/\\/g, '/') + '/index.js')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')) }
}

/** 从一个锚点起、到下一个以 `}` 开头的行（trim 后）为止的顶层键名。
 *  注意收尾行的缩进不一样：DEFAULTS 是行首 `}`，保存载荷是缩进的 `}),` —— 所以按
 *  "trim 后以 } 开头" 判，不能写死 '\n}'（第一版就是这么错的：找不到收尾就抛错，套件本身在红）。
 *
 *  ⚠ 必须从**函数定义处**起找，不能全文搜第一个匹配：v1.11.0 加了 setReviewEnabled() 之后，
 *  文件里出现了第二个载荷字面量（它是个单行小载荷 `{ enabled: ... }`），全文搜会命中它并
 *  解析出 1 个键 —— 于是所有对齐断言集体假失败。锚点先定位 `function saveNow()`，再在它之后找。
 *
 *  ⚠ v1.12.2 起保存载荷改由 putJson() 提交（`fetch + JSON.stringify` 那两行收进了助手），
 *  所以抓的是 `putJson('/cc/settings.json', {` 这个调用点，抓法（顶层键名逐行扫到收尾花括号）不变。 */
function keysOfBlock(text, startPattern, label, fromIndex = 0) {
  const m = startPattern.exec(text.slice(fromIndex))
  if (!m) throw new Error('没找到代码块：' + label)
  const lines = text.slice(fromIndex + m.index + m[0].length).split('\n')
  const keys = []
  for (const line of lines) {
    if (line.trim().startsWith('}')) return keys
    const k = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(line)
    if (k) keys.push(k[1])
  }
  throw new Error('代码块没有收尾大括号：' + label)
}

const PAT_PAYLOAD = /putJson\('\/cc\/settings\.json', \{/

const clientSrc = fs.readFileSync(path.join(REPO, 'client.js'), 'utf8')

// 待对齐字段：host 说了算（单一真源），静态/行为两段共用同一份。
const defaults = Object.keys(host.DEFAULTS)
const wanted = defaults
const saveNowAt = clientSrc.indexOf('function saveNow()')
const payload = keysOfBlock(clientSrc, PAT_PAYLOAD, 'client saveNow 载荷', saveNowAt)

console.log('— 1. 两边的字段集合 —')
ok('DEFAULTS 从 host 模块读到了', defaults.length >= 10, defaults.length + ' 个: ' + defaults.join(','))
ok('保存载荷解析出来了', payload.length >= 10, payload.length + ' 个: ' + payload.join(','))
// 上面那条锚点修复的回归：载荷块必须是从 saveNow() 起的那一个，不是文件里更早出现的小载荷。
ok('载荷块定位在 saveNow() 之后（没误命中别处的载荷）',
  saveNowAt >= 0 && PAT_PAYLOAD.exec(clientSrc.slice(saveNowAt)) !== null,
  'saveNow@' + saveNowAt)
ok('解析出的载荷键数 ≥ DEFAULTS 键数（只多不少 = 抓对了整块）',
  payload.length >= wanted.length,
  'payload=' + payload.length + ' defaults=' + wanted.length)

const missing = wanted.filter((k) => !payload.includes(k))
const extra = payload.filter((k) => !defaults.includes(k))

console.log('\n— 2. 静态对齐（扫源码）—')
ok('DEFAULTS 每个字段都在保存载荷里（漏了 = 拨了不落盘）', missing.length === 0, missing.length ? '缺: ' + missing.join(',') : wanted.length + ' 个全在')
ok('载荷里没有 host 不认识的字段（多了会被静默丢弃）', extra.length === 0, extra.length ? '多: ' + extra.join(',') : '无多余')
ok('hideResizer 这个具体回归已堵住（v1.6.0 漏的就是它）', payload.includes('hideResizer'))
ok('hideDivider 同样在载荷里（v1.7.0 拆出的第二个开关，别再犯同样的漏）', payload.includes('hideDivider'))
ok('reviewSkillEnabled 在载荷里（v1.11.0 的审查技能开关；它另有 /cc/review.json 一条直路，主 PUT 也得带上）',
  payload.includes('reviewSkillEnabled'))
ok('待对齐清单直接来自 host.DEFAULTS（本文件不再维护第二份白名单）',
  wanted === defaults && wanted.length === Object.keys(host.DEFAULTS).length, '待对齐=' + wanted.length)

console.log('\n— 3. 解析器的自检（防止断言因解析失败而假绿）—')
const probeDefaults = keysOfBlock('const DEFAULTS = {\n  a: 1,\n  bb: 2,\n}', /const DEFAULTS = \{/, 'probe')
ok('样例块解析正确', probeDefaults.join(',') === 'a,bb', probeDefaults.join(','))
let threw = false
try { keysOfBlock('const DEFAULTS = {\n  a: 1\n}', /const NOT_HERE = \{/, 'probe-missing') } catch { threw = true }
ok('找不到代码块时抛错而不是返回空', threw)

// ---- 4. 运行时对账：真跑设置页，抓实际 PUT 载荷 ----
// 上面 1–3 是**静态**对账（扫源码）。它们抓得住"漏了字段"，但抓不住"实现形态一变锚点就漂"
// —— v1.12.2 把 `fetch + JSON.stringify` 收进 putJson 时，锚点就漂过一次（断言假失败，代码没坏）。
// 这一段是**行为**对账：真起 http 服务、真装载 client 半、真触发一次保存，看它实际提交了什么。
// 口径更强（实际请求体 vs host 的 DEFAULTS），静态那条保留作快速失败。
console.log('\n— 4. 运行时 PUT 载荷（行为对账）—')
{
  // file:/// 前缀 + Windows 盘符：正斜杠化并去掉开头的斜杠（与 run-all.mjs 的 urlPath 同口径）
  const urlPath = (p) => {
    const s = p.replace(/\\/g, '/')
    return s.startsWith('/') ? s.slice(1) : s
  }
  const http = await import('node:http')
  const os = await import('node:os')
  const APP = process.env.DSH_APP_MODULES || 'D:/deepseek-harness/DSH Desktop/resources/app/node_modules/'
  const nodeFetch = globalThis.fetch
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  // primitives 走桩：本仓库 CI 不保证装过宿主原子包。这里要验的是**请求体字段集**，与渲染无关。
  const primitives = {
    Switch: () => null,
    Button: ({ children }) => children || null,
  }

  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-payload-'))
  process.env.DSH_HOME = ROOT
  fs.mkdirSync(path.join(ROOT, 'dsh-cache-control'), { recursive: true })
  // 最小 standard preset 夹具（结构镜像真货）：GET /cc/settings.json 会读它做"压缩参数是否已应用"，
  // 没有它就 500 ⇒ 设置页加载失败 ⇒ 不会保存，本段拿不到载荷。口径与 verify-gate-client 同。
  const presetDir = path.join(ROOT, 'profiles/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard')
  fs.mkdirSync(presetDir, { recursive: true })
  fs.writeFileSync(path.join(presetDir, 'agent.cordis.yml'), [
    '# minimal fixture for verify-settings-payload (structure mirrors the real standard preset)',
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
  ].join('\n'), 'utf8')

  const host = await import('file:///' + urlPath(path.join(REPO, 'index.js')))
  const routes = new Map()
  await host.apply({
    get: (n) => (n === 'webServer'
      ? { register(r) { routes.set(r.path, r.handler); return () => routes.delete(r.path) } } : undefined),
    effect: (fn) => fn(),
    inject: () => {},
  })
  const server = http.createServer((req, res) => {
    const handler = routes.get((req.url || '').split('?')[0])
    if (!handler) { res.writeHead(404); res.end('{}'); return }
    handler(req, res)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + server.address().port

  const puts = []
  let captured = null
  const slots = []
  globalThis.window = { __ModuleLoader__: { load: (m) => { captured = m } }, innerWidth: 1400, innerHeight: 900 }
  globalThis.document = {
    createElement: () => ({ setAttribute() {}, textContent: '', type: '' }),
    head: { appendChild() {} },
    body: { nodeName: 'BODY', appendChild() {}, contains() { return false } },
  }
  // React 自身可能捕获 globalThis.fetch：先放纯转发版，导入完再换成记录版（免得把它的调用记进来）。
  globalThis.fetch = (u, o) => nodeFetch(base + String(u), o)

  const cjs = (await import('file:///' + urlPath(path.join(APP, 'react/index.js')))).default
  const React = cjs.createElement ? cjs : (cjs.default || cjs)
  globalThis.fetch = (u, o) => {
    if (o && o.method === 'PUT' && String(u).startsWith('/cc/settings.json')) puts.push(JSON.parse(o.body || '{}'))
    return nodeFetch(base + String(u), o)
  }
  await import('file:///' + urlPath(path.join(REPO, 'client.js')) + '?payload')
  if (!captured) throw new Error('client.js did not call __ModuleLoader__.load')
  const ex = captured.factory(function (name) {
    if (name === 'react') return React
    if (name === 'react-dom') return { createPortal: (node) => node }
    if (name === 'dsh-client-ui-primitives' || name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error('unexpected require: ' + name)
  })
  ex.apply({
    get: (n) => (n === 'slots'
      ? { inject: (k, fn) => fn((entry, comp) => { slots.push({ entry, comp }); return entry }), register: (e) => e }
      : undefined),
    effect: (fn) => fn(),
  })
  await sleep(200)
  // 真触发一次保存：翻压缩开关 → scheduleSave → 250ms 去抖 → putJson('/cc/settings.json', …)
  // 先等首次 GET 落地（loaded=false 时 scheduleSave 会拒绝写盘，翻开关不会有任何请求）。
  const store = ex.internals && ex.internals.STORE
  for (let i = 0; i < 20 && store && !store.state.loaded; i++) await sleep(100)
  const flip = ex.internals && ex.internals.flipCache
  if (typeof flip === 'function') { flip(); await sleep(400) }
  const state = (store && store.state) || {}
  ok('设置页真的发了一次 PUT /cc/settings.json（不是从源码猜的）', puts.length >= 1,
    '抓到 ' + puts.length + ' 次；loaded=' + state.loaded + ' loading=' + state.loading + ' err=' + (state.error || '无'))
  const got = Object.keys(puts[0] || {})
  // 只比集合，不比顺序：载荷键序无功能意义（客户端把 shapeEnabled 写在末尾），
  // 强行同步序只会制造无意义的 diff。
  const want = Object.keys(host.DEFAULTS)
  const missingKeys = want.filter((k) => !got.includes(k))
  const extraKeys = got.filter((k) => !want.includes(k))
  ok('实际提交的字段集合与 host DEFAULTS 完全一致',
    got.length > 0 && missingKeys.length === 0 && extraKeys.length === 0,
    got.length ? '提交 ' + got.length + ' 个' : '没抓到载荷')
  ok('缺失的字段（漏一个 = 拨了不落盘）', missingKeys.length === 0, missingKeys.join(',') || '无')
  ok('多出的字段（host 会静默丢弃）', extraKeys.length === 0, extraKeys.join(',') || '无')

  await new Promise((r) => server.close(r))
  fs.rmSync(ROOT, { recursive: true, force: true })
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail === 0 ? 0 : 1)
