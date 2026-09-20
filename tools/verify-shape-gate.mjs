// 套件：输出形状段（v1.12.0，并入自独立插件 dsh-output-shape）。
//
// 这一轮是**合并**，所以盯住的缺陷类别都是"合并会丢什么 / 会串什么"：
//   ① 默认值：并入前它由 dsh-output-shape 的 bundle config 默认开启 ⇒ 并入后不许变成默认关
//      （否则升级即静默改变行为，用户只看到"形状规则没了"）。
//   ② 开关语义与另两段相反：门禁/ponytail 是 `=== true`，本节是 `!== false`。写反了就是"旧盘被判成关"。
//   ③ 三段缓存必须独立：改 gate/ponytail 的文件不许顶掉 shape 的缓存（三向都得试）。
//   ④ 逃生开关：并入前的 DSH_OUTPUT_SHAPE_DISABLE=1 继续有效，且界面能看出"开着但没注入"。
//   ⑤ 段名与段序：`dsh-cache-control:shape-gate` / order 410（紧随 ponytail 405、plan 政策 500 之前）。
//   ⑥ 技能同源：i-have-adhd / ponytail 两条按需技能的正文必须与常驻段**同一份**，不许各抄一份。
//   ⑦ 不重复注入：会话守则里只剩 R4 归属声明，没有 P1–P10 正文（守则 400 + 形状 410 两段一起注入时不许有两份规则）。
//
// 只在临时 DSH_HOME 里跑，绝不动 %APPDATA% 下真实设置与规则文件。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PLUGIN = process.env.DSH_CC_PLUGIN || 'D:/DeepSeek/dsh-plugins/dsh-cache-control/'
const host = await import('file:///' + PLUGIN + 'index.js')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  FAIL  ' + name + '  [' + extra + ']') }
}

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-shape-'))
process.env.DSH_HOME = ROOT
delete process.env[host.SHAPE_DISABLE_ENV]
fs.mkdirSync(path.join(ROOT, 'dsh-cache-control'), { recursive: true })
const shapeFile = path.join(ROOT, 'dsh-cache-control', 'shape.md')
const gateFile = path.join(ROOT, 'dsh-cache-control', 'gate.md')
const ponyFile = path.join(ROOT, 'dsh-cache-control', 'ponytail.md')

// ---------------------------------------------------------------- 1. 开关语义 --
console.log('\n— 1. 开关语义（本节默认开，判据与另两段相反）—')
ok('DEFAULTS 里 shapeEnabled 默认 true', host.DEFAULTS.shapeEnabled === true)
ok('sanitize 缺字段 ⇒ 开（并入前的默认值）', host.sanitize({}).shapeEnabled === true)
ok('sanitize 显式 false ⇒ 关', host.sanitize({ shapeEnabled: false }).shapeEnabled === false)
ok('sanitize 非 false 的值（null / "no" / 0）一律当作开', host.sanitize({ shapeEnabled: null }).shapeEnabled === true
  && host.sanitize({ shapeEnabled: 'no' }).shapeEnabled === true
  && host.sanitize({ shapeEnabled: 0 }).shapeEnabled === true)
ok('两段默认关的不受影响（门禁 / ponytail 仍缺省为关）',
  host.sanitize({}).gateEnabled === false && host.sanitize({}).ponytailEnabled === false)
ok('shapeEnabled=false → 空串（不进提示词）', host.shapePromptText({ shapeEnabled: false }) === '')
ok('未表态（undefined）→ 仍注入（这就是"默认开"的执行语义）',
  host.shapePromptText({}).startsWith('# i-have-adhd'), host.shapePromptText({}).slice(0, 20))
ok('settings 为 null 也不炸，且按默认开处理', host.shapePromptText(null).startsWith('# i-have-adhd'))
const on = host.shapePromptText({ shapeEnabled: true })
ok('开：内置形状全文', on.startsWith('# i-have-adhd（输出形状）'), on.slice(0, 24).replace(/\n/g, ' '))
ok('开：10 条规则里的关键内容都在',
  ['首行即可行动', '多步就编号', '跑题后置', '报错讲因果', '无开场白、无客套'].every((k) => on.includes(k)))
