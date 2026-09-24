// 套件：省 token（v1.13.0）—— dsh-plugin-save-token v2.4.1 宿主半边并入本插件。
//
// 盯住的缺陷类别（嵌入时最容易出事的地方）：
//   ① 挂载方式：必须是 ctx.plugin 的**嵌套插件**，不能变成第二条 bundle 行；
//   ② 冲突面：上游 arm 3（compaction assist）必须**整段不在**，且不许再
//      ctx.get('compaction') —— 压缩契约只归本插件的「省缓存」一块；
//   ③ 路由改名：/save-token/* → /cc/st/*，且不能再注册旧前缀；
//   ④ 工具定义：手写的 save_token_expand 定义要对得上 dsh-tools 的 register 口径
//      （object 根 + required 数组 + output.schema/render），参数非法要报 INVALID_ARGS；
//   ⑤ 可逆性：有 spillStore 才压缩、压完必须能**逐字节取回原文**；没 spillStore
//      就一个字都不许动（宁可省不下 token，也不许丢原文）；
//   ⑥ 跨轮去重：同一 tool 调用逐字节相同 ⇒ 打桩，不许重复塞进上下文；
//   ⑦ 被删掉的开关/面板字段不许在 API 里复活（compactAssist / compaction 块）；
//   ⑧ 路由 kind 必须是 'prefix' —— 写成 exact 时子路径在真机永远 404，而"直接调 handler"
//      的断言绕过了路由匹配、照样全绿，所以这条必须单独锁（见第 1 组那条断言）。
//
// 全程离线：假 ctx 冒充 Cordis，假 spillStore 落在临时目录，不碰真实 DSH_HOME。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PLUGIN = process.env.DSH_CC_PLUGIN || 'D:/DeepSeek/dsh-plugins/dsh-cache-control/'
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-savetok-'))
process.env.DSH_HOME = ROOT
const host = await import('file:///' + PLUGIN + 'index.js')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')) }
}

// ── 假 Cordis 上下文 ────────────────────────────────────────────────────────
function makeCtx(opts = {}) {
  const rec = { tools: [], routes: [], events: [], sections: [], injects: [], gets: [], effects: [], plugins: [] }
  let tag = 'parent'
  const spill = opts.noSpill ? undefined : {
    texts: new Map(),
    saveText({ content, source }) { const locator = 'spill://' + source.callId; this.texts.set(locator, content); return { locator } },
    readText({ locator }) { return { text: this.texts.get(locator) } },
  }
  const services = {
    webServer: { register(route) { rec.routes.push({ ...route, tag }); return () => {} } },
    tools: { register(def) { rec.tools.push(def); return () => {} } },
    spillStore: spill,
    skills: undefined,
    compaction: undefined,
    systemPrompt: { section(s) { rec.sections.push({ ...s, tag }) } },
  }
  const proxy = {
    get(name) { rec.gets.push(name); return services[name] },
    inject(names, cb) { rec.injects.push({ names, tag }); cb(proxy) },
    effect(fn) { rec.effects.push({ tag }); const d = fn(); return typeof d === 'function' ? d : () => {} },
    on(event, handler, o) { rec.events.push({ event, handler, opts: o, tag }); return () => {} },
    plugin(mod, config) {
      rec.plugins.push({ name: mod && mod.name, config, tag })
      const prev = tag
      tag = 'child'
      try {
        // 仿 Cordis 的 inject 门禁：声明的服务缺席时子插件不 apply
        for (const dep of (mod && mod.inject) || []) {
          if (services[dep] === undefined) throw new Error('missing injected service: ' + dep)
        }
        mod.apply(proxy, config)
      } finally { tag = prev }
      return () => {}
    },
  }
  // 仿 Cordis：被 inject 的服务同时是 ctx 上的属性（promptCtx.systemPrompt 等）
  for (const k of Object.keys(services)) Object.defineProperty(proxy, k, { get: () => services[k] })
  return { rec, proxy, spill }
}

