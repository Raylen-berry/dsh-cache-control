// 验证 dsh-cache-control 会话门禁：把插件的 gate 解析器接到 DSH 真实的
// renderPrompt 上，证明 (1) 关=空段被丢弃 (2) 开=规则入提示词
// (3) 用户写坏花括号也不会让组装抛错 (4) 设置清洗不丢字段、压缩接管确已移除。
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
// 本包在 Node ESM 下没有自引用导出，裸 import('@deepseek-ai/dsh-system-prompt') 不会查自己的
// node_modules ⇒ 用 createRequire(仓库 package.json) 解析（CI 里 npm ci 装出的那份），APP 兜底。
const { createRequire } = await import('node:module')
const selfRequire = createRequire(new URL('./package.json', import.meta.url))
const APP = process.env.DSH_APP_MODULES || '../node_modules/';
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')) }
}

// SECTION_ORDERS 未从包出口导出 —— 从**已解析的那份包**的源码文本取数值，不依赖私有件符号。
let spSource = null   // importSystemPrompt() 里填；hostSectionOrders 与它读同一份文件
async function importSystemPrompt() {
  try {
    const p = selfRequire.resolve('@deepseek-ai/dsh-system-prompt').replace(/\\/g, '/')
    spSource = selfRequire.resolve('@deepseek-ai/dsh-system-prompt')
    return await import(__localFile(p, ''))
  } catch {
    return await import(__localFile(APP, '@deepseek-ai/dsh-system-prompt/lib/index.js'))
  }
}
function hostSectionOrders() {
  const srcPath = spSource || pathMod.join(process.platform === 'win32' ? APP.replace(/\//g, '\\') : APP, '@deepseek-ai', 'dsh-system-prompt', 'lib', 'index.js')
  const src = fs.readFileSync(srcPath, 'utf8')
  const grab = (k) => Number(new RegExp(k + ':\\s*([\\de]+)').exec(src)[1])
  return { DEPLOYMENT_PERSONA: grab('DEPLOYMENT_PERSONA_PREFIX'), PLAN_POLICY: grab('PLAN_POLICY') }
}
const fs = await import('node:fs')
const pathMod = await import('node:path')
const os = await import('node:os')

const host = await import(__localFile(PLUGIN, 'index.js'))
const spMod = await importSystemPrompt()
const { renderPrompt } = spMod

// 本套件会写 settings.json 与 gate.md override ⇒ 只能在临时 home 里跑。
// （它以前直接指向真实 $DSH_HOME，靠"最后还原"兜底：中途崩掉就会把一串
//   {{bogus_var}} 测试垃圾留在真实 gate.md 里，静默顶替掉用户的规则。已改掉。）
//
// v1.14.0：压缩接管（改写 agent.cordis.yml）已移除 ⇒ 本套件不再需要任何 preset 夹具，
// 也不再对照真实安装文件，只剩"真实 home 的 settings.json / gate.md 没被碰过"两条守护。
const REAL_HOME = pathMod.join(process.env.APPDATA || '', 'dsh-desktop', 'harness')
const realSettingsPath = pathMod.join(REAL_HOME, 'dsh-cache-control', 'settings.json')
const realOverridePath = pathMod.join(REAL_HOME, 'dsh-cache-control', 'gate.md')

const ROOT = process.env.DSH_TOOL_HOME || pathMod.join(os.tmpdir(), 'gate-fn-home-' + process.pid)
fs.rmSync(ROOT, { recursive: true, force: true })
fs.mkdirSync(pathMod.join(ROOT, 'dsh-cache-control'), { recursive: true })
process.env.DSH_HOME = ROOT

// 「真实文件未被改动」的收尾对照：本机有就比，CI 没有就跳过对应两条（如实标注）。
const realBefore = fs.existsSync(realSettingsPath) ? {
  settings: fs.readFileSync(realSettingsPath, 'utf8'),
  hadOverride: fs.existsSync(realOverridePath),
} : null

const settingsFile = pathMod.join(ROOT, 'dsh-cache-control', 'settings.json')
const overrideFile = pathMod.join(ROOT, 'dsh-cache-control', 'gate.md')
// 断言基线固定自写（不拿真实安装文件当期望值来源：CI 上没有 %APPDATA%）。
const settingsBackup = JSON.stringify({ ...host.DEFAULTS, gateEnabled: true })
fs.writeFileSync(settingsFile, settingsBackup, 'utf8')

const render = (gateText) => renderPrompt({
  sections: [
    { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
    { name: 'deployment:persona', text: 'You are a coding agent powered by the qwen3.8-flash model. Your working directory is D:\\DeepSeek.' },
    { name: 'dsh-cache-control:session-gate', text: gateText },
    { name: 'app:web-surface', text: 'You are interacting with the user through the DeepSeek Harness Web GUI.' },
  ],
  variables: { model: 'qwen3.8-flash', cwd: 'D:\\DeepSeek' },
})

console.log('\n— 1. 开关与注入 —')
const off = host.gatePromptText({ gateEnabled: false })
ok('gateEnabled=false → 空串', off === '', JSON.stringify(off))
ok('关：整段从提示词中消失', render(off).indexOf('会话守则') < 0)
ok('关：相邻段仍在（不连带影响 persona/web-surface）', render(off).indexOf('Web GUI') >= 0)

const on = host.gatePromptText({ gateEnabled: true })
ok('gateEnabled=true → 内置规则全文', on.startsWith('# 会话守则'), on.slice(0, 24).replace(/\n/g, ' '))
const rendered = render(on)
ok('开：R1/R2/R3 三条都在', ['独立研判', '不确定就问', '分工固定'].every((k) => rendered.includes(k)))
ok('开：v1.9.2–v1.9.5 新增的 R5/R6/R7 都在（防被误删）', ['少犯错优先', '查证再下结论', '谨慎执行'].every((k) => rendered.includes(k)))
ok('开：段序在 persona 之后、web-surface 之前',
  rendered.indexOf('会话守则') > rendered.indexOf('coding agent') && rendered.indexOf('会话守则') < rendered.indexOf('Web GUI'))
// 段序区间判据见文件头的 hostSectionOrders()（v1.9.4：旧断言引用了从未导出的
// FIRST_PARTY_SECTION_ORDER.DEPLOYMENT_PERSONA，本套件一直在这一行崩）。
const ORDERS = hostSectionOrders()
const gateOrder = host.GATE_SECTION_ORDER
ok('段序常量落在 persona(0) 与 plan 政策(500) 之间',
  gateOrder > ORDERS.DEPLOYMENT_PERSONA && gateOrder < ORDERS.PLAN_POLICY,
  'gate=' + gateOrder + ' persona=' + ORDERS.DEPLOYMENT_PERSONA + ' plan=' + ORDERS.PLAN_POLICY)
ok('段名唯一且带插件前缀', host.GATE_SECTION === 'dsh-cache-control:session-gate')
// 体积与 token 换算由 host.GATE_MAX_BYTES 推，不写死数字（上限改动时断言自动跟着走）
const bytes = Buffer.byteLength(on, 'utf8')
ok('规则体积在上限内', bytes > 0 && bytes <= host.GATE_MAX_BYTES,
  bytes + ' B ≈ ' + Math.round(bytes / 4) + ' tokens/请求（中文按 4 B/token）')
ok('内置规则不含成对花括号（无需中和即安全）', !/\{\{|\}\}/.test(on))

console.log('\n— 2. 花括号 / 提示词注入防御 —')
const hostile = ['前文', '{{model}} 合法变量', '{{bogus_var}} 未知变量', '{{unclosed 只有开', 'a } b {{ 孤立', '{{}}空引用', '{{a}}{{b}} 连着写'].join('\n')
fs.writeFileSync(overrideFile, hostile, 'utf8')
const hostileText = host.gatePromptText({ gateEnabled: true })
let threw = ''
let out = ''
try { out = render(hostileText) } catch (e) { threw = String(e && e.message || e) }
ok('脏文本不会让 renderPrompt 抛错', threw === '', threw)
ok('成对花括号已全部中和', !/\{\{|\}\}/.test(hostileText), hostileText.slice(0, 40).replace(/\n/g, ' '))
ok('{{model}} 未被替换成真值（只看门禁段自己）', hostileText.indexOf('qwen3.8-flash') < 0 && !/\{\{model\}\}/.test(hostileText))
ok('未知变量名不残留花括号', hostileText.indexOf('bogus_var') >= 0 && !/\{\{bogus/.test(hostileText))
ok('孤立单花括号原样保留（不误伤正文）', hostileText.includes('a } b'))
ok('正文行数未被破坏', hostileText.split('\n').length === hostile.split('\n').length)
ok('override 生效时 source=override', (await host.gateMeta({ gateEnabled: true })).source === 'override')

console.log('\n— 3. 清除 override 回到内置 —')
await host.writeGateOverride('')
ok('override 文件已删除', !fs.existsSync(overrideFile))
const meta = await host.gateMeta({ gateEnabled: true })
ok('回到 builtin 并重新命中内置文本', meta.source === 'builtin' && meta.text.startsWith('# 会话守则'), meta.bytes + ' B / ' + meta.lines + ' 行')
ok('gateMeta 暴露两条路径', meta.builtinPath.includes('session-gate.md') && meta.overridePath.endsWith('gate.md'))
ok('开关关时 gateMeta.enabled=false', (await host.gateMeta({ gateEnabled: false })).enabled === false)

console.log('\n— 4. 截断上限 —')
fs.writeFileSync(overrideFile, 'x'.repeat(40000), 'utf8')
const big = host.gatePromptText({ gateEnabled: true })
ok('超长文本被截到 ≤ 上限', Buffer.byteLength(big, 'utf8') <= host.GATE_MAX_BYTES, Buffer.byteLength(big, 'utf8') + ' B')
ok('截断带可见提示', big.includes('省略'))
await host.writeGateOverride('')

console.log('\n— 5. 设置清洗（两个开关独立）—')
ok('sanitize 保留 gateEnabled', host.sanitize({ gateEnabled: true }).gateEnabled === true)
ok('gateEnabled 缺省为 false（不被 undefined 污染）', host.sanitize({}).gateEnabled === false)
ok('非 true 值一律视为关', host.sanitize({ gateEnabled: 'yes' }).gateEnabled === false)
ok('部分 PUT 合并后不丢同族开关', (() => {
  const merged = host.sanitize({ ...JSON.parse(settingsBackup), ponytailEnabled: true })
  return merged.ponytailEnabled === true && merged.gateEnabled === true && merged.shapeEnabled === host.DEFAULTS.shapeEnabled
})(), JSON.stringify(host.sanitize({ ...JSON.parse(settingsBackup), ponytailEnabled: true })))
ok('DEFAULTS 含 gateEnabled', host.DEFAULTS.gateEnabled === false)
ok('v1.14.0：压缩字段不再进 sanitize 结果（旧盘残留会被下一次保存清掉）',
  !('enabled' in host.sanitize({ enabled: true })) && !('triggerPct' in host.sanitize({ triggerPct: 30 })))

console.log('\n— 6. 压缩接管已移除（v1.14.0）—')
ok('host 不再导出压缩接管的写盘函数',
  !host.resolveValues && !host.spliceCompactionRow && !host.applyToStandard && !host.readComposition)
ok('DEFAULTS 里不再有压缩开关字段',
  !('enabled' in host.DEFAULTS) && !('triggerPct' in host.DEFAULTS) && !('retainPct' in host.DEFAULTS) && !('auto' in host.DEFAULTS))

console.log('\n— 7. 清理：临时目录删掉，真实 home 必须一根毫毛没动 —')
ok('临时 settings 写过又还原（自证测试确实在动文件）', (() => {
  fs.writeFileSync(settingsFile, settingsBackup, 'utf8')
  return fs.readFileSync(settingsFile, 'utf8') === settingsBackup
})())
ok('override 已清掉', !fs.existsSync(overrideFile))
fs.rmSync(ROOT, { recursive: true, force: true })
if (realBefore) {
  ok('真实 settings.json 未被本套件改动', fs.readFileSync(realSettingsPath, 'utf8') === realBefore.settings)
  ok('真实 gate.md 存在状态未变', fs.existsSync(realOverridePath) === realBefore.hadOverride)
} else {
  console.log('  SKIP  真实 home 对照 2 条 —— 本机没有 DSH 安装态（CI），跳过并如实标注')
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n')
process.exitCode = fail === 0 ? 0 : 1
