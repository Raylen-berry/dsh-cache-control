// 套件：技能清单对账（v1.16.20）。
//
// 盯住的缺陷类别是**静默失败**——技能从目录里消失时不报错、不留现场：
//   ① 声明了但磁盘上没有：REVIEW_SKILL_NAME 指向的目录被改名/漏拷 ⇒ 注册直接失败，只留一行控制台警告。
//   ② 在磁盘上但没被声明：skills/ 下多出来的目录永远不会被加载（本插件不是全量扫描型，
//      browser-live / video-prompt 才是）。
//   ③ frontmatter 不合格：name 与目录名不符（注册名会漂）、description 为空（会被拒注册）、
//      描述过长（挤占技能目录的常驻预算）。
//   ④ package.json 的 files 没覆盖：skills/<dir>/ 或规则正文真源（shape-gate.md / ponytail-gate.md）
//      不进包 ⇒ 别人机器上装出来是空壳。
//
// 为什么单开一条：现有套件覆盖段文本 / 注册名单 / 设置路由 / 截断三元事实，但没有一条把
// 「index.js 的声明 ↔ 磁盘 skills/ ↔ 包清单」三者摆在一起对账。这类缺口靠人读 diff 是读不出来的。
//
// 只读本地文件与 import 本插件 index.js，不联网、不读 %APPDATA%、不写任何东西。
import { fileURLToPath, pathToFileURL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

// 插件根：默认按**本文件所在目录的上一级**解析（手工跑不带 env 也能用），
// DSH_CC_PLUGIN 给了就用它——与 run-all.mjs 的 ENV 口径一致。
const HERE = path.dirname(fileURLToPath(import.meta.url))
const rawRoot = process.env.DSH_CC_PLUGIN || '../'
const ROOT = path.resolve(HERE, rawRoot)
const SKILLS = path.join(ROOT, 'skills')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')) }
}

const host = await import(pathToFileURL(path.join(ROOT, 'index.js')).href)

// ---------------------------------------------------------------- 1. RULE_SKILLS --
console.log('\n— 1. 常驻技能（正文真源是包根 .md，不是技能目录）—')
const rules = Array.isArray(host.RULE_SKILLS) ? host.RULE_SKILLS : []
ok('RULE_SKILLS 有 2 条', rules.length === 2, ' 实为 ' + rules.length)
for (const s of rules) {
  const label = s.name || '(无名)'
  ok(label + ' 有 name/description/whenToUse',
    !!s.name && !!String(s.description || '').trim() && !!String(s.whenToUse || '').trim())
  let text = ''
  try { text = String(s.body ? s.body() : '') } catch (err) { text = '' }
  ok(label + ' 的 body() 非空且首行是标题', text.trim() !== '' && /^#\s/.test(text.trimStart()),
    text.trim() === '' ? '空' : JSON.stringify(text.trimStart().split(/\r?\n/, 1)[0]))
  if (s.builtinFile) {
    ok(label + ' 的 builtinFile 可达', fs.existsSync(s.builtinFile), path.basename(s.builtinFile))
  }
}

// ---------------------------------------------------------------- 2. 磁盘技能目录 --
console.log('\n— 2. 声明 ↔ 磁盘 skills/ 双向对账 —')
const declaredDir = host.REVIEW_SKILL_NAME
const onDisk = fs.existsSync(SKILLS)
  ? fs.readdirSync(SKILLS).filter((n) => fs.statSync(path.join(SKILLS, n)).isDirectory())
  : []
ok('REVIEW_SKILL_NAME 有值', typeof declaredDir === 'string' && declaredDir !== '')
ok('skills/ 目录存在', fs.existsSync(SKILLS))
ok('声明的技能在磁盘上（否则注册静默失败）', onDisk.includes(declaredDir),
  '声明 ' + declaredDir + ' / 磁盘 ' + onDisk.join(','))
ok('磁盘上没有未声明的技能目录（否则永远不加载）',
  onDisk.every((d) => d === declaredDir), onDisk.filter((d) => d !== declaredDir).join(',') || '无多余项')

// ---------------------------------------------------------------- 3. frontmatter --
console.log('\n— 3. SKILL.md frontmatter 与正文 —')
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  return m ? m[1] : null
}
// YAML 折叠/块标量：折叠标记必须连同其后的换行一起被"吃掉"（归到 marker 组），
// 否则惰性捕获会在标记后的换行处立刻命中 lookahead 并回吐成空串。
function attr(fm, key) {
  const re = new RegExp(`^${key}:[ \\t]*(?:([>|][-+]?)[ \\t]*\\r?\\n)?([\\s\\S]*?)(?=\\r?\\n[A-Za-z][A-Za-z0-9_-]*:|$)`, 'm')
  const m = re.exec(fm || '')
  return m ? m[2].replace(/\s+/g, ' ').trim() : ''
}

for (const dir of onDisk) {
  const file = path.join(SKILLS, dir, 'SKILL.md')
  if (!fs.existsSync(file)) { ok('skills/' + dir + '/ 有 SKILL.md', false); continue }
  const text = fs.readFileSync(file, 'utf8')
  const fm = frontmatter(text)
  ok('skills/' + dir + '/SKILL.md 有 frontmatter', fm !== null)
  if (fm === null) continue
  const name = attr(fm, 'name')
  const desc = attr(fm, 'description')
  const body = text.replace(/^---[\s\S]*?---/, '').trim()
  ok('frontmatter name 等于目录名', name === dir, name)
  ok('description 非空（为空会被拒注册）', desc !== '', desc.length + ' 字符描述')
  ok('description 不过长（≤1024）', desc.length <= 1024, desc.length + ' 字符')
  ok('正文非空', body !== '', body.length + ' 字符正文')
}

// ---------------------------------------------------------------- 4. 包清单 --
console.log('\n— 4. package.json 的 files 覆盖（决定别人装出来是不是空壳）—')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const files = Array.isArray(pkg.files) ? pkg.files : []
ok('package.json 有 files 白名单', files.length > 0, files.length + ' 项')
const coversDir = (dir) => files.some((f) => f === 'skills' || f === 'skills/' || f === `skills/${dir}` || f === `skills/${dir}/`)
for (const dir of onDisk) ok('files 覆盖 skills/' + dir, coversDir(dir))
for (const s of rules) {
  if (!s.builtinFile) continue
  const rel = path.relative(ROOT, s.builtinFile).replace(/\\/g, '/')
  if (rel.startsWith('..')) continue
  ok('files 覆盖正文真源 ' + rel, files.includes(rel))
}
// 反向证据：files 里不许出现磁盘上已经不存在的东西（否则 npm pack 会静静少一个文件）
for (const f of files) {
  if (f.startsWith('skills/') && !f.endsWith('/')) {
    ok('files 里的 ' + f + ' 真实存在', fs.existsSync(path.join(ROOT, f)))
  }
}

console.log('\n技能清单对账：' + pass + ' 通过 / ' + fail + ' 失败（插件根 ' + ROOT + '）')
process.exit(fail === 0 ? 0 : 1)