const handlersFor = (rec, event) => rec.events.filter((e) => e.event === event)
const route = (rec, p) => rec.routes.find((r) => r.path === p)

async function mount(opts = {}) {
  const { rec, proxy, spill } = makeCtx(opts)
  await host.apply(proxy)
  return { rec, spill }
}

// ── 1. 挂载方式与冲突面 ─────────────────────────────────────────────────────
console.log('\n— 1. 嵌套挂载 + 冲突面 —')
const m = await mount()
ok('apply() 正常返回', true)
ok('子插件以嵌套方式挂载（不是独立 bundle 行）', m.rec.plugins.length === 1 && m.rec.plugins[0].name === 'cache-control-save-token',
  m.rec.plugins.map((p) => p.name).join(',') || '(none)')
ok('父层自己的路由仍在', m.rec.routes.some((r) => r.path === '/cc/settings.json'))
ok('子插件路由前缀改名为 /cc/st', route(m.rec, '/cc/st') !== undefined && route(m.rec, '/cc/st').tag === 'child')
// kind 必须是 prefix：写成 exact 时 `/cc/st/api/dashboard` 永远不会命中，而套件里"直接调 handler"的断言
// 照样全绿（它绕过了路由匹配），只有真机才会 404 —— 所以这条单独锁住。
// （父层那几条 `/cc/*.json` 是 kind:'exact' 的定长路径，口径不同，不在这里比。）
ok('子插件路由 kind 是 prefix（否则子路径永远匹配不上，真机 404）', route(m.rec, '/cc/st').kind === 'prefix',
  String(route(m.rec, '/cc/st').kind))
ok('旧前缀 /save-token 不再注册', m.rec.routes.every((r) => !String(r.path).startsWith('/save-token')))
ok('两条 waterfall 都在（post-execute 前置 + llm/stream）',
  handlersFor(m.rec, 'tools/post-execute').length === 1 && handlersFor(m.rec, 'llm/stream').length === 1)
ok('tools/post-execute 仍是 prepend（压缩必须抢在别的插件之前）', handlersFor(m.rec, 'tools/post-execute')[0].opts?.prepend === true)
ok('arm 3 已删：无 agent/pre-step 监听', handlersFor(m.rec, 'agent/pre-step').length === 0)
ok('arm 3 已删：从不 ctx.get(\'compaction\')', !m.rec.gets.includes('compaction'))
ok('注入面只有 webServer（tools 由子插件自己声明，父层不抢）',
  m.rec.injects.filter((i) => i.tag === 'parent' && i.names.includes('tools')).length === 0)

// ── 2. save_token_expand 工具定义 ───────────────────────────────────────────
console.log('\n— 2. save_token_expand 定义（手写，替代 defineTool）—')
const expand = m.rec.tools[0]
ok('注册了且只有一条工具', m.rec.tools.length === 1 && expand.name === 'save_token_expand')
ok('parameters 是 object 根 JSON Schema', expand.parameters?.type === 'object' && typeof expand.parameters.properties === 'object')
ok('required 是数组且只含 id', JSON.stringify(expand.parameters.required) === JSON.stringify(['id']))
ok('id 是 string 且带 description', expand.parameters.properties.id.type === 'string' && typeof expand.parameters.properties.id.description === 'string')
ok('output.schema 与 output.render 齐备（register 的硬要求）',
  expand.output?.schema?.type === 'object' && expand.output.schema.additionalProperties === true && typeof expand.output.render === 'function')
ok('render 回文本块', JSON.stringify(expand.output.render({}, { text: 'X' })) === JSON.stringify([{ type: 'text', text: 'X' }]))
ok('render 对 error 也回文本（不吃异常）', expand.output.render({}, { error: 'boom' })[0].text === 'boom')
const badArg = await expand.execute({ id: 7 }, {}).then(() => null, (e) => e)
ok('非法参数拒绝（defineTool 的 INVALID_ARGS 语义）', badArg instanceof Error && /invalid arguments/.test(badArg.message))
ok('未知 id 回可行动的错误（不回死胡同）',
  /read tool/.test((await expand.execute({ id: 'nope' }, {})).error))

