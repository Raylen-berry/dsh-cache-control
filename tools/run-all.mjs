#!/usr/bin/env node
// tools/run-all.mjs —— 发布前检查总入口：本地与 CI 跑的是同一条命令（npm test）。
//
//   node tools/run-all.mjs          跑全部：每套都跑完再汇总
//   node tools/run-all.mjs --list   只列清单，不执行
//
// 为什么不用 `npm test = a.mjs && b.mjs && ...`：那样第一套一失败后面的根本不跑，
// 一次 push 只能暴露一个错误。这里每套都跑、逐套列结果，任一套非 0 退出 ⇒ 本进程退出码 1 ⇒ CI 变红。
//
// 本清单只含**离线套件**：不联网、不起真浏览器、不读本机 DSH 安装目录、不碰 %APPDATA% 里的真实配置。
// 需要上述任何一项的套件写在 EXCLUDED 里（含原因），不参与 CI，也请勿加回来。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LIST_ONLY = process.argv.includes('--list')

// ---- 仓库配置 -------------------------------------------------------------
// 套件里写的是 `import('file:///' + PLUGIN + 'index.js')` 与 `import('file:///' + APP + 'react/index.js')`，
// 所以在 POSIX 上必须去掉开头的斜杠（否则拼出 file:////home/...），Windows 上盘符路径原样可用。
const urlPath = (p) => {
  const s = p.replace(/\\/g, '/')
  return s.startsWith('/') ? s.slice(1) : s
}

const CHECKS = []                       // node --check（纯语法门禁）；本仓库原来没有，故为空

const SUITES = [
  'tools/verify-gate-truncation.mjs',
  'tools/verify-host-width.mjs',
  'tools/verify-settings-payload.mjs',
  // 要一份真 react（它 import(APP+'react/index.js') 把面板纯函数真跑起来）。
  // react 由 package.json 的 devDependencies 声明，下面的 ENV 把 DSH_APP_MODULES 指向
  // **仓库自己的 node_modules/**，于是本地与 CI 都不再依赖本机 DSH 安装目录 —— 2026-09 从 EXCLUDED 挪回。
  'tools/verify-panel-and-resizer.mjs',
  // v1.9.4：DEPLOYMENT_PERSONA 崩溃根因是断言引用了从未导出的符号（修在套件里）；
  // %APPDATA% 依赖靠最小 preset 夹具 + 「真实 home 存在才比对」去掉，devDeps 补装
  // @deepseek-ai/dsh-system-prompt 及其运行时依赖。反向证据：DSH_APP_MODULES 指向空目录仍 39/39。
  'tools/verify-session-gate.mjs',
  // v1.10.0：ponytail 段与门禁段的独立性（开关、缓存、override、截断）回归。
  'tools/verify-ponytail-gate.mjs',
  // v1.12.0：输出形状段（并入自 dsh-output-shape）——默认开 / 三段独立 / 技能同源 / 不重复注入。
  'tools/verify-shape-gate.mjs',
  // v1.10.2 挪回 CI：① preset 换成仓库内最小夹具（同 verify-session-gate v1.9.4 的口径），
  // "真实文件未被改动"两条在真实 home 存在时照比、不存在则 SKIP 并如实打印；② primitives 桩
  // 不再依赖能读到宿主真包源码（读不到只打一行 NOTE，断言口径不变）；③ react-dom 补进 devDeps。
  // 反向证据见 README「验证」：APPDATA 指向空目录 + DSH_APP_MODULES 指仓库 node_modules ⇒ 74/0。
  'tools/verify-gate-client.mjs',
]

const EXCLUDED = [
  ['tools/probe-userrow.mjs', '开发用探针脚本（手工跑、看 host 侧 userRow 的真实 DOM 结构），不是断言式测试套件'],
  ['tools/verify-gate-http.mjs',
    '要 %APPDATA% 下的真实 preset（copyFileSync 源文件不存在就抛错）。**未做夹具化**：它的断言里有几条' +
    '逐字节比对真实 preset 有没有被本次验证改动，换成仓库内夹具就得重写那几条断言口径 —— 本任务只允许' +
    '"等价或更强"的改动，为省事放宽口径属于作弊，故保持排除并在 README 里写明。'],
  ['tools/verify-ui-appearance.mjs',
    '要 %APPDATA% 下的真实 preset（同 verify-gate-http）'],
]

// 让套件按**本仓库实际位置**解析插件与 react，不依赖任何人的绝对路径或本机 DSH 安装目录。
const ENV = {
  DSH_CC_PLUGIN: urlPath(REPO) + '/',
  DSH_CC_INDEX: urlPath(REPO) + '/index.js',
  // DSH_APP_MODULES 默认写死了开发机的 'D:/deepseek-harness/DSH Desktop/resources/app/node_modules/'，
  // 指向仓库自己的 node_modules 后，react 由 npm install / npm ci 装出即可。
  DSH_APP_MODULES: urlPath(REPO) + '/node_modules/',
}

