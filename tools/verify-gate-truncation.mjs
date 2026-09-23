// 套件：规则文本被截断时的**三元事实** —— 原始长度 / 保留长度 / 截断标记。
//
// 缺陷（另一轮只读审计发现，本套件就是它的回归）：
//   host 侧的截断函数只返回一个字符串，界面上"是否截断"是**靠长度猜**的 ——
//   `truncated: bytes >= GATE_MAX_BYTES`。但截断后的长度必然**小于**上限
//   （当年按 6 KB 上限实测：19,998 字节的中文规则 → 保留 5,839 字节；10,000 字节 ASCII → 保留 5,590 字节。
//   上限现已提到 16 KB，故本套件的样本与期望值一律相对上限生成，不再写死字节数），
//   于是 `bytes >= max` 恒为 false ⇒ 规则被砍了，界面却显示"未截断"，用户不知道自己的规则少了内容。
//   反方向同样错：原文**恰好**等于上限时文本原样返回、`bytes === max`，那个判据又会
//   把没被截断的判成截断。（当年那批审计数字取自 6,144 B 上限，仅作历史记录。）
//
// 修法：截断函数改为**直接返回** `{ text, originalBytes, keptBytes, truncated }`，
//   gateMeta 与两个 HTTP 响应原样带出这三个事实；调用方与界面一律读标记，不再比长度。
//   老字段（bytes / maxBytes / lines / text / source / …）一个不动，老客户端不受影响。
//
// 本套件在临时 DSH_HOME 里跑，绝不动 %APPDATA% 下那份真实 settings.json / gate.md / preset。
// 反向验证：`DSH_CC_INDEX` 指到改动前的 index.js 即可（见仓库 README「验证」节）——
//   本套件在旧实现上**必须失败**，否则说明它没有真的盯住这个缺陷（"假绿"）。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-trunc-'))
process.env.DSH_HOME = HOME
// DSH_CC_INDEX 供反向验证用：指向别处的 index.js 副本（默认是本仓库这一份）。
const MOD = process.env.DSH_CC_INDEX || 'D:/DeepSeek/dsh-plugins/dsh-cache-control/index.js'
const m = await import('file:///' + MOD + '?t' + Date.now())

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')) }
}
const J = (o) => JSON.stringify(o).slice(0, 160)
const B = (s) => Buffer.byteLength(s, 'utf8')

