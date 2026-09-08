// 验证 dsh-cache-control 会话门禁：把插件的 gate 解析器接到 DSH 真实的
// renderPrompt / interpolate 上，证明 (1) 关=空段被丢弃 (2) 开=规则入提示词
// (3) 用户写坏花括号也不会让组装抛错 (4) 压缩行改写逻辑无回归。
const PLUGIN = process.env.DSH_CC_PLUGIN || 'D:/DeepSeek/dsh-plugins/dsh-cache-control/';
const APP = process.env.DSH_APP_MODULES || 'D:/deepseek-harness/DSH Desktop/resources/app/node_modules/';
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')) }
}

const host = await import('file:///' + PLUGIN + 'index.js')
const spMod = await import('file:///' + APP + '@deepseek-ai/dsh-system-prompt/lib/index.js')
const { renderPrompt, FIRST_PARTY_SECTION_ORDER } = spMod
const fs = await import('node:fs')
const pathMod = await import('node:path')

// 本套件会写 settings.json 与 gate.md override ⇒ 只能在临时 home 里跑。
// （它以前直接指向真实 $DSH_HOME，靠"最后还原"兜底：中途崩掉就会把一串
//   {{bogus_var}} 测试垃圾留在真实 gate.md 里，静默顶替掉用户的规则。已改掉。）
const REAL_HOME = pathMod.join(process.env.APPDATA, 'dsh-desktop', 'harness')
const realSettingsPath = pathMod.join(REAL_HOME, 'dsh-cache-control', 'settings.json')
const realOverridePath = pathMod.join(REAL_HOME, 'dsh-cache-control', 'gate.md')
const realPresetPath = pathMod.join(REAL_HOME, 'profiles', 'node_modules', '@deepseek-ai',
  'dsh-agent-presets', 'presets', 'standard', 'agent.cordis.yml')
const realBefore = {
  settings: fs.readFileSync(realSettingsPath, 'utf8'),
  hadOverride: fs.existsSync(realOverridePath),
  preset: fs.readFileSync(realPresetPath, 'utf8'),
}

const ROOT = process.env.DSH_TOOL_HOME || 'D:\\DeepSeek\\03-调试临时\\gate-fn-home';
fs.rmSync(ROOT, { recursive: true, force: true })
fs.mkdirSync(pathMod.join(ROOT, 'dsh-cache-control'), { recursive: true })
const tempPresetDir = pathMod.join(ROOT, 'profiles/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard')
fs.mkdirSync(tempPresetDir, { recursive: true })
fs.copyFileSync(realPresetPath, pathMod.join(tempPresetDir, 'agent.cordis.yml'))
fs.copyFileSync(realSettingsPath, pathMod.join(ROOT, 'dsh-cache-control', 'settings.json'))
process.env.DSH_HOME = ROOT

const settingsFile = pathMod.join(ROOT, 'dsh-cache-control', 'settings.json')
const overrideFile = pathMod.join(ROOT, 'dsh-cache-control', 'gate.md')
const settingsBackup = realBefore.settings

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
ok('开：段序在 persona 之后、web-surface 之前',
  rendered.indexOf('会话守则') > rendered.indexOf('coding agent') && rendered.indexOf('会话守则') < rendered.indexOf('Web GUI'))
const gateOrder = host.GATE_SECTION_ORDER
ok('段序常量落在 FIRST_PARTY 稀疏区间内',
  gateOrder > FIRST_PARTY_SECTION_ORDER.DEPLOYMENT_PERSONA && gateOrder < FIRST_PARTY_SECTION_ORDER.PLAN_POLICY,
  'gate=' + gateOrder + ' persona=' + FIRST_PARTY_SECTION_ORDER.DEPLOYMENT_PERSONA + ' plan=' + FIRST_PARTY_SECTION_ORDER.PLAN_POLICY)