// ── 3. 压缩 → 取回（可逆性）─────────────────────────────────────────────────
console.log('\n— 3. 压缩与逐字节取回 —')
const BIG = JSON.stringify(Array.from({ length: 120 }, (_, i) => ({
  id: i, name: 'worker-' + i, status: 'ok', region: 'cn-north-1', ms: 10 + (i % 7), note: 'steady state observed',
})), null, 1)
const exec1 = { name: 'grep', callId: 'call-1', arguments: { q: 'worker' }, agent: { session: { header: { id: 'sess-1' } } } }
const exec2 = { name: 'grep', callId: 'call-2', arguments: { q: 'worker' }, agent: { session: { header: { id: 'sess-1' } } } }
const result1 = { content: [{ type: 'text', text: BIG }], isError: false }
const next = async () => ({ kind: 'accept', content: result1.content })

const post = handlersFor(m.rec, 'tools/post-execute')[0].handler
const out1 = await post(exec1, result1, next)
const text1 = out1?.content?.[0]?.text
ok('超大 tool 输出被判 accept 且被改写', out1?.kind === 'accept' && typeof text1 === 'string' && text1 !== BIG)
ok('压后确实更小', Buffer.byteLength(text1, 'utf8') < Buffer.byteLength(BIG, 'utf8'),
  Buffer.byteLength(BIG, 'utf8') + 'B → ' + Buffer.byteLength(text1, 'utf8') + 'B')
const id1 = (text1.match(/\[save-token #([a-z0-9]+)/) || [])[1]
ok('notice 带取回 id', typeof id1 === 'string' && id1.length > 1, '#' + id1)
ok('spill 收到逐字节原文', m.spill.texts.get('spill://call-1') === BIG)
const back = await expand.execute({ id: id1 }, {})
ok('expand 逐字节取回原文（可逆性硬保证）', back.text === BIG)
ok('expand 同时给出 locator', typeof back.locator === 'string' && back.locator.startsWith('spill://'))

// ── 4. 跨轮去重 ─────────────────────────────────────────────────────────────
console.log('\n— 4. 跨轮去重（逐字节相同才打桩）—')
const out2 = await post(exec2, result1, next)
const text2 = out2?.content?.[0]?.text
ok('第二次相同输出被换成桩', typeof text2 === 'string' && text2 !== text1 && /deduped/.test(text2))
ok('桩更小且指向原文落点', Buffer.byteLength(text2, 'utf8') < Buffer.byteLength(BIG, 'utf8') && /spill:\/\/call-2/.test(text2))
const different = await post({ ...exec2, callId: 'call-3', arguments: { q: 'other' } }, { content: [{ type: 'text', text: BIG + '\n' }], isError: false }, next)
ok('内容不同 ⇒ 不去重（TTL 内继续走压缩）', !/deduped/.test(different?.content?.[0]?.text || ''))

// ── 5. 没有 spillStore ⇒ 一个字都不动 ───────────────────────────────────────
console.log('\n— 5. 无 spillStore 时的降级（可逆性优先）—')
const noSpill = await mount({ noSpill: true })
const postNS = handlersFor(noSpill.rec, 'tools/post-execute')[0].handler
const outNS = await postNS(exec1, result1, next)
ok('原文原样返回', outNS?.content?.[0]?.text === BIG)
ok('未尝试写 spill', noSpill.spill === undefined && !noSpill.rec.gets.includes('compaction'))

// ── 6. 接口面：删掉的字段不许复活 ───────────────────────────────────────────
console.log('\n— 6. /cc/st API：已删字段不复活 —')
const call = async (url, method, body) => {
  let status, payload
  const res = { writeHead(s) { status = s }, end(b) { payload = JSON.parse(b) } }
  const req = { url, method, async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)) } }
  await route(m.rec, '/cc/st').handler(req, res)
  return { status, payload }
}
const dash = await call('/cc/st/api/dashboard', 'GET')
ok('dashboard 200', dash.status === 200)
ok('payload 里没有 compaction 块', dash.payload.compaction === undefined)
ok('flags 只剩 compress/dedupe/expandTool', JSON.stringify(Object.keys(dash.payload.flags)) === JSON.stringify(['compress', 'dedupe', 'expandTool']))
ok('dashboard 反映 spill 就绪', dash.payload.spillReady === true)
const killed = await call('/cc/st/api/set-enabled', 'POST', { key: 'compactAssist', value: true })
ok('已删开关 compactAssist 被拒', killed.payload.ok === false)
const off = await call('/cc/st/api/set-enabled', 'POST', { key: 'compress', value: false })
ok('开关 compress 仍可用', off.payload.ok === true && off.payload.flags.compress === false)
await call('/cc/st/api/set-enabled', 'POST', { key: 'compress', value: true })