// ---- 登记完备性 + 已知失败 ------------------------------------------------
// tools/ 下每个「看起来是套件」的文件都必须在 SUITES / EXCLUDED / KNOWN_FAILING 里登记，
// 否则本进程直接失败 —— 防止以后新增套件被静默漏掉（同一个不变量原来由 browser-live 的
// verify-manifest.mjs 断言 package.json 里那个长串来保证）。
const DISCOVERY = (n) => /^(verify|test|probe)-.*\.mjs$/.test(n) || n === 'selfcheck.mjs'

// 已知失败：仍然跑、结果照列，但**不**让整体变红（每条都必须写明原因）。
const KNOWN_FAILING = []

// ---- 执行器 ---------------------------------------------------------------
const results = []
const t = (ms) => (ms / 1000).toFixed(1) + 's'

function summarize(out) {
  const lines = out.split(/\r?\n/).filter((l) => l.trim())
  const cand = [...lines].reverse().find((l) => /passed|通过|failed|失败/.test(l))
  if (cand) return cand.trim()
  const n = lines.filter((l) => /^\s*(PASS|✓|✔|OK)\b/.test(l)).length
  return n ? n + ' 项（按 PASS 行计数）' : '（无输出）'
}

function run(kind, file) {
  const args = kind === 'check' ? ['--check', file] : [file]
  const started = Date.now()
  const s = spawnSync(process.execPath, args, {
    cwd: REPO, env: { ...process.env, ...ENV }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  })
  const out = (s.stdout || '') + (s.stderr || '')
  const code = s.status === null ? 1 : s.status
  const ok = code === 0
  results.push({ kind, file, ok, code, ms: Date.now() - started, summary: summarize(out) })
  console.log('\n' + '─'.repeat(72))
  console.log((ok ? '✅ ' : '❌ ') + file + '   exit=' + code + '  ' + t(Date.now() - started))
  console.log('─'.repeat(72))
  if (out.trim()) console.log(out.replace(/\s+$/, ''))
  if (s.error) console.log('!! spawn 失败：' + s.error.message)
  return ok
}

function checkRegistry() {
  const reg = new Set([...SUITES, ...EXCLUDED.map((e) => e[0]), ...KNOWN_FAILING.map((e) => e[0])]
    .map((f) => path.basename(String(f).split(' ')[0])))
  const missing = fs.readdirSync(path.join(REPO, 'tools')).filter(DISCOVERY).filter((n) => !reg.has(n))
  if (missing.length) {
    console.error('✗ 有套件没登记到 tools/run-all.mjs（SUITES / EXCLUDED / KNOWN_FAILING 三选一）：' + missing.join(', '))
    process.exit(1)
  }
}

checkRegistry()

if (LIST_ONLY) {
  console.log('语法门禁：' + (CHECKS.length ? CHECKS.join(', ') : '（无）'))
  console.log('测试套件：')
  for (const f of SUITES) console.log('  · ' + f)
  console.log('未纳入 CI：')
  for (const [f, why] of EXCLUDED) console.log('  · ' + f + ' —— ' + why)
  if (KNOWN_FAILING.length) {
    console.log('已知失败（仍跑、不拦截）：')
    for (const [f, why] of KNOWN_FAILING) console.log('  · ' + f + ' —— ' + why)
  }
  process.exit(0)
}

console.log('dsh-cache-control 发布前检查（离线）· node ' + process.version)
console.log('仓库：' + REPO)
for (const f of CHECKS) run('check', f)
for (const f of SUITES) run('suite', f)

const checks = results.filter((r) => r.kind === 'check')
const suites = results.filter((r) => r.kind === 'suite')
const knownNames = new Set(KNOWN_FAILING.map((e) => path.basename(e[0])))
const isKnown = (r) => knownNames.has(path.basename(r.file))
const bad = results.filter((r) => !r.ok && !isKnown(r))
const known = results.filter((r) => !r.ok && isKnown(r))

console.log('\n' + '='.repeat(72))
console.log('汇总')
console.log('='.repeat(72))
for (const r of results) console.log((r.ok ? ' ✅ ' : ' ❌ ') + r.file.padEnd(38) + t(r.ms).padStart(6) + '  ' + r.summary)
console.log('-'.repeat(72))
console.log('语法门禁 ' + checks.filter((r) => r.ok).length + '/' + checks.length +
  '　套件 ' + suites.filter((r) => r.ok).length + '/' + suites.length + ' 通过')
if (EXCLUDED.length) {
  console.log('\n未纳入 CI 的套件（原因）：')
  for (const [f, why] of EXCLUDED) console.log('  · ' + f + '\n      ' + why)
}
if (known.length) {
  console.log('\n⚠ 已知失败（不拦截整体退出码，原因见本文件 KNOWN_FAILING）：')
  for (const r of known) console.log('  · ' + r.file + '（exit=' + r.code + '）' + r.summary)
}
if (bad.length) {
  console.log('\n失败套件：')
  for (const r of bad) console.log('  · ' + r.file + '（exit=' + r.code + '）' + r.summary)
}
console.log('\n' + (bad.length ? '✗ 有套件失败 —— 整体失败' : '✓ 全部通过'))
process.exit(bad.length ? 1 : 0)