ok('段名唯一且带插件前缀', host.GATE_SECTION === 'dsh-cache-control:session-gate')
const bytes = Buffer.byteLength(on, 'utf8')
ok('规则体积在上限内', bytes > 0 && bytes <= 6144, bytes + ' B ≈ ' + Math.round(bytes / 2.6) + ' tokens/请求')
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
ok('超长文本被截到 ≤ 上限', Buffer.byteLength(big, 'utf8') <= 6144, Buffer.byteLength(big, 'utf8') + ' B')
ok('截断带可见提示', big.includes('省略'))
await host.writeGateOverride('')

console.log('\n— 5. 设置清洗（两个开关独立）—')
ok('sanitize 保留 gateEnabled', host.sanitize({ enabled: true, gateEnabled: true }).gateEnabled === true)
ok('gateEnabled 缺省为 false（不被 undefined 污染）', host.sanitize({ enabled: true }).gateEnabled === false)
ok('非 true 值一律视为关', host.sanitize({ gateEnabled: 'yes' }).gateEnabled === false)
ok('部分 PUT 合并后不丢压缩字段', (() => {
  const merged = host.sanitize({ ...JSON.parse(settingsBackup), gateEnabled: true })
  return merged.enabled === true && merged.triggerPct === 30 && merged.retainPct === 4 && merged.gateEnabled === true
})(), JSON.stringify(host.sanitize({ ...JSON.parse(settingsBackup), gateEnabled: true })))
ok('DEFAULTS 含 gateEnabled', host.DEFAULTS.gateEnabled === false)

console.log('\n— 6. 压缩行改写无回归（只在内存里跑）—')
const presetFile = pathMod.join(process.env.DSH_HOME, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets', 'standard', 'agent.cordis.yml')
const original = fs.readFileSync(presetFile, 'utf8')
const vals = host.resolveValues({ triggerPct: 30, retainPct: 4, auto: true })
const spliced = host.spliceCompactionRow(original, vals)
ok('开启：写出 managed 标记 + 三个参数', spliced.includes('managed by dsh-cache-control') && spliced.includes('thresholdRatio: 0.30') && spliced.includes('retainRatio: 0.04'))
ok('关闭：标记与 config 一并移除', !host.spliceCompactionRow(original, null).includes('thresholdRatio'))
ok('幂等：同参数重写结果不变', host.spliceCompactionRow(spliced, vals) === spliced)
ok('只动那一行块（其余字节不变）', spliced.replace(/ {6}# managed[^\n]*\n {6}config:\n {8}thresholdRatio[^\n]*\n {8}retainRatio[^\n]*\n {8}auto:[^\n]*/m, '') === original.replace(/ {6}# managed[^\n]*\n {6}config:\n {8}thresholdRatio[^\n]*\n {8}retainRatio[^\n]*\n {8}auto:[^\n]*/m, ''))
ok('磁盘上的 preset 文件未被本次验证改动', fs.readFileSync(presetFile, 'utf8') === original)

console.log('\n— 7. 清理：临时目录删掉，真实 home 必须一根毫毛没动 —')
ok('临时 settings 写过又还原（自证测试确实在动文件）', (() => {
  fs.writeFileSync(settingsFile, settingsBackup, 'utf8')
  return fs.readFileSync(settingsFile, 'utf8') === settingsBackup
})())
ok('override 已清掉', !fs.existsSync(overrideFile))
fs.rmSync(ROOT, { recursive: true, force: true })
ok('真实 settings.json 未被本套件改动', fs.readFileSync(realSettingsPath, 'utf8') === realBefore.settings,
  fs.readFileSync(realSettingsPath, 'utf8').trim().replace(/\s+/g, ' '))
ok('真实 gate.md 存在状态未变', fs.existsSync(realOverridePath) === realBefore.hadOverride)
ok('真实 preset 未被本套件改动', fs.readFileSync(realPresetPath, 'utf8') === realBefore.preset)

console.log('\n' + pass + ' passed, ' + fail + ' failed\n')
process.exitCode = fail === 0 ? 0 : 1
