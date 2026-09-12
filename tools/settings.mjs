// 会话策略 · 设置导出 / 导入（换机器用；开发与运维脚本，不进 npm 包）
//
// 为什么需要它：本插件四项开关的**全部状态**都在 $DSH_HOME/dsh-cache-control/
// （settings.json + ② 会话守则的 gate.md override），**不随仓库走** ⇒ 换机器后四项全是默认关，
// 用户看到的就是"装了但什么都没发生"。这个脚本把那份状态导出成可携带的 JSON，并在新机器上一键写回。
//
// 用法：
//   node tools/settings.mjs show
//   node tools/settings.mjs export [--out <文件>]
//   node tools/settings.mjs import <文件> [--yes]     # 覆盖前自动备份 settings.json / gate.md
//
// 与 host 的关系：host 的 readSettings() 每次读盘都会过一遍 sanitize()，
// 所以即使本脚本的钳制口径哪天和 host 漂了，**host 仍会在读取时再钳一次**（不会写坏引擎侧）。
// 这里的钳制是为了让导出文件本身是干净、可读、可 review 的。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PLUGIN = 'dsh-cache-control'
const FORMAT = 'dsh-plugin-settings/1'
const dshHome = () => process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const dir = () => path.join(dshHome(), PLUGIN)
const settingsFile = () => path.join(dir(), 'settings.json')
const gateFile = () => path.join(dir(), 'gate.md')

const DEFAULTS = { enabled: false, triggerPct: 25, retainPct: 5, auto: true, gateEnabled: false, pinLastUser: false, clearBubble: false, pinBlur: 10, pinMaxVh: 38, chatWidth: 80, chatWidthEnabled: false }
const CHAT_MIN = 30, CHAT_MAX = 100, GATE_MAX_BYTES = 6144

export function validate(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const notes = []
  const out = { ...DEFAULTS }
  for (const k of Object.keys(src)) if (!(k in DEFAULTS)) notes.push('丢弃未知字段 ' + k)
  out.auto = src.auto !== false
  out.gateEnabled = src.gateEnabled === true
  out.pinLastUser = src.pinLastUser === true
  out.clearBubble = src.clearBubble === true
  out.chatWidthEnabled = src.chatWidthEnabled === true
  out.enabled = src.enabled === true
  let tp = Math.round(Number(src.triggerPct)); if (!Number.isFinite(tp)) tp = DEFAULTS.triggerPct
  out.triggerPct = Math.min(95, Math.max(5, tp))
  if (out.triggerPct !== tp) notes.push('触发点 ' + tp + ' ⇒ ' + out.triggerPct)
  let rp = Math.round(Number(src.retainPct)); if (!Number.isFinite(rp)) rp = DEFAULTS.retainPct
  out.retainPct = Math.min(out.triggerPct - 1, Math.max(1, rp))
  if (out.retainPct !== rp) notes.push('保留尾部 ' + rp + ' ⇒ ' + out.retainPct)
  let pb = Math.round(Number(src.pinBlur) * 10) / 10; if (!Number.isFinite(pb)) pb = DEFAULTS.pinBlur
  out.pinBlur = Math.min(24, Math.max(0, pb))
  if (out.pinBlur !== pb) notes.push('底衬模糊 ' + pb + ' ⇒ ' + out.pinBlur)
  let pv = Math.round(Number(src.pinMaxVh)); if (!Number.isFinite(pv) || pv <= 0) pv = DEFAULTS.pinMaxVh
  out.pinMaxVh = Math.min(80, Math.max(12, pv))
  if (out.pinMaxVh !== pv) notes.push('钉顶气泡上限 ' + pv + 'vh ⇒ ' + out.pinMaxVh)
  let cw = Math.round(Number(src.chatWidth))
  if (!Number.isFinite(cw) || cw <= 0 || cw > CHAT_MAX) { notes.push('对话页宽度 ' + src.chatWidth + ' 不是 30–100 的百分比 ⇒ 用默认 80%'); cw = 80 }
  out.chatWidth = Math.min(CHAT_MAX, Math.max(CHAT_MIN, cw))
  if (out.chatWidth !== cw) notes.push('对话页宽度 ' + cw + ' ⇒ ' + out.chatWidth)
  return { settings: out, notes }
}

const stripBom = (s) => s.replace(/^\uFEFF/, '')
function readJson(f) { try { return JSON.parse(stripBom(fs.readFileSync(f, 'utf8'))) } catch { return null } }
function readGate() { try { return stripBom(fs.readFileSync(gateFile(), 'utf8')) } catch { return null } }
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

const cmd = process.argv[2]
const args = process.argv.slice(3)
const flag = (n) => args.includes(n)