ok('开：破例条款与发送前自检也在',
  on.includes('何时破例') && on.includes('发送前自检'))

// ------------------------------------------------------------ 2. 逃生开关 --
console.log('\n— 2. 逃生开关（沿用并入前那个变量名）—')
ok('变量名就是原来的 DSH_OUTPUT_SHAPE_DISABLE', host.SHAPE_DISABLE_ENV === 'DSH_OUTPUT_SHAPE_DISABLE')
process.env[host.SHAPE_DISABLE_ENV] = '1'
ok('置 1 ⇒ 即使开关开着也不注入', host.shapePromptText({ shapeEnabled: true }) === '')
const envMeta = await host.shapeMeta({ shapeEnabled: true })
ok('元信息带 disabledByEnv（界面才能说"开着但没注入"）', envMeta.disabledByEnv === true)
ok('元信息里的 enabled 仍是设置值（不把开关状态也改掉）', envMeta.enabled === true)
process.env[host.SHAPE_DISABLE_ENV] = '0'
ok('别的值（0）不算逃生开关生效', host.shapePromptText({ shapeEnabled: true }).startsWith('# i-have-adhd'))
delete process.env[host.SHAPE_DISABLE_ENV]

// --------------------------------------------------------- 3. 段名 / 段序 --
console.log('\n— 3. 段名与段序 —')
ok('段名带本插件前缀（宿主内唯一）', host.SHAPE_SECTION === 'dsh-cache-control:shape-gate')
ok('段名与另两段都不同', host.SHAPE_SECTION !== host.GATE_SECTION && host.SHAPE_SECTION !== host.PONY_SECTION)
ok('三段有序：400 → 405 → 410', host.GATE_SECTION_ORDER < host.PONY_SECTION_ORDER
  && host.PONY_SECTION_ORDER < host.SHAPE_SECTION_ORDER, host.GATE_SECTION_ORDER + '/' + host.PONY_SECTION_ORDER + '/' + host.SHAPE_SECTION_ORDER)
ok('段序仍落在 plan 政策(500) 之前', host.SHAPE_SECTION_ORDER < 500)
ok('沿用并入前的 order 410（老会话的段序观感不变）', host.SHAPE_SECTION_ORDER === 410)

// --------------------------------------------------- 4. 三段互不串扰 --
console.log('\n— 4. 三段各自独立（缓存 / 文本 / override）—')
ok('形状段不含 ponytail 内容', !on.includes('Ponytail') && !on.includes('七级梯子'))
ok('形状段不含会话守则内容', !on.includes('独立研判') && !on.includes('少犯错优先'))
ok('ponytail 段不含形状内容', !host.ponytailPromptText({ ponytailEnabled: true }).includes('i-have-adhd'))
ok('会话守则段不含形状正文（只剩 R4 归属声明，见第 7 节）',
  !host.gatePromptText({ gateEnabled: true }).includes('发送前自检'))
fs.writeFileSync(gateFile, '门禁 A', 'utf8')
fs.writeFileSync(ponyFile, '懒码 B', 'utf8')
const s1 = host.shapePromptText({ shapeEnabled: true })
host.gatePromptText({ gateEnabled: true })
host.ponytailPromptText({ ponytailEnabled: true })
const s2 = host.shapePromptText({ shapeEnabled: true })
ok('读另两段不影响形状段文本', s1 === s2 && s1.startsWith('# i-have-adhd'))
fs.writeFileSync(shapeFile, '形状 C', 'utf8')
ok('写 shape.md 后另两段仍读自己的 override',
  host.gatePromptText({ gateEnabled: true }) === '门禁 A' && host.ponytailPromptText({ ponytailEnabled: true }) === '懒码 B')
ok('形状段读到自己新写的 override', host.shapePromptText({ shapeEnabled: true }) === '形状 C')

