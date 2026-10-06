// 端到端验证 dsh-cache-control 的 host 半：用假的 cordis ctx + 真的 node:http
// 跑通路由，并把 DSH_HOME 指到临时目录，因此不会碰用户真实的 settings.json。
// 重点证明：门禁段注册后，改一次 PUT 就让 text() 立刻在"已存在的会话"上下一个请求
// 生效（因为 assemble 每次都重算 text），以及异常输入不会把服务打挂。
// v1.14.0：压缩接管删除后不再需要 standard preset 夹具（preset 断言也一并删了）。
// 仍排除在 CI 外 —— §8 要读真实 %APPDATA% 下的 settings.json 做"未被写入"比对。
import { fileURLToPath as __f2p, pathToFileURL as __p2u } from 'node:url'
import __pathMod from 'node:path'
// ---- 相对本文件的本地路径解析（2026-09-30 可迁移性：手工跑不带 env 也能用）----
// PLUGIN/APP/MOD 允许是相对本文件的默认值（如 '../'）；'file:///' + '../x.js' 会被 Node
// 判为非法 URL，pathToFileURL('../') 又按 cwd 解析。统一走 __localFile。
// 查询串（?t=…）必须拼在 href 之后，不能塞进 new URL 的相对段。
const __localFile = (base, tail) => {
  if (typeof base !== 'string' || base === '') return String(tail || '')
  if (/^[a-zA-Z][\w+.-]*:\/\//.test(base)) return base + (tail || '')
  const here = __pathMod.dirname(__f2p(import.meta.url))
  const abs = __pathMod.isAbsolute(base) ? base : __pathMod.resolve(here, base)
  const href = __p2u(abs).href
  const t = tail || ''
  const needSlash = t !== '' && !t.startsWith('/') && !t.startsWith('?') && !t.startsWith('#') && !href.endsWith('/')
  return (needSlash ? href + '/' : href) + t
}

const PLUGIN = process.env.DSH_CC_PLUGIN || '../';
const ROOT = process.env.DSH_TOOL_HOME || './.tool-home/';

const fs = await import('node:fs')
const pathMod = await import('node:path')
const http = await import('node:http')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')) }
}

// ---- 临时 DSH_HOME -------------------------------------------------------
fs.rmSync(ROOT, { recursive: true, force: true })
fs.mkdirSync(pathMod.join(ROOT, 'dsh-cache-control'), { recursive: true })
fs.writeFileSync(pathMod.join(ROOT, 'dsh-cache-control', 'settings.json'), '{}')
process.env.DSH_HOME = ROOT

const host = await import(__localFile(PLUGIN, 'index.js'))

// ---- 假 ctx：捕获 webServer.register 的路由与 systemPrompt.section -------
const routes = new Map()
const sections = []
let sectionError = null
const webServer = {
  register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) },
}
const ctx = {
  get: (name) => (name === 'webServer' ? webServer : undefined),
  effect: (fn) => fn(),
  inject: (deps, cb) => {
    if (!deps.includes('systemPrompt')) throw new Error('unexpected deps: ' + deps.join(','))
    cb({ systemPrompt: { section: (s) => { sections.push(s); return () => {} } } })
  },
}
await host.apply(ctx)