if (cmd === 'show') {
  const s = readJson(settingsFile())
  const gate = readGate()
  console.log('设置文件：' + settingsFile() + (s ? '' : '（不存在，用默认值）'))
  console.log(JSON.stringify(s || DEFAULTS, null, 2))
  console.log('规则 override：' + (gate === null ? '（没有，用插件内置 session-gate.md）' : gateFile() + '（' + Buffer.byteLength(gate) + ' 字节）'))
} else if (cmd === 'export') {
  const cur = readJson(settingsFile())
  const gate = readGate()
  if (!cur && gate === null) { console.error('没有可导出的东西（' + dir() + ' 里既没有 settings.json 也没有 gate.md）'); process.exit(1) }
  const { settings, notes } = validate(cur)
  const i = args.indexOf('--out')
  const out = i >= 0 ? args[i + 1] : path.join(process.cwd(), 'dsh-cache-control-settings-' + stamp().slice(0, 10) + '.json')
  const payload = { format: FORMAT, plugin: PLUGIN, pluginVersion: '1.5.0', exportedAt: new Date().toISOString(), host: os.hostname(), settings }
  if (gate !== null) payload.extra = { 'gate.md': gate }
  fs.writeFileSync(out, JSON.stringify(payload, null, 2), 'utf8')
  console.log('已导出 ' + out)
  console.log('  四项开关：省缓存=' + settings.enabled + ' 会话守则=' + settings.gateEnabled + ' 气泡置顶=' + settings.pinLastUser + ' 对话页=' + settings.chatWidthEnabled + '（' + settings.chatWidth + '%）')
  console.log('  规则 override：' + (gate === null ? '无' : Buffer.byteLength(gate) + ' 字节'))
  for (const n of notes) console.log('  注意：' + n)
  console.log('  ⚠ ① 省缓存改的是 $DSH_HOME 里 standard preset 的行，**不在这个文件里**：新机器导入后若想继续省缓存，去设置页把总开关关一次再打开（或让它保持开启并重启）。')
} else if (cmd === 'import') {
  const file = args.find((a) => !a.startsWith('--'))
  if (!file) { console.error('用法：node tools/settings.mjs import <文件> [--yes]'); process.exit(1) }
  const payload = readJson(file)
  if (!payload) { console.error('读不了这个文件（不存在或不是合法 JSON）'); process.exit(1) }
  if (payload.format !== FORMAT || payload.plugin !== PLUGIN) {
    console.error('不是本插件的设置文件（format=' + payload.format + ' plugin=' + payload.plugin + '，期望 ' + FORMAT + ' / ' + PLUGIN + '）')
    process.exit(1)
  }
  const { settings, notes } = validate(payload.settings)
  const gate = payload.extra && typeof payload.extra['gate.md'] === 'string' ? payload.extra['gate.md'] : null
  console.log('将写入：' + settingsFile() + (gate === null ? '' : ' 与 ' + gateFile()))
  console.log('  省缓存 ' + settings.enabled + '（触发 ' + settings.triggerPct + '% / 保留 ' + settings.retainPct + '% / 自动 ' + settings.auto + '）· 会话守则 ' + settings.gateEnabled + ' · 气泡置顶 ' + settings.pinLastUser + ' · 对话页 ' + settings.chatWidthEnabled + '（' + settings.chatWidth + '%）')
  for (const n of notes) console.log('  注意：' + n)
  if (gate !== null && Buffer.byteLength(gate) > GATE_MAX_BYTES) console.log('  ⚠ 规则文本 ' + Buffer.byteLength(gate) + ' 字节，超过 host 的 ' + GATE_MAX_BYTES + ' 上限，host 会截断。')
  if (!flag('--yes')) { console.log('（演练模式：加 --yes 才真正写入。现有设置与 gate.md 会先备份。）'); process.exit(0) }
  fs.mkdirSync(dir(), { recursive: true })
  for (const f of [settingsFile(), gateFile()]) {
    if (fs.existsSync(f)) { const bak = f + '.bak-' + stamp(); fs.copyFileSync(f, bak); console.log('  已备份 ' + path.basename(f) + ' → ' + path.basename(bak)) }
  }
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf8')
  if (gate !== null) fs.writeFileSync(gateFile(), gate, 'utf8')
  console.log('完成。**需要重启 DSH Desktop**（client 半在服务启动时 compose；② 会话守则的 host 半下一次组装即生效）。')
} else {
  console.log('会话策略 · 设置导出/导入\n  node tools/settings.mjs show\n  node tools/settings.mjs export [--out <文件>]\n  node tools/settings.mjs import <文件> [--yes]')
  console.log('\n换机器完整流程：')
  console.log('  旧机器: node tools/settings.mjs export --out D:\\dsh-cache-control-settings.json')
  console.log('  新机器: git clone → dsh plugin --profile web add link:<路径> → import → 重启 DSH Desktop')
  console.log('  另外两个插件各有自己的同款脚本：dsh-bg-atelier/tools/settings.mjs、dsh-browser-live/tools/settings.mjs')
}
