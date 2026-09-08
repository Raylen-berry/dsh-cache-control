// 端到端验证 dsh-cache-control 的 host 半：用假的 cordis ctx + 真的 node:http
// 跑通路由，并把 DSH_HOME 指到临时目录（含一份 standard 组装文件副本），
// 因此不会碰用户真实的 settings.json / preset。
// 重点证明：两个开关互不覆盖；门禁段注册后，改一次 PUT 就让 text() 立刻
// 在"已存在的会话"上下一个请求生效（因为 assemble 每次都重算 text）。
const PLUGIN = process.env.DSH_CC_PLUGIN || 'D:/DeepSeek/dsh-plugins/dsh-cache-control/';
const ROOT = process.env.DSH_TOOL_HOME || 'D:/DeepSeek/03-调试临时/gate-e2e-home';
const REAL_PRESET = process.env.APPDATA + '/dsh-desktop/harness/profiles/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml'

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
const presetDir = pathMod.join(ROOT, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets', 'standard')
fs.mkdirSync(presetDir, { recursive: true })
fs.mkdirSync(pathMod.join(ROOT, 'dsh-cache-control'), { recursive: true })
fs.writeFileSync(pathMod.join(ROOT, 'dsh-cache-control', 'settings.json'), '{}')
fs.copyFileSync(REAL_PRESET, pathMod.join(presetDir, 'agent.cordis.yml'))
process.env.DSH_HOME = ROOT

const host = await import('file:///' + PLUGIN + 'index.js')

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

console.log('\n— 1. 门禁段挂载 —')
ok('ctx.inject 依赖 systemPrompt', sections.length === 1, 'sections=' + sections.length)
const section = sections[0]
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
ok('压缩数字仍在（未被 gate 改动挤掉）', typeof g1.body.triggerTokens === 'number' && typeof g1.body.windowTokens === 'number')
const g2 = await get('/cc/gate.json')
ok('GET gate.json 独立可读', g2.status === 200 && g2.body.ok === true && g2.body.gate.bytes > 0)
const g404 = await get('/cc/nope.json')
ok('未注册路径 404（由宿主决定，本插件不吞）', g404.status === 404)

console.log('\n— 3. 开关独立：门禁 PUT 不碰压缩 —')
const presetFile = pathMod.join(presetDir, 'agent.cordis.yml')
const presetBefore = fs.readFileSync(presetFile, 'utf8')
const p1 = await put('/cc/settings.json', { enabled: true, triggerPct: 30, retainPct: 4, auto: true, gateEnabled: true })
ok('PUT 成功', p1.status === 200 && p1.body.ok === true)
ok('门禁立即反映到已注册的段（同一进程内，无重启）', section.text({}).startsWith('# 会话守则'),
  section.text({}).slice(0, 20).replace(/\n/g, ' '))
const disk1 = JSON.parse(fs.readFileSync(pathMod.join(ROOT, 'dsh-cache-control', 'settings.json'), 'utf8'))
ok('磁盘设置含 gateEnabled=true 且压缩参数未变',
  disk1.gateEnabled === true && disk1.enabled === true && disk1.triggerPct === 30 && disk1.retainPct === 4)
const presetAfterEnable = fs.readFileSync(presetFile, 'utf8')
ok('开压缩确实写入了 config（对照组）', presetAfterEnable.includes('thresholdRatio: 0.30'))
const pOnly = await put('/cc/settings.json', { gateEnabled: false })
const presetAfterGateOnly = fs.readFileSync(presetFile, 'utf8')
ok('只动门禁不碰压缩 config 文件（两开关正交）', presetAfterGateOnly === presetAfterEnable && pOnly.body.ok === true)
await put('/cc/settings.json', { gateEnabled: true })

console.log('\n— 4. 反向：压缩 PUT 不覆盖门禁（部分字段合并）—')
const p2 = await put('/cc/settings.json', { enabled: false, triggerPct: 30, retainPct: 4, auto: true })
const disk2 = JSON.parse(fs.readFileSync(pathMod.join(ROOT, 'dsh-cache-control', 'settings.json'), 'utf8'))
ok('未带 gateEnabled 的 PUT 不会关掉门禁', disk2.gateEnabled === true, JSON.stringify(disk2))
ok('压缩关有效：组装文件里的 managed config 被移除',
  !fs.readFileSync(presetFile, 'utf8').includes('thresholdRatio') && p2.body.ok === true)
ok('压缩关 ⇒ 门禁段仍注入（两开关正交）', section.text({}).startsWith('# 会话守则'))

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
const c4 = await put('/cc/gate.json', { text: 'y'.repeat(7000) })
ok('超上限文本被截断而非溢出', c4.status === 200 && section.text({}).length < 6200, 'injected=' + section.text({}).length)
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
const junk = await put('/cc/settings.json', { triggerPct: 9999, retainPct: -5, gateEnabled: 'yes', enabled: 'true' })
const g6 = await get('/cc/settings.json')
ok('越界数值被夹取', g6.body.settings.triggerPct <= 95 && g6.body.settings.retainPct >= 1 && g6.body.settings.retainPct < g6.body.settings.triggerPct,
  JSON.stringify(g6.body.settings))
ok('非布尔 gateEnabled 归 false', g6.body.settings.gateEnabled === false)
ok('异常输入后服务仍可用', junk.status === 200)

console.log('\n— 8. 收尾 —')
const g7 = await get('/cc/settings.json')
ok('临时目录未污染真实 DSH_HOME：真实 settings.json 未被写入过',
  fs.statSync(process.env.APPDATA + '/dsh-desktop/harness/dsh-cache-control/settings.json').size > 0
  && !fs.existsSync(process.env.APPDATA + '/dsh-desktop/harness/dsh-cache-control/gate.md'))
ok('真实 preset 未被本次验证改动', fs.readFileSync(REAL_PRESET, 'utf8').includes('thresholdRatio: 0.30'))
server.close()
fs.rmSync(ROOT, { recursive: true, force: true })
console.log('\n' + pass + ' passed, ' + fail + ' failed\n')
process.exitCode = fail === 0 ? 0 : 1