// ------------------------------------------------------- 5. 截断三元组 --
console.log('\n— 5. 截断三元组 —')
const big = '形'.repeat(Math.ceil((host.GATE_MAX_BYTES + 2000) / 3))
await host.writeShapeOverride(big)
const meta = await host.shapeMeta({ shapeEnabled: true })
ok('超长 ⇒ truncated=true 显式标记', meta.truncated === true)
ok('originalBytes > keptBytes ≤ 上限', meta.originalBytes > meta.keptBytes && meta.keptBytes <= host.GATE_MAX_BYTES,
  meta.originalBytes + ' → ' + meta.keptBytes + ' / ' + host.GATE_MAX_BYTES)
ok('text 与 keptBytes 同源', Buffer.byteLength(meta.text, 'utf8') === meta.keptBytes)
ok('截断带可见提示', meta.text.includes('省略'))

console.log('\n— 6. 清除 override 回到内置 —')
await host.writeShapeOverride('')
ok('override 文件已删', !fs.existsSync(shapeFile))
const back = await host.shapeMeta({ shapeEnabled: false })
ok('source=builtin 且命中最长内置全文', back.source === 'builtin' && back.text.startsWith('# i-have-adhd'))
ok('开关关时元信息 enabled=false（界面画开关用它）', back.enabled === false)
ok('内置正文本身无成对花括号', !/\{\{|\}\}/.test(back.text))
await host.writeShapeOverride('形状 {{model}} 与 {{bogus}} 都不许炸\na } b 孤立保留')
const dirty = host.shapePromptText({ shapeEnabled: true })
ok('成对花括号被中和', !/\{\{|\}\}/.test(dirty) && dirty.includes('｛｛model｝｝'))
ok('孤立单花括号不误伤', dirty.includes('a } b'))
fs.unlinkSync(gateFile)
fs.unlinkSync(ponyFile)

// --------------------------------------------------- 7. 不重复注入的护栏 --
console.log('\n— 7. 会话守则里不许再有形状正文 —')
const gateText = host.gatePromptText({ gateEnabled: true })
ok('守则段不含 P1–P10 规则正文（否则与形状段重复注入）',
  !gateText.includes('首行即可行动') && !gateText.includes('发送前自检'))
ok('守则段保留 R4 归属声明，并指向新的真源',
  gateText.includes('R4 输出形状') && gateText.includes('shape-gate.md'))
ok('守则段写明原提供方已下线（免得有人再去装回那个插件）', gateText.includes('dsh-output-shape'))
// 记录一下这两段一起注入时的实际体积（每请求都花，回归时能一眼看出是否翻倍）
const both = Buffer.byteLength(gateText, 'utf8') + Buffer.byteLength(on, 'utf8')
ok('守则 + 形状两段合计体积在合理量级（< 16 KB，不因重复注入翻倍）', both < 16 * 1024,
  both + ' B ≈ ' + Math.round(both / 4) + ' tokens/请求')

// --------------------------------------------------------- 8. 按需技能 --
console.log('\n— 8. 并入的两条按需技能同源 —')
const names = host.RULE_SKILLS.map((s) => s.name)
ok('注册的技能就是并入前那两条', names.join(',') === 'i-have-adhd,ponytail', names.join(','))
ok('两条都有 description（目录里不许躺说不清干什么的技能）',
  host.RULE_SKILLS.every((s) => typeof s.description === 'string' && s.description.length > 30))
ok('两条都有 whenToUse', host.RULE_SKILLS.every((s) => typeof s.whenToUse === 'string' && s.whenToUse.length > 10))
const adhd = host.RULE_SKILLS.find((s) => s.name === 'i-have-adhd')
const pony = host.RULE_SKILLS.find((s) => s.name === 'ponytail')
ok('i-have-adhd 技能正文 === 形状段注入文本（同一份，不会漂）',
  adhd.body() === host.shapePromptText({ shapeEnabled: true }))