// ---- 盘面：临时 home + 一份最小 preset（GET /cc/settings.json 会读它，缺了就 500）----
const presetFile = path.join(HOME, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets', 'standard', 'agent.cordis.yml')
fs.mkdirSync(path.dirname(presetFile), { recursive: true })
fs.writeFileSync(presetFile, [
  'realm:',
  '  - id: compaction',
  '    items:',
  '      - id: compaction-basic',
  "        name: '@deepseek-ai/dsh-compaction-basic'",
  '',
].join('\n'), 'utf8')
const gateFile = path.join(HOME, 'dsh-cache-control', 'gate.md')
fs.mkdirSync(path.dirname(gateFile), { recursive: true })
// HTTP 路由读的是盘上的 settings.json（不是内存里的）⇒ 先落一份"门禁开"的盘面，
// 免得断言里的 enabled 与实际响应不是同一个来源。
fs.writeFileSync(path.join(HOME, 'dsh-cache-control', 'settings.json'),
  JSON.stringify({ gateEnabled: true, enabled: false, triggerPct: 25, retainPct: 5, auto: true }), 'utf8')

const settingsOn = m.sanitize({ gateEnabled: true })
/** 直接落盘一份规则（不经 writeGateOverride），并取回 host 眼中的元信息。 */
const putRule = async (text) => {
  fs.writeFileSync(gateFile, text, 'utf8')
  return m.gateMeta(settingsOn)
}
const ON_LIMIT = m.GATE_MAX_BYTES ?? 16 * 1024

// ---- ① 超长规则：标记必须为真，并带上原始长度与保留长度 ----
console.log('— ① 超长规则（上限 + 若干 KB）—')
// 样本长度全部相对 ON_LIMIT 生成：上限本身可调（见 index.js GATE_MAX_BYTES），
// 写死字节数的样本会在上限变化时失效（6 KB → 16 KB 时踩过：19,998 B 的样本
// 原先"超长"，上限提到 16 KB 后 keptBytes 不再是 5,839）。
const cnRule = '规'.repeat(Math.ceil((ON_LIMIT + 3000) / 3))   // 中文，约 上限 + 3 KB
const cn = await putRule(cnRule)
ok('① 超长中文 ⇒ truncated === true', cn.truncated === true, J({ flag: cn.truncated, bytes: cn.bytes }))
ok('① 超长中文 ⇒ originalBytes 是规则原文长度',
  cn.originalBytes === B(cnRule), J({ originalBytes: cn.originalBytes, expect: B(cnRule) }))
ok('① 超长中文 ⇒ keptBytes 落在 (0.85×上限, 上限]、且与 bytes 恒等',
  cn.keptBytes <= ON_LIMIT && cn.keptBytes > ON_LIMIT * 0.85 && cn.bytes === cn.keptBytes,
  J({ keptBytes: cn.keptBytes, max: ON_LIMIT }))
ok('① 保留长度确有缩水（不是"标了截断但内容没动"）',
  cn.keptBytes < cn.originalBytes && B(cn.text) === cn.keptBytes && cn.text.includes('其余部分已省略'),
  J({ kept: cn.keptBytes, orig: cn.originalBytes }))
// 这条是**假绿的照妖镜**：旧判据（bytes >= max）在同一个样本上会给出 false。
ok('① 该样本正是旧判据会漏判的那类：bytes < maxBytes 而标记为 true',
  cn.bytes < cn.maxBytes && cn.truncated === true, J({ bytes: cn.bytes, max: cn.maxBytes, flag: cn.truncated }))

const asciiRaw = 'a'.repeat(ON_LIMIT + 4096)
const ascii = await putRule(asciiRaw)
ok('① 超长 ASCII ⇒ truncated === true 且原始/保留长度都带出',
  ascii.truncated === true && ascii.originalBytes === B(asciiRaw) && ascii.bytes === ascii.keptBytes,
  J({ flag: ascii.truncated, orig: ascii.originalBytes, kept: ascii.keptBytes }))
ok('① ASCII 该样本同样会让旧判据漏判（bytes 必然小于上限）',
  ascii.bytes < ascii.maxBytes && ascii.truncated === true, J({ bytes: ascii.bytes, max: ascii.maxBytes }))

// ---- ② 恰好等于上限：不能截断，标记必须为假 ----
console.log('— ② 边界：恰好等于上限 —')
const exactText = 'x'.repeat(ON_LIMIT)
const exact = await putRule(exactText)
ok('② 恰好 ' + ON_LIMIT + ' B ⇒ truncated === false', exact.truncated === false, J({ flag: exact.truncated, bytes: exact.bytes }))
ok('② 恰好到上限时内容原样（逐字节相同）', exact.text === exactText && exact.bytes === ON_LIMIT, J({ bytes: exact.bytes }))
ok('② 恰好到上限时 originalBytes === keptBytes === bytes',
  exact.originalBytes === ON_LIMIT && exact.keptBytes === ON_LIMIT && exact.bytes === ON_LIMIT,
  J({ orig: exact.originalBytes, kept: exact.keptBytes, bytes: exact.bytes }))
// 反方向的照妖镜：旧判据（bytes >= max）在这里会误报"已截断"。
ok('② 该样本正是旧判据会误报的那类：bytes === maxBytes 而标记为 false',
  exact.bytes >= exact.maxBytes && exact.truncated === false, J({ bytes: exact.bytes, max: exact.maxBytes }))

// ---- ③ 上限减 1 字节：不截断 ----
console.log('— ③ 边界：上限 - 1 —')
const justUnder = await putRule('y'.repeat(ON_LIMIT - 1))
ok('③ ' + (ON_LIMIT - 1) + ' B ⇒ truncated === false 且原样',
  justUnder.truncated === false && justUnder.bytes === ON_LIMIT - 1 && justUnder.keptBytes === ON_LIMIT - 1
  && justUnder.originalBytes === ON_LIMIT - 1 && justUnder.text === 'y'.repeat(ON_LIMIT - 1),
  J({ flag: justUnder.truncated, bytes: justUnder.bytes }))

// ---- ④ 空串 / 极短规则：标记为假且内容原样 ----
console.log('— ④ 空 / 极短 —')
const blank = await putRule('   \n\t\n')                  // 全空白 ⇒ sanitize 后是空串
ok('④ 全空白规则 ⇒ truncated === false、长度为 0、没有截断提示',
  blank.truncated === false && blank.bytes === 0 && blank.originalBytes === 0 && blank.keptBytes === 0
  && blank.text === '' && blank.lines === 0, J({ flag: blank.truncated, bytes: blank.bytes, text: blank.text }))
const short = '# 短规则\n只有一行。'
const tiny = await putRule(short)
ok('④ 极短规则 ⇒ truncated === false 且内容逐字节原样',
  tiny.truncated === false && tiny.text === short && tiny.bytes === B(short)
  && tiny.originalBytes === tiny.keptBytes && tiny.keptBytes === B(short),
  J({ flag: tiny.truncated, bytes: tiny.bytes, orig: tiny.originalBytes }))

// ---- ⑤ 标记与内容一致（把"标记 false 但内容明显变短"直接堵死）----
console.log('— ⑤ 标记 ⟺ 内容 —')
const cases = [
  ['超长中文', cnRule, cn], ['超长 ASCII', asciiRaw, ascii],
  ['恰好上限', exactText, exact], ['上限-1', 'y'.repeat(ON_LIMIT - 1), justUnder],
  ['全空白', '   \n\t\n', blank], ['极短', short, tiny],
]
let consistent = true
const detail = []
for (const [label, raw, meta] of cases) {
  const trimmed = raw.replace(/\r\n/g, '\n').trim()
  const origBytes = B(trimmed)
  const same = meta.originalBytes === origBytes
    && meta.keptBytes === meta.bytes
    && Buffer.byteLength(meta.text, 'utf8') === meta.bytes
    && (meta.truncated
      ? meta.keptBytes < meta.originalBytes && meta.text !== trimmed && meta.keptBytes <= meta.maxBytes
      : meta.text === trimmed && meta.keptBytes === meta.originalBytes)
  if (!same) { consistent = false; detail.push(label + '=' + J({ f: meta.truncated, o: meta.originalBytes, k: meta.keptBytes, b: meta.bytes })) }
}
ok('⑤ 六种输入的"标记 / 原始长度 / 保留长度 / 实际内容"四者互相对得上', consistent, detail.join(' | '))
ok('⑤ 没有"标记为假但内容变短"的样本（未截断 ⇒ text 与原文逐字节相同）',
  cases.every(([, raw, meta]) => meta.truncated || meta.text === raw.replace(/\r\n/g, '\n').trim()))
ok('⑤ bytes 与 keptBytes 恒等（同一份计算出来的，不许各算一份）',
  cases.every(([, , meta]) => meta.bytes === meta.keptBytes))

// ---- ⑥ 老字段名仍在（老客户端不该炸）----
console.log('— ⑥ 兼容：老字段名 —')
const OLD_FIELDS = ['enabled', 'source', 'builtinPath', 'overridePath', 'bytes', 'lines', 'text', 'maxBytes']
ok('⑥ gateMeta 仍带全部老字段', OLD_FIELDS.every((k) => k in cn), Object.keys(cn).join(','))
ok('⑥ 新增字段只有三个：truncated / originalBytes / keptBytes',
  ['truncated', 'originalBytes', 'keptBytes'].every((k) => k in cn)
  && Object.keys(cn).length === OLD_FIELDS.length + 3 + 2, Object.keys(cn).join(','))

// ---- ⑦ HTTP：两个响应都带标记，且与文本一致 ----
console.log('— ⑦ HTTP 响应 —')
const routes = new Map()
const webServer = { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }
const ctx = {
  get: (n) => (n === 'webServer' ? webServer : undefined),
  effect: (fn) => fn(),
  inject: (deps, cb) => { cb({ systemPrompt: { section: () => () => {} } }) },
}
await m.apply(ctx)
const server = http.createServer((req, res) => {
  const h = routes.get((req.url || '').split('?')[0])
  if (!h) { res.writeHead(404); res.end('{}'); return }
  h(req, res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port
const getJ = async (p) => { const r = await fetch(base + p, { cache: 'no-store' }); return { status: r.status, body: await r.json() } }
const putJ = async (p, obj) => {
  const r = await fetch(base + p, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) })
  return { status: r.status, body: await r.json() }
}

const putRes = await putJ('/cc/gate.json', { text: cnRule })
ok('⑦ PUT /cc/gate.json 响应里就有截断标记与原/留长度',
  putRes.status === 200 && putRes.body.truncated === true
  && putRes.body.originalBytes === B(cnRule) && putRes.body.keptBytes === cn.keptBytes,
  J(putRes.body))
ok('⑦ PUT 响应的老字段未动（bytes / lines / source / enabled 都在且自洽）',
  putRes.body.bytes === putRes.body.keptBytes && putRes.body.source === 'override'
  && putRes.body.enabled === true && putRes.body.lines === (await getJ('/cc/gate.json')).body.gate.lines
  && putRes.body.maxBytes === ON_LIMIT, J({ bytes: putRes.body.bytes, lines: putRes.body.lines }))
const g1 = await getJ('/cc/gate.json')
const gg = g1.body.gate
ok('⑦ GET /cc/gate.json 的标记与内容一致（truncated=true 且 text 长度 === keptBytes）',
  g1.status === 200 && gg.truncated === true && gg.originalBytes === B(cnRule) && gg.keptBytes === cn.keptBytes
  && Buffer.byteLength(gg.text, 'utf8') === gg.keptBytes && gg.bytes === gg.keptBytes, J(gg))
const s1 = await getJ('/cc/settings.json')
const sg = s1.body.gate || {}
ok('⑦ GET /cc/settings.json 内嵌的 gate 同样是显式标记（与 gate.json 逐字段一致）',
  s1.status === 200 && sg.truncated === true && sg.originalBytes === gg.originalBytes && sg.keptBytes === gg.keptBytes
  && sg.bytes === gg.bytes && sg.text === gg.text, J({ s: sg.truncated, g: gg.truncated }))
ok('⑦ 老客户端读到的 bytes 仍是"实际注入字节数"，没被换成原文长度',
  sg.bytes === cn.keptBytes && sg.maxBytes === ON_LIMIT, J({ bytes: sg.bytes, max: sg.maxBytes }))

// 短规则经 HTTP 往返：标记为假，且内容原样
await putJ('/cc/gate.json', { text: short })
const g2 = await getJ('/cc/gate.json')
ok('⑦ 短规则经 HTTP 往返 ⇒ truncated=false、原样、两长度相等',
  g2.body.gate.truncated === false && g2.body.gate.text === short
  && g2.body.gate.originalBytes === B(short) && g2.body.gate.keptBytes === B(short), J(g2.body.gate))
// 恰好在上限：经 HTTP 也不能被误报
const putExact = await putJ('/cc/gate.json', { text: exactText })
ok('⑦ 恰好' + ON_LIMIT + ' B 经 HTTP 保存 ⇒ truncated=false（旧判据在这里会误报 true）',
  putExact.body.truncated === false && putExact.body.bytes === ON_LIMIT, J(putExact.body))
// 清掉 override：回到内置（DSH_CC_INDEX 指仓库里这份时，内置 = 仓库的 session-gate.md，2,709 B；
// 指到别处临时副本时可能不存在 ⇒ 长度为 0）。两种情况都必须"未截断"、且三个长度自洽。
const putClear = await putJ('/cc/gate.json', { text: '' })
ok('⑦ 清除 override ⇒ source=builtin、truncated=false、三个长度自洽且不超上限',
  putClear.status === 200 && putClear.body.source === 'builtin' && putClear.body.truncated === false
  && putClear.body.bytes === putClear.body.keptBytes && putClear.body.originalBytes === putClear.body.bytes
  && putClear.body.bytes <= ON_LIMIT, J(putClear.body))

// 收尾：先把 keep-alive 连接掐掉再close，然后**不要** process.exit ——
// 直接 exit 会让 Windows 上的 libuv 在"句柄正在关闭"时断言崩掉（uv async.c），
// 于是断言全绿也得到一个非零退出码（退出码由 process.exitCode 决定）。
server.closeAllConnections?.()
await new Promise((r) => server.close(r))

// ---- ⑧ 界面：显示"原 N 字节 → 保留 M 字节"（源码级结构断言，渲染断言在 verify-gate-client）----
console.log('— ⑧ 界面接线 —')
const clientSrc = fs.readFileSync(path.join(path.dirname(MOD), 'client.js'), 'utf8')
ok('⑧ client 读 host 的显式标记与两个长度（不再自己比长度）',
  /gateTruncated:\s*!!g\.truncated/.test(clientSrc)
  && /gateOriginalBytes:\s*Number\(g\.originalBytes\)/.test(clientSrc)
  && /gateKeptBytes:\s*Number\(g\.keptBytes\)/.test(clientSrc))
ok('⑧ client 侧没有"用 gateBytes/maxBytes 比大小反推截断"的写法',
  !/gateTruncated:\s*[^,\n]*gateBytes[^,\n]*>=[^,\n]*[mM]ax/.test(clientSrc)
  && !/gateTruncated:\s*Number\(g\.bytes\)\s*>=/.test(clientSrc))
// 卡片骨架自 v1.12.2 起因三张卡合并成 RuleCard 而变成数据驱动，所以这里按"数据"口径盯：
// 门禁卡必须登记 Truncated 这条警示、正文里必须有原始与保留两个字节数。
// 渲染层的行为断言仍在 verify-gate-client 第 E2 组（那里真的渲染 HTML 并查文字）。
ok('⑧ 截断提示里带上了原始与保留两个字节数',
  /field:\s*'Truncated'/.test(clientSrc) && /s\.gateOriginalBytes/.test(clientSrc) && /s\.gateKeptBytes/.test(clientSrc))

fs.rmSync(HOME, { recursive: true, force: true })
console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败')
process.exitCode = fail === 0 ? 0 : 1
