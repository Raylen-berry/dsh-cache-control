// 套件：ponytail 编码纪律段（v1.10.0）—— 与会话守则同构的第二段常驻规则。
//
// 盯住的缺陷类别：两段规则共用一条代码路径时最容易互相串 ——
//   ① 开关独立：开 ponytail 不能把门禁段带出来，反之亦然；
//   ② 缓存独立：改 ponytail.md 不许顶掉门禁段的 mtime+size 缓存（loadRuleFile 泛化时踩过）；
//   ③ 截断三元组与文本同源（沿用 gate 的显式标记口径）；
//   ④ override 生效/清除回到内置；
//   ⑤ sanitize 里 ponytailEnabled 缺省 false、非 true 一律视为关；
//   ⑥ 花括号中和对 ponytail 同样成立（内置正文里有 `<input type="date">` 之类的尖括号，
//      但没有成对花括号 —— 有就要确认 renderPrompt 不炸）。
//
// 只在临时 DSH_HOME 里跑，绝不动 %APPDATA% 下真实 settings.json / ponytail.md。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PLUGIN = process.env.DSH_CC_PLUGIN || 'D:/DeepSeek/dsh-plugins/dsh-cache-control/'
const host = await import('file:///' + PLUGIN + 'index.js')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')) }
}

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-pony-'))
process.env.DSH_HOME = ROOT
fs.mkdirSync(path.join(ROOT, 'dsh-cache-control'), { recursive: true })
const ponyFile = path.join(ROOT, 'dsh-cache-control', 'ponytail.md')
const gateFile = path.join(ROOT, 'dsh-cache-control', 'gate.md')

console.log('\n— 1. 开关与注入 —')
ok('ponytailEnabled=false → 空串', host.ponytailPromptText({ ponytailEnabled: false }) === '')
ok('sanitize 不认识 ⇒ 缺省为关', host.sanitize({}).ponytailEnabled === false)
ok('非 true 值一律视为关', host.sanitize({ ponytailEnabled: 'yes' }).ponytailEnabled === false)
ok('DEFAULTS 含 ponytailEnabled=false', host.DEFAULTS.ponytailEnabled === false)
const on = host.ponytailPromptText({ ponytailEnabled: true })
ok('开：内置 ponytail 全文', on.startsWith('# Ponytail'), on.slice(0, 24).replace(/\n/g, ' '))
ok('开：梯子/根因/禁抽象三个关键内容都在', ['停在第一级站得住的地方', '修根因', '没有要求的抽象'].every((k) => on.includes(k)))
const gateOn = host.gatePromptText({ gateEnabled: true })
ok('门禁段不含 ponytail 内容（两段各读各的文件）', !gateOn.includes('Ponytail') && !gateOn.includes('七级梯子'))
ok('ponytail 段不是门禁段的别名', on !== gateOn)
ok('段名唯一且带插件前缀', host.PONY_SECTION === 'dsh-cache-control:ponytail-gate' && host.PONY_SECTION !== host.GATE_SECTION)
ok('段序落在守则(400)/形状(405) 之后、plan 政策(500) 之前',
  host.PONY_SECTION_ORDER > 405 && host.PONY_SECTION_ORDER < 500, 'order=' + host.PONY_SECTION_ORDER)

console.log('\n— 2. 缓存独立（两段的回归核心）—')
fs.writeFileSync(gateFile, '门禁自定义 A', 'utf8')
const g1 = host.gatePromptText({ gateEnabled: true })
host.ponytailPromptText({ ponytailEnabled: true })           // 读 ponytail（走另一份缓存）
const g2 = host.gatePromptText({ gateEnabled: true })
ok('读 ponytail 不影响门禁文本', g1 === g2 && g1 === '门禁自定义 A')
fs.writeFileSync(ponyFile, 'pony 自定义 B', 'utf8')
ok('写 ponytail.md 后门禁仍是自己的 override', host.gatePromptText({ gateEnabled: true }) === '门禁自定义 A')
ok('ponytail 读到自己的新文本', host.ponytailPromptText({ ponytailEnabled: true }) === 'pony 自定义 B')

console.log('\n— 3. 截断三元组 —')
const big = '懒'.repeat(Math.ceil((host.GATE_MAX_BYTES + 2000) / 3))
await host.writePonytailOverride(big)
const meta = await host.ponytailMeta({ ponytailEnabled: true })
ok('超长 ⇒ truncated=true 显式标记', meta.truncated === true)
ok('originalBytes > keptBytes ≤ 上限', meta.originalBytes > meta.keptBytes && meta.keptBytes <= host.GATE_MAX_BYTES,
  meta.originalBytes + ' → ' + meta.keptBytes + ' / ' + host.GATE_MAX_BYTES)
ok('text 与 keptBytes 同源', Buffer.byteLength(meta.text, 'utf8') === meta.keptBytes)
ok('截断带可见提示', meta.text.includes('省略'))

console.log('\n— 4. 清除 override 回到内置 —')
await host.writePonytailOverride('')
ok('override 文件已删', !fs.existsSync(ponyFile))
const back = await host.ponytailMeta({ ponytailEnabled: true })
ok('source=builtin 且命中内置全文', back.source === 'builtin' && back.text.startsWith('# Ponytail'))
ok('gateMeta 不受影响（仍读自己的 override）', (await host.gateMeta({ gateEnabled: true })).text === '门禁自定义 A')
fs.unlinkSync(gateFile)

console.log('\n— 5. 花括号防御 —')
await host.writePonytailOverride('梯子 {{model}} 与 {{bogus}} 都不许炸\na } b 孤立保留')
const dirty = host.ponytailPromptText({ ponytailEnabled: true })
ok('成对花括号被中和', !/\{\{|\}\}/.test(dirty) && dirty.includes('｛｛model｝｝'))
ok('孤立单花括号不误伤', dirty.includes('a } b'))
await host.writePonytailOverride('')
ok('内置正文本身无成对花括号', !/\{\{|\}\}/.test(host.ponytailPromptText({ ponytailEnabled: true })))

fs.rmSync(ROOT, { recursive: true, force: true })
console.log('\n' + pass + ' passed, ' + fail + ' failed\n')
process.exitCode = fail === 0 ? 0 : 1