ok('ponytail 技能正文 === ponytail 段注入文本（同一份，不会漂）',
  pony.body() === host.ponytailPromptText({ ponytailEnabled: true }))
ok('技能正文里没有 YAML frontmatter 残留',
  !adhd.body().startsWith('---') && !pony.body().startsWith('---'))
ok('技能指向的内置文件真实存在',
  fs.existsSync(adhd.builtinFile) && fs.existsSync(pony.builtinFile))
ok('i-have-adhd 指的就是 shape-gate.md（真源只有一份）',
  path.basename(adhd.builtinFile) === 'shape-gate.md')
await host.writeShapeOverride('')
await host.writeShapeOverride('')
ok('技能正文跟随 override（"技能里读到的 = 提示词里注入的"）', (() => {
  fs.writeFileSync(shapeFile, '形状自定义 D', 'utf8')
  const same = adhd.body() === '形状自定义 D' && adhd.body() === host.shapePromptText({ shapeEnabled: true })
  fs.unlinkSync(shapeFile)
  adhd.body()
  return same
})())

// ------------------------------------------------------------ 9. 路由 --
console.log('\n— 9. /cc/shape.json 路由 —')
const routes = new Map()
const webServer = { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }
const sections = []
const ctx = {
  get: (n) => {
    if (n === 'webServer') return webServer
    if (n === 'skills') return { register: () => () => {} }
    return undefined
  },
  effect: (fn) => fn(),
  inject: (deps, cb) => cb({ systemPrompt: { section: (s) => { sections.push(s); return () => {} } } }),
}
await host.apply(ctx)
ok('路由 /cc/shape.json 已注册', routes.has('/cc/shape.json'))
ok('同时注册了形状段（段名 + order 都对）',
  sections.some((s) => s.name === host.SHAPE_SECTION && s.order === host.SHAPE_SECTION_ORDER),
  sections.map((s) => s.name + '@' + s.order).join(' '))
const shapeSection = sections.find((s) => s.name === host.SHAPE_SECTION)
ok('段文本函数默认（未表态）就给出规则正文', shapeSection.text().startsWith('# i-have-adhd'))

/** 直接喂 handler 假 req/res，不起端口：路由逻辑本身不需要真 socket。 */
function call(method, payload) {
  return new Promise((resolve, reject) => {
    const handler = routes.get('/cc/shape.json')
    if (!handler) { reject(new Error('no route')); return }
    const req = {
      method,
      on(ev, cb) {
        if (ev === 'data' && payload !== undefined) cb(Buffer.from(JSON.stringify(payload)))
        if (ev === 'end') cb()
        return this
      },
    }
    const res = {
      writeHead(status) { this.status = status },
      end(text) { resolve({ status: this.status, body: text ? JSON.parse(text) : null }) },
    }
    Promise.resolve(handler(req, res)).catch(reject)
  })
}
const got = await call('GET')
ok('GET 返回 shape 元信息（键名就是 shape，不是 ponytail）',
  got.status === 200 && got.body.ok === true && got.body.shape && got.body.shape.builtinPath.endsWith('shape-gate.md'))
ok('GET 的 enabled 反映"默认开"', got.body.shape.enabled === true)
const put = await call('PUT', { text: '形状路由写入的文本' })
ok('PUT 写入 override 并回带截断三元组与 source',
  put.status === 200 && put.body.ok === true && put.body.source === 'override'
  && put.body.bytes === Buffer.byteLength('形状路由写入的文本', 'utf8') && put.body.truncated === false)
ok('PUT 之后 GET 读到同一份', (await call('GET')).body.shape.text === '形状路由写入的文本')
const cleared = await call('PUT', { text: '' })
ok('PUT 空文本 ⇒ 删 override、回到内置', cleared.body.source === 'builtin')
const bad = await call('DELETE')
ok('写方法之外一律 405（裸 GET 不改状态的反向）', bad.status === 405)

fs.rmSync(ROOT, { recursive: true, force: true })
console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败')
process.exitCode = fail === 0 ? 0 : 1
