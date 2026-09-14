// 结构断言：client 保存载荷必须与 host 的 DEFAULTS **字段对齐**。
//
// 起因（2026-09-14 审计附带发现）：v1.6.0 新增 hideResizer 时，开关、状态、host 默认值都加了，
// 唯独 client.js 的 saveNow() PUT 载荷漏了这个字段 —— 界面上拨得动、请求里却不带，
// 于是**永远不落盘**，刷新就回到旧值。这类"加了字段忘了接线"的漏，功能测试往往抓不到
// （因为状态本身是变的），但结构上一比就露。
//
// 本套件不跑运行时代码，只做两件对账：
//   ① DEFAULTS 里的每个字段都得出现在保存载荷里（漏了 = 拨了不落盘）
//   ② 载荷里的字段 host 必须认识（多了 = 被静默丢弃，也是 bug）
// 例外：host 自己维护、不该由前端提交的字段（如 compactionBackup）走 EXCLUDE 白名单。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')

// host 自己写、不由前端提交的字段
const EXCLUDE = new Set(['compactionBackup'])

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')) }
}

/** 从一个 `关键字 {` 起、到下一个以 `}` 开头的行（trim 后）为止的顶层键名。
 *  注意收尾行的缩进不一样：DEFAULTS 是行首 `}`，保存载荷是缩进的 `}),` —— 所以按
 *  "trim 后以 } 开头" 判，不能写死 '\n}'（第一版就是这么错的：找不到收尾就抛错，套件本身在红）。 */
function keysOfBlock(text, startPattern, label) {
  const m = startPattern.exec(text)
  if (!m) throw new Error('没找到代码块：' + label)
  const lines = text.slice(m.index + m[0].length).split('\n')
  const keys = []
  for (const line of lines) {
    if (line.trim().startsWith('}')) return keys
    const k = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(line)
    if (k) keys.push(k[1])
  }
  throw new Error('代码块没有收尾大括号：' + label)
}

const hostSrc = fs.readFileSync(path.join(REPO, 'index.js'), 'utf8')
const clientSrc = fs.readFileSync(path.join(REPO, 'client.js'), 'utf8')

const defaults = keysOfBlock(hostSrc, /export const DEFAULTS = Object\.freeze\(\{/, 'host DEFAULTS')
const payload = keysOfBlock(clientSrc, /body: JSON\.stringify\(\{/, 'client saveNow 载荷')

console.log('— 1. 两边的字段集合 —')
ok('DEFAULTS 解析出来了', defaults.length >= 10, defaults.length + ' 个: ' + defaults.join(','))
ok('保存载荷解析出来了', payload.length >= 10, payload.length + ' 个: ' + payload.join(','))

const wanted = defaults.filter((k) => !EXCLUDE.has(k))
const missing = wanted.filter((k) => !payload.includes(k))
const extra = payload.filter((k) => !defaults.includes(k))

console.log('\n— 2. 对齐 —')
ok('DEFAULTS 每个字段都在保存载荷里（漏了 = 拨了不落盘）', missing.length === 0, missing.length ? '缺: ' + missing.join(',') : wanted.length + ' 个全在')
ok('载荷里没有 host 不认识的字段（多了会被静默丢弃）', extra.length === 0, extra.length ? '多: ' + extra.join(',') : '无多余')
ok('hideResizer 这个具体回归已堵住（v1.6.0 漏的就是它）', payload.includes('hideResizer'))
ok('hideDivider 同样在载荷里（v1.7.0 拆出的第二个开关，别再犯同样的漏）', payload.includes('hideDivider'))
ok('白名单只排除了 host 自维护字段', wanted.length === defaults.length - defaults.filter((k) => EXCLUDE.has(k)).length,
  'DEFAULTS=' + defaults.length + ' 其中被排除=' + defaults.filter((k) => EXCLUDE.has(k)).length + ' 待对齐=' + wanted.length)

console.log('\n— 3. 解析器的自检（防止断言因解析失败而假绿）—')
const probeDefaults = keysOfBlock('const DEFAULTS = {\n  a: 1,\n  bb: 2,\n}', /const DEFAULTS = \{/, 'probe')
ok('样例块解析正确', probeDefaults.join(',') === 'a,bb', probeDefaults.join(','))
let threw = false
try { keysOfBlock('const DEFAULTS = {\n  a: 1\n}', /const NOT_HERE = \{/, 'probe-missing') } catch { threw = true }
ok('找不到代码块时抛错而不是返回空', threw)

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail === 0 ? 0 : 1)