// 超过内存预览上限：最终交给模型的 output.render 也必须完整，不能只检查 execute 元数据。
const HUGE = Array.from({ length: 5000 }, (_, i) => `line ${i}: ` + 'long-result '.repeat(8)).join('\n')
const hugeResult = { content: [{ type: 'text', text: HUGE }], isError: false }
const hugeOut = await post({ ...exec1, callId: 'huge' }, hugeResult, async () => ({ kind: 'accept', content: hugeResult.content }))
const hugeId = hugeOut.content[0].text.match(/\[save-token #([a-z0-9]+)/)?.[1]
ok('长原文已压缩，超过内存预览上限', !!hugeId && HUGE.length > 262144)
const syncBack = await Promise.resolve().then(() => expand.execute({ id: hugeId })).catch((e) => ({ error: e.message }))
ok('同步 readText 取回长原文完整尾部', syncBack.text === HUGE && syncBack.truncated === false)
ok('模型最终看到完整长原文', expand.output.render({}, syncBack)[0].text === HUGE)
const readText = m.spill.readText
m.spill.readText = async function (args) { return readText.call(this, args) }
const asyncBack = await expand.execute({ id: hugeId })
ok('异步 readText 同样完整取回', asyncBack.text === HUGE && asyncBack.truncated === false)
m.spill.readText = () => { throw new Error('read failed') }
const failedBack = await Promise.resolve().then(() => expand.execute({ id: hugeId })).catch((e) => ({ error: e.message }))
ok('落盘读取失败时不冒充完整原文，给出 read 路径', !failedBack.text && /read tool/.test(expand.output.render({}, failedBack)[0].text) && failedBack.locator === 'spill://huge')
delete m.spill.readText
const locatorBack = await expand.execute({ id: hugeId })
ok('宿主没有 readText 时明确返回完整原文路径', !locatorBack.text && /spill:\/\/huge/.test(expand.output.render({}, locatorBack)[0].text))
const reset = await call('/cc/st/api/reset', 'POST')
ok('reset 可用且计数清零', reset.payload.ok === true)
const resetBack = await expand.execute({ id: id1 })
ok('重置计数不清掉原文取回缓存', resetBack.text === BIG)
m.spill.readText = readText
const dash2 = await call('/cc/st/api/dashboard', 'GET')
ok('reset 后 compression.count 归零', dash2.payload.compression.count === 0)
const unknown = await call('/cc/st/api/nope', 'GET')
ok('未知端点 404', unknown.status === 404)

fs.rmSync(ROOT, { recursive: true, force: true })
console.log('\n' + pass + ' passed, ' + fail + ' failed\n')
process.exitCode = fail === 0 ? 0 : 1