const server = http.createServer((req, res) => {
  const pathname = (req.url || '').split('?')[0]
  const h = routes.get(pathname)
  if (!h) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not found"}'); return }
  h(req, res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port
const get = async (p) => { const r = await fetch(base + p, { cache: 'no-store' }); return { status: r.status, body: await r.json() } }
const put = async (p, obj) => {
  const r = await fetch(base + p, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) })
  return { status: r.status, body: await r.json() }
}

console.log('\n— 1. 常驻段挂载 —')
// v1.10.0 起本插件挂多段常驻规则（会话守则 + ponytail，v1.12.0 再加输出形状），所以这里找的是
// "名字为 GATE_SECTION 的那一段"，而不是"只挂了一段"。断言口径不变（段名/段序/text 契约逐条验）。
ok('ctx.inject 依赖 systemPrompt（三段都挂上了）', sections.length === 3, 'sections=' + sections.length)
const section = sections.find((s) => s.name === host.GATE_SECTION)
ok('门禁段存在且唯一', !!section && sections.filter((s) => s.name === host.GATE_SECTION).length === 1)
ok('段名/段序正确', section.name === host.GATE_SECTION && section.order === host.GATE_SECTION_ORDER)
ok('text 是函数（每请求重算 ⇒ 开关无需重启即生效）', typeof section.text === 'function')
ok('settings.json 缺失时 text() 不抛错且为空', section.text({}) === '')

console.log('\n— 2. GET 契约 —')
const g1 = await get('/cc/settings.json')
ok('GET settings 200', g1.status === 200, JSON.stringify(g1.body).slice(0, 60))
ok('settings.gateEnabled 字段存在', 'gateEnabled' in (g1.body.settings || {}))
ok('gate 元数据齐全', ['enabled', 'source', 'builtinPath', 'overridePath', 'bytes', 'lines', 'text', 'maxBytes']
  .every((k) => k in (g1.body.gate || {})), Object.keys(g1.body.gate || {}).join(','))
ok('默认门禁为关', g1.body.gate.enabled === false)
ok('默认回退内置规则', g1.body.gate.source === 'builtin' && g1.body.gate.text.startsWith('# 会话守则'))
const g2 = await get('/cc/gate.json')
ok('GET gate.json 独立可读', g2.status === 200 && g2.body.ok === true && g2.body.gate.bytes > 0)
const g404 = await get('/cc/nope.json')
ok('未注册路径 404（由宿主决定，本插件不吞）', g404.status === 404)

console.log('\n— 3. 门禁 PUT 契约 —')
const p1 = await put('/cc/settings.json', { gateEnabled: true })
ok('PUT 成功', p1.status === 200 && p1.body.ok === true)
ok('门禁立即反映到已注册的段（同一进程内，无重启）', section.text({}).startsWith('# 会话守则'),
  section.text({}).slice(0, 20).replace(/\n/g, ' '))
const disk1 = JSON.parse(fs.readFileSync(pathMod.join(ROOT, 'dsh-cache-control', 'settings.json'), 'utf8'))
ok('磁盘设置含 gateEnabled=true', disk1.gateEnabled === true, JSON.stringify(Object.keys(disk1)))
ok('保存响应只回开关状态（v1.14.0 起没有 touched/changed —— 那对是给组装文件用的）',
  !('touched' in p1.body) && !('changed' in p1.body), JSON.stringify(Object.keys(p1.body)))
const pOnly = await put('/cc/settings.json', { gateEnabled: false })
ok('再关一次仍 200', pOnly.status === 200 && pOnly.body.ok === true)
await put('/cc/settings.json', { gateEnabled: true })

console.log('\n— 4. 部分字段合并（不带 gateEnabled 的 PUT 不会关掉门禁）—')
const p2 = await put('/cc/settings.json', { pinLastUser: true })
const disk2 = JSON.parse(fs.readFileSync(pathMod.join(ROOT, 'dsh-cache-control', 'settings.json'), 'utf8'))
ok('未带 gateEnabled 的 PUT 不会关掉门禁', disk2.gateEnabled === true, JSON.stringify(disk2))
ok('未带的字段被合并进盘（pinLastUser=true）', disk2.pinLastUser === true)
ok('合并保存后门禁段仍注入', section.text({}).startsWith('# 会话守则'))
await put('/cc/settings.json', { pinLastUser: false })

console.log('\n— 5. 关掉门禁 —')
await put('/cc/settings.json', { gateEnabled: false })
ok('text() 变空串（空段会被 renderPrompt 丢弃）', section.text({}) === '')
await put('/cc/settings.json', { gateEnabled: true })
ok('再开即恢复', section.text({}).length > 100)

console.log('\n— 6. 规则文本读写 —')
const c1 = await put('/cc/gate.json', { text: '# 我的临时规则\n只有一条：先跑测试。\n' })
ok('PUT 规则 200', c1.status === 200 && c1.body.ok === true, JSON.stringify(c1.body))
ok('override 落盘', fs.existsSync(pathMod.join(ROOT, 'dsh-cache-control', 'gate.md')))
ok('注入内容切到自定义（同一 text() 引用即生效）', section.text({}).includes('先跑测试'))
const g3 = await get('/cc/gate.json')
ok('元数据标为 override', g3.body.gate.source === 'override' && g3.body.gate.bytes < 100)
const c2 = await put('/cc/gate.json', { text: '{{model}} 与 }} 脏字符' })
ok('脏字符写入不被拒', c2.status === 200)
ok('但注入形态已中和', !/\{\{|\}\}/.test(section.text({})), section.text({}).slice(0, 20))
const c3 = await put('/cc/gate.json', { text: '   ' })
ok('空白 text = 清除 override', c3.status === 200 && c3.body.source === 'builtin' && !fs.existsSync(pathMod.join(ROOT, 'dsh-cache-control', 'gate.md')))
ok('清除后回到内置', section.text({}).startsWith('# 会话守则'))
const c4 = await put('/cc/gate.json', { text: 'y'.repeat(20000) })
// 判据相对 host.GATE_MAX_BYTES（v1.9.0 起上限 6 KB→16 KB，旧断言写死 7000/6200 是 6 KB 年代的数，
// 放宽后 7000 字节的输入根本不再触发截断 —— 与 verify-gate-truncation 同口径：样本相对上限生成）。
ok('超上限文本被截断而非溢出', c4.status === 200 && section.text({}).length > 0
  && Buffer.byteLength(section.text({}), 'utf8') < host.GATE_MAX_BYTES,
  'injected=' + Buffer.byteLength(section.text({}), 'utf8') + ' / limit=' + host.GATE_MAX_BYTES)
await put('/cc/gate.json', { text: '' })
const c5 = await put('/cc/gate.json', { nope: 1 })
ok('PUT 无 text 字段视为清除 override（不报错）', c5.status === 200)

console.log('\n— 7. 异常输入 —')
const bad = await fetch(base + '/cc/settings.json', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: 'not json' })
ok('坏 JSON → 400 而不是 500/崩溃', bad.status === 400)
const huge = await fetch(base + '/cc/gate.json', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'z'.repeat(200000) }) })
const hugeBody = await huge.json()
ok('超大 body → 400 + 错误信息', huge.status === 400 && /too large/.test(hugeBody.error || ''), hugeBody.error)
const del = await fetch(base + '/cc/settings.json', { method: 'DELETE' })
ok('DELETE → 405', del.status === 405)
const junk = await put('/cc/settings.json', { gateEnabled: 'yes', pinBlur: 999, chatWidth: 5 })
const g6 = await get('/cc/settings.json')
ok('非布尔 gateEnabled 归 false', g6.body.settings.gateEnabled === false)
ok('越界数值被夹取（pinBlur 上钳 24 / chatWidth 下钳 30）',
  g6.body.settings.pinBlur <= 24 && g6.body.settings.chatWidth >= 30, JSON.stringify(g6.body.settings))
ok('异常输入后服务仍可用', junk.status === 200)

console.log('\n— 8. 收尾 —')
const g7 = await get('/cc/settings.json')
ok('临时目录未污染真实 DSH_HOME：真实 settings.json 未被写入过',
  fs.statSync(process.env.APPDATA + '/dsh-desktop/harness/dsh-cache-control/settings.json').size > 0
  && !fs.existsSync(process.env.APPDATA + '/dsh-desktop/harness/dsh-cache-control/gate.md'))
server.close()
fs.rmSync(ROOT, { recursive: true, force: true })
console.log('\n' + pass + ' passed, ' + fail + ' failed\n')
process.exitCode = fail === 0 ? 0 : 1
