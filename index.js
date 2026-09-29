// ============================================================================
// dsh-cache-control · Host half
//
// 职责：
//   1. 会话门禁（session gate）：把插件内的长期规则文件 session-gate.md 作为
//      一段 system prompt 常驻注入（通过 ctx.systemPrompt.section，宿主全局层，
//      与 dsh-web-app 注入 "app:web-surface" 段同一条路）。开关只决定这段文本
//      是否为空 —— 空段在 renderPrompt 里被丢弃，因此关=完全不进提示词。
//   1b. ponytail（编码纪律，v1.10.0）与输出形状（v1.12.0，并入自 dsh-output-shape）：
//      与门禁同构的第二、第三段常驻规则，各自独立开关与 override 文件。
//      输出形状并入时一并接手了它的两条**按需技能**（i-have-adhd / ponytail），
//      正文读的就是上面这两个规则文件 —— 技能与注入永远同一份，不会漂。
//   2. 设置持久化到 $DSH_HOME/dsh-cache-control/settings.json（HTTP GET/PUT
//      /cc/settings.json）；规则的可编辑副本持久化到
//      $DSH_HOME/dsh-cache-control/gate.md（override，删除即回到插件内置文本），
//      经 HTTP GET/PUT /cc/gate.json 读写（仿 dsh-bg-atelier 的路由写法）。
//      settings.json 里还带着两块纯界面的值：③ 外观（pinLastUser / clearBubble /
//      pinBlur）与 ④ 对话页（chatWidth / chatWidthEnabled）—— host 只做校验与
//      存取，具体怎么作用到页面上全在 client 侧。④ 这两项原属 dsh-bg-atelier，
//      启动时经 migrateFromAtelier() 一次性搬过来。
//
// v1.14.0 移除：① 压缩接管 —— 原先动态改写 standard agent preset 组装文件
//   agent.cordis.yml 里 compaction-basic 那一行的 config（含字节级备份/还原）。
//   DSH 0.1.7 起 agent preset 不再是可编辑的组装文件：整个安装里已不存在
//   agent.cordis.yml，包也由 dsh-agent-presets 拆成 dsh-agent-preset +
//   dsh-agent-preset-registry，这条路没有落点 —— 只会在启动对账与每次开面板时
//   报 "cannot locate standard preset agent.cordis.yml"。settings.json 里遗留的
//   enabled / triggerPct / retainPct / auto 四个字段随之不再被 sanitize 保留 ——
//   下一次保存即从盘上消失，不驱动任何行为；compactionBackup 例外，它存的是用户
//   接管前的 preset 原文、是磁盘上唯一的副本，因此原样保留、永不丢弃。
//
// 生效语义（DSH 自身机制，非本插件发明）：
//   * 会话门禁：system prompt 每个 model step 重新 assemble()，且压缩只折叠历史
//     不折叠 system prompt ⇒ 门禁对已打开的会话在下一个 step 生效，且不被压缩稀释。
//
// 只读打包目录、只写 $DSH_HOME，不改任何其它文件。
// ============================================================================

import { promises as fs } from 'node:fs'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
// 省 token（v1.13.0）：并入 dsh-plugin-save-token v2.4.1 的宿主半边，
// 作为嵌套插件从 apply() 里挂载。核掉的部分见该文件头部注释。
import * as saveToken from './save-token-host.js'
import { createPolicyManager, analyzeRules } from './policy-host.js'

export const name = 'dsh-cache-control'
export const inject = ['webServer']

const SETTINGS_DIR = () => path.join(dshHome(), 'dsh-cache-control')
const SETTINGS_FILE = () => path.join(dshHome(), 'dsh-cache-control', 'settings.json')
const GET_PATH = '/cc/settings.json'
const GATE_PATH = '/cc/gate.json'
// ponytail 编码纪律的规则文本路由（v1.10.0），与 /cc/gate.json 同构。
const PONY_PATH = '/cc/ponytail.json'
// 输出形状的规则文本路由（v1.12.0，并入自 dsh-output-shape），与上两者同构。
const SHAPE_PATH = '/cc/shape.json'
// 自动代码审查（v1.11.0）：GET 回"技能注册状态 + ocr 是否可用"，PUT 切开关。
const REVIEW_PATH = '/cc/review.json'

// ── 存储用量与清理（v1.8.0）──────────────────────────────────────────────────
// 用户要求：分开显示各类占用，清理要**先给候选清单**（文件、原因、预计释放），别一键乱删。
// 本版更进一步：**移到回收目录**而不是直接删 —— 不可逆操作先从"可回溯"开始，
// 回收目录本身再单独清（purge），清不清由用户点。
const STORAGE_PATH = '/cc/storage'
const CLEAN_PATH = '/cc/storage/clean'
const PURGE_PATH = '/cc/storage/purge'
const RECYCLE_DIR = (home = dshHome()) => path.join(home, 'dsh-cache-control', 'recycle')

/** 分类（相对 $DSH_HOME）：给人看的名字 + 一句话说明 + 清理建议。 */
export const STORAGE_CATEGORIES = [
  { id: 'sessions', rel: 'sessions', label: '会话记录', note: '每个会话的 JSONL 全文，删了等于丢历史，**不建议清**' },
  { id: 'storages', rel: 'storages', label: '会话投影缓存', note: '会话列表/检索的派生缓存，可再生成' },
  { id: 'attachments', rel: 'attachments', label: '附件副本', note: '你拖进对话的图片/文件副本，删了旧消息里的图会失效' },
  { id: 'browser-live', rel: 'dsh-browser-live', label: '浏览器观察窗', note: '自带浏览器实例的 profile、截图、下载' },
  { id: 'video-prompt', rel: 'dsh-video-prompt', label: '生图插件', note: '媒体清单、提示词产物、过程目录（抽帧等中间产物）' },
  { id: 'bill', rel: 'dsh-bill', label: '费用记录', note: '每次模型调用的记账环，删了看不了历史花费' },
  { id: 'cache-control', rel: 'dsh-cache-control', label: '本插件数据', note: '设置、规则 override、回收目录' },
]

/** 递归量一个目录：文件数 / 总字节 / 最新与最旧 mtime。上限防呆（超大树不拖死宿主）。 */
export async function dirUsage(dir, limit = 40000) {
  const out = { files: 0, bytes: 0, newest: 0, oldest: 0, truncated: false }
  const stack = [dir]
  while (stack.length > 0) {
    const cur = stack.pop()
    let entries = []
    try { entries = await fs.readdir(cur, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const full = path.join(cur, e.name)
      if (e.isDirectory()) { stack.push(full); continue }
      if (!e.isFile()) continue
      try {
        const st = await fs.stat(full)
        out.files += 1
        out.bytes += st.size
        const t = st.mtimeMs
        if (out.newest === 0 || t > out.newest) out.newest = t
        if (out.oldest === 0 || t < out.oldest) out.oldest = t
      } catch { /* 单个文件读不到就跳过 */ }
      if (out.files >= limit) { out.truncated = true; return out }
    }
  }
  return out
}

/** 各类占用汇总（只读，不删任何东西）。 */
export async function storageReport(home) {
  const categories = []
  for (const c of STORAGE_CATEGORIES) {
    const dir = path.join(home, c.rel)
    const exists = existsSync(dir)
    const usage = exists ? await dirUsage(dir) : { files: 0, bytes: 0, newest: 0, oldest: 0, truncated: false }
    categories.push({ id: c.id, label: c.label, note: c.note, dir, exists, ...usage })
  }
  const total = categories.reduce((a, c) => ({ files: a.files + c.files, bytes: a.bytes + c.bytes }), { files: 0, bytes: 0 })
  return { home, categories, total, recycle: await dirUsage(RECYCLE_DIR(home)), truncated: categories.some(c => c.truncated) }
}

/** 可回收候选：只收**明确可再生成**的东西，每条都写清"为什么能清"与风险。 */
export async function cleanCandidates(home) {
  const out = []
  const push = async (dir, label, why, risk) => {
    if (!existsSync(dir)) return
    const u = await dirUsage(dir)
    if (u.files === 0) return
    out.push({ path: dir, label, why, risk, files: u.files, bytes: u.bytes, newest: u.newest })
  }
  const shots = path.join(home, 'dsh-browser-live', 'shots')
  await push(shots, '观察窗截图', '每次截图存一张，纯粹是调试留痕，删了不影响任何功能', '无')
  // 只动缓存子目录，不碰 profile 根（那里有登录态与 Cookie）
  for (const name of ['Default/Cache', 'Default/Code Cache', 'Default/GPUCache', 'GrShaderCache', 'ShaderCache']) {
    for (const prof of ['chrome-profile-plugin', 'chrome-profile-chrome', 'chrome-profile-edge']) {
      await push(path.join(home, 'dsh-browser-live', prof, name), '浏览器缓存 · ' + name.split('/').pop(), 'CDP 浏览器的磁盘缓存，重建即可（**不含登录态**：那是 Cookies/Login Data，没在候选里）', '下次访问会慢一点')
    }
  }
  // 提示词产物不是可再生成的缓存；回收目录由单独的 purge 操作管理，不能移入自身。
  return out.sort((a, b) => b.bytes - a.bytes)
}

let storageSnapshot = null, storageFlight = null, storageEpoch = 0
export function invalidateStorageSnapshot() { storageEpoch++; storageSnapshot = null; storageFlight = null }
export async function readStorageSnapshot(home, force = false) {
  home = path.resolve(home)
  if (storageFlight && storageFlight.home === home) return storageFlight.promise
  if (!force && storageSnapshot && storageSnapshot.home === home && Date.now() - storageSnapshot.scannedAt < 5000) return storageSnapshot
  const epoch = storageEpoch
  const flight = { home, promise: null }
  flight.promise = (async () => {
    const [report, candidates] = await Promise.all([storageReport(home), cleanCandidates(home)])
    const result = { ok: true, ...report, candidates, scannedAt: Date.now() }
    if (epoch === storageEpoch) storageSnapshot = result
    return result
  })().finally(() => { if (storageFlight === flight) storageFlight = null })
  storageFlight = flight
  return flight.promise
}

/** 把候选**移进回收目录**（保留相对层级，避免重名互撞），返回释放字节与目标目录。 */
export async function recyclePaths(paths, home, allowed, now = Date.now()) {
  const ok = []
  const skipped = []
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dest = path.join(RECYCLE_DIR(home), stamp)
  let freed = 0
  for (const raw of Array.isArray(paths) ? paths : []) {
    const target = path.resolve(String(raw || ''))
    // 只允许移**候选清单里出现过**的路径：路径来自请求体，必须对着白名单校验
    if (!allowed.includes(target)) { skipped.push({ path: target, reason: '不在候选清单内' }); continue }
    const relative = path.relative(path.resolve(home), target)
    const recycled = path.relative(path.resolve(RECYCLE_DIR(home)), target)
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)
      || !recycled || (!recycled.startsWith('..' + path.sep) && recycled !== '..' && !path.isAbsolute(recycled))) {
      skipped.push({ path: target, reason: '越界或属于回收目录' }); continue
    }
    if (!existsSync(target)) { skipped.push({ path: target, reason: '已不存在' }); continue }
    const u = await dirUsage(target)
    const rel = path.relative(home, target).replace(/[\\/]+/g, '__')
    try {
      await fs.mkdir(dest, { recursive: true })
      await fs.rename(target, path.join(dest, rel))
      freed += u.bytes
      ok.push({ path: target, bytes: u.bytes })
    } catch (err) {
      // 跨盘或占用中：退回"复制后删"太重，直接如实报错，让用户自己关掉浏览器再试
      skipped.push({ path: target, reason: '移动失败：' + String((err && err.message) || err) })
    }
  }
  return { moved: ok, skipped, freed, recycleDir: dest }
}

/** 规则 override 落盘位置（用户在界面上编辑后写入；删除它即回到插件内置文本）。 */
const GATE_OVERRIDE_FILE = () => path.join(dshHome(), 'dsh-cache-control', 'gate.md')

/** 插件自带、随包分发的长期规则。 */
const GATE_BUILTIN_FILE = fileURLToPath(new URL('./session-gate.md', import.meta.url))

/** ponytail 编码纪律（v1.10.0）：内置文件 + 可编辑 override，与门禁同构、各一段。 */
const PONY_BUILTIN_FILE = fileURLToPath(new URL('./ponytail-gate.md', import.meta.url))
/** 用户在界面上编辑后写入；删除它即回到插件内置文本。 */
const PONY_OVERRIDE_FILE = () => path.join(dshHome(), 'dsh-cache-control', 'ponytail.md')

/** 输出形状（v1.12.0）：第三段常驻规则，内置文件 + 可编辑 override，与门禁同构。 */
const SHAPE_BUILTIN_FILE = fileURLToPath(new URL('./shape-gate.md', import.meta.url))
/** 用户在界面上编辑后写入；删除它即回到插件内置文本。 */
const SHAPE_OVERRIDE_FILE = () => path.join(dshHome(), 'dsh-cache-control', 'shape.md')

/** 注入提示词的字节上限：这段文本每请求重复计费，必须留硬闸（防误粘大文件把成本乘上每个子代理）。 */
export const GATE_MAX_BYTES = 16 * 1024

/** 门禁段的提示词位置：persona(0) 之后、plan 政策(500) 之前，越靠前权重越稳。 */
export const GATE_SECTION = 'dsh-cache-control:session-gate'
export const GATE_SECTION_ORDER = 400

/** 段序（v1.10.1 定稿，v1.12.0 起三段同属本插件）：守则 400 → ponytail 405 → 输出形状 410，都在 plan 政策(500) 之前。 */
export const PONY_SECTION = 'dsh-cache-control:ponytail-gate'
export const PONY_SECTION_ORDER = 405

/** 输出形状段（v1.12.0）：从 dsh-output-shape 的 `dsh-output-shape:output-shape` 改名并入，order 不变。 */
export const SHAPE_SECTION = 'dsh-cache-control:shape-gate'
export const SHAPE_SECTION_ORDER = 410
/** 逃生开关：置 1 则无论设置如何都不注入形状段。**沿用并入前 dsh-output-shape 的那个变量名** ——
 *  它可能已经写在某台机器的环境里或脚本里，改名等于把那个开关悄悄拔掉。 */
export const SHAPE_DISABLE_ENV = 'DSH_OUTPUT_SHAPE_DISABLE'

// ── 自动代码审查（v1.11.0）───────────────────────────────────────────────────
// **不注入常驻规则**：上游 alibaba/open-code-review 的 README 把"通用 agent + 自然语言 skill
// 做审查"列为反面教材（漏审 / 行号漂移 / 质量不稳），并给出基准 —— 同模型下它的 F1 更高、
// token 只用通用 agent 的约 1/9。所以这里只注册一个按需技能（skills/auto-code-review/SKILL.md），
// 由 ocr 的 delegate 模式现取"该审哪些文件 + 这些文件命中哪些规则"，判断仍交给当前模型。
// 零常驻 token；规则文本跟着上游升级，不在本仓库里腐烂。许可证见 NOTICE。
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.')
export const SKILLS_ROOT = path.join(PACKAGE_ROOT, 'skills')
export const REVIEW_SKILL_NAME = 'auto-code-review'

/**
 * 从 SKILL.md 顶部 frontmatter 取 name / description / whenToUse（与 dsh-output-shape 同一口径）。
 * 只支持 `key: value` 与 `key: >` 折叠块两种写法 —— 我们的技能文件就这一份，不做 YAML 全家桶。
 */
export function parseSkillFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(String(text || ''))
  if (!m) return { attrs: {}, body: String(text || '') }
  const attrs = {}
  const lines = m[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i])
    if (!kv) continue
    const key = kv[1]
    let val = kv[2].trim()
    if (val === '>' || val === '|' || val === '') {
      // 折叠块：吃掉后续缩进行，压成一行
      const buf = []
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) { buf.push(lines[++i].trim()) }
      val = buf.join(' ')
    }
    attrs[key] = val.replace(/^["']|["']$/g, '')
  }
  return { attrs, body: String(text).slice(m[0].length) }
}

/**
 * 探测 ocr 是否可用。**不出网、不装东西**：只按候选名试跑一次 `--version`。
 * 返回 { found, version, command }。找不到是正常状态（换机器没装），界面据此提示。
 */
/**
 * ocr 可执行文件的探测顺序。**不能只靠 PATH**：DSH Desktop 的宿主进程用的是自己那份
 * `.desktop-bin` 环境，npm 全局 bin（%APPDATA%\Roaming\npm）常常不在里面 —— 本机实测就是
 * 这样（命令行里 `ocr` 能跑、插件里 spawn 'ocr' 报 ENOENT）。所以显式补一条 npm 全局路径。
 */
export function ocrCandidates(env = process.env) {
  const list = ['ocr']
  const appdata = env.APPDATA || (env.USERPROFILE ? path.join(env.USERPROFILE, 'AppData', 'Roaming') : '')
  if (appdata) list.push(path.join(appdata, 'npm', 'ocr.cmd'))
  return list
}

/**
 * 探测 ocr 是否可用。**不出网、不装东西**：只按候选名试跑一次 `--version`。
 * 返回 { found, version, command }。找不到是正常状态（换机器没装），界面据此提示。
 *
 * ⚠ Node ≥ 18.20/20.12/24 起，`execFile` 直接 spawn `.cmd`/`.bat` 会抛 **EINVAL**（CVE-2024-27980
 * 的修复），不是 ENOENT —— 而 npm 在 Windows 上装的全局 CLI 恰恰就是 `.cmd` shim。所以命中
 * `.cmd` 后缀时必须走 `{ shell: true }`；否则探测会永远假失败，界面上一直显示"未安装"。
 */
export async function detectOcr(runner, candidates) {
  const run = runner || (async (cmd) => {
    const { execFileSync } = await import('node:child_process')
    // 参数是固定的 '--version'、无任何外部输入 ⇒ shell 拼接面为零。DEP0190 只在"args + shell:true"
    // 同时出现时才告警，所以 .cmd 这一路改成**整条命令进 shell、不传 args**。
    const opts = { timeout: 8000, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    try { return String(execFileSync(cmd, ['--version'], opts)) } catch { /* 换下一条 */ }
    if (/\.cmd$/i.test(cmd)) {
      try { return String(execFileSync(`"${cmd}" --version`, { ...opts, shell: true })) } catch { return null }
    }
    return null
  })
  for (const cmd of (candidates || ocrCandidates())) {
    let out = null
    try { out = await run(cmd) } catch { out = null }
    if (typeof out === 'string' && out.trim() !== '') {
      const v = /v?(\d+\.\d+\.\d+)/.exec(out)
      return { found: true, version: v ? v[1] : '', command: cmd }
    }
  }
  return { found: false, version: '', command: '' }
}

/** ocr 探测结果按 TTL 记忆：这是子进程调用，不能每次 GET 都 spawn 一遍。 */
const OCR_PROBE_TTL_MS = 60_000
let ocrProbe = { at: 0, value: null }

export async function probeOcr(now = Date.now(), runner) {
  if (ocrProbe.value && now - ocrProbe.at < OCR_PROBE_TTL_MS) return ocrProbe.value
  const value = await detectOcr(runner)
  ocrProbe = { at: now, value }
  return value
}

/** 审查卡要展示的全部事实：技能文件在不在、注册了没、ocr 装没装。前端不再自己猜。 */
export async function reviewMeta(settings, state, registeredOverride) {
  const skillPath = path.join(SKILLS_ROOT, REVIEW_SKILL_NAME, 'SKILL.md')
  let bytes = 0
  let description = ''
  try {
    const raw = readFileSync(skillPath, 'utf8')
    bytes = Buffer.byteLength(raw, 'utf8')
    description = (parseSkillFrontmatter(raw).attrs.description || '').replace(/\s+/g, ' ').trim()
  } catch { bytes = 0 }
  const ocr = await probeOcr()
  return {
    enabled: settings.reviewSkillEnabled === true,
    skillName: REVIEW_SKILL_NAME,
    skillPath,
    skillBytes: bytes,
    description,
    registered: (registeredOverride || state.registered).includes(REVIEW_SKILL_NAME),
    skillsService: state.serviceAvailable !== false,
    ocrFound: ocr.found,
    ocrVersion: ocr.version,
    ocrCommand: ocr.command,
    // 常驻成本恒为 0 —— 这条是这张卡与 ponytail 卡的根本区别，界面要写出来。
    residentBytes: 0,
  }
}

/**
 * 并入自 dsh-output-shape 的**常驻技能**（v1.12.0）。
 *
 * 与上面的 auto-code-review 同族（按需加载、零常驻 token、不进 system prompt），但**没有开关**：
 * 技能躺在目录里不花一个 token，少一个开关就少一处能漂的状态。正文一律读本插件自己的规则文件
 * （`body()` 走的就是常驻注入那条加载路径，override 优先），于是"技能里读到的规则"与
 * "每请求注入的规则"永远同一份 —— 这正是并入前 dsh-output-shape 的承诺，别在合并时丢掉。
 *
 * description / whenToUse 是**技能目录里的元信息**，只此一处硬编码；规则正文不在这里。
 */
export const RULE_SKILLS = [
  {
    name: 'i-have-adhd',
    description: '把回复整形成"读完就能动手"的形状——首行给下一步、多步编号、状态复述、跑题后置、报错讲因果、无开场白无客套。用户说"关闭 ADHD 模式"或"正常模式"即停。',
    whenToUse: '用户抱怨回复太长/铺垫太多/看完不知道做什么，或要求简短直接、先给结论；也适合长任务里持续保持这种形状。',
    body: () => loadShapeSync(),
    builtinFile: SHAPE_BUILTIN_FILE,
  },
  {
    name: 'ponytail',
    description: '用最懒但真正可用的方案写代码：先问这需求该不该存在（YAGNI），再复用库里已有的，再用标准库与平台原生特性，最后才写最小代码。禁止没要求的抽象、样板脚手架、为几行代码新增依赖。修 bug 修根因。适用于一切编码任务：写、改、重构、修、评审代码，或选库选依赖。用户说"ponytail""懒人模式""最简方案""YAGNI"，或抱怨过度设计、代码臃肿、依赖乱加时启用。非编码请求（通用知识、写作、翻译）不要用。',
    whenToUse: '任何编码任务开工前；用户抱怨实现过度设计、diff 太大、加了没要的依赖或抽象时。',
    body: () => loadPonytailSync(),
    builtinFile: PONY_BUILTIN_FILE,
  },
]

export function dshHome() {
  return process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh')
}

// ---------------------------------------------------------------------------
// 设置：默认值与清洗
// ---------------------------------------------------------------------------
export const DEFAULTS = Object.freeze({
  gateEnabled: false, // 会话门禁
  ponytailEnabled: false, // ponytail 编码纪律常驻注入：独立于门禁（v1.10.0）
  // 输出形状常驻注入（v1.12.0，并入自 dsh-output-shape）。**默认开** —— 合并前它由
  // dsh-output-shape 的 bundle config 默认开启（那插件是这套规则的**真源**：会话守则里的
  // R4 早已摘出交给它）。并入后保持同默认，否则升级即静默改变行为、用户只会看到"形状没了"。
  // 判据与 reviewSkillEnabled 同族：`!== false`（旧盘上没有这个键 ⇒ 开）。
  shapeEnabled: true,
  pinLastUser: false,    // 会话区外观：最近一条"我的提问"钉在顶部
  clearBubble: false,    // 会话区外观：我的气泡背景透明（露出壁纸）
  pinBlur: 10,           // 会话区外观：钉顶底衬（圆角矩形毛玻璃）的模糊半径 px
  pinMaxVh: 38,          // 会话区外观：被钉气泡自身的最高高度（vh；超出的部分在气泡内滚）
  chatWidth: 80,         // 对话页：会话列宽占**可用宽度的百分比**（v1.5.0 起；原为 640–3840px）
  chatWidthEnabled: false, // 对话页：是否启用固定列宽（关 = 跟随 DSH 自适应）
  // 对话页（v1.6.0，v1.7.0 拆成两个开关）：隐藏 DSH 原生拖拽把手。
  // hideResizer = 会话区两竖杠（宽度把手）：列宽钉成固定百分比后拖它不再改变列宽，只剩误触。
  // hideDivider = 侧栏/详情栏分隔条（v1.7.0 新增）：拖它**仍能**改侧栏宽度，所以单独一个键、默认关。
  // 都默认 false：不动宿主既有行为，想要干净再开。纯界面开关，host 只负责原样存取。
  hideResizer: false,
  hideDivider: false,
  // 自动代码审查（v1.11.0）：注册按需技能 auto-code-review。默认**开** —— 技能不占常驻 token，
  // 只在目录里多一行说明；关掉它连目录条目都没有。ocr 没装也照样注册（技能正文里有前置检查）。
  reviewSkillEnabled: true,
})

/** 钉顶底衬模糊半径的取值区间（与 client 侧 clampBlur 同口径）。 */
export const PIN_BLUR_MIN = 0
export const PIN_BLUR_MAX = 24
/** 被钉气泡最高高度的取值区间，单位 vh（与 client 侧 clampPinMaxVh 同口径）。 */
export const PIN_MAX_VH_MIN = 12
export const PIN_MAX_VH_MAX = 80
/** 对话页宽度的取值区间：**百分比**（v1.5.0 起；原为 640–3840px）。
 *  30% 是"再窄就没法读了"的下限，100% = 铺满会话区可用宽度（两侧仍留宿主自己的 32px 内边距）。 */
export const CHAT_WIDTH_MIN = 30
export const CHAT_WIDTH_MAX = 100
/** 盘上存过 px（>100，例如 900）时算旧值 —— 一律落到默认 80%（约等于本机 1139px 区域里的 900px）。 */
export const CHAT_WIDTH_LEGACY_DEFAULT = 80

/** 把 chatWidth 归一成合法百分比；旧 px 值落到 CHAT_WIDTH_LEGACY_DEFAULT。 */
export function normalizeChatWidth(raw) {
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n) || n <= 0 || n > CHAT_WIDTH_MAX) return CHAT_WIDTH_LEGACY_DEFAULT
  return Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, n))
}

export function sanitize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const gateEnabled = src.gateEnabled === true
  const ponytailEnabled = src.ponytailEnabled === true
  // v1.12.0：输出形状。默认**开**，故判据是 `!== false` —— 不能写 `=== true`，
  // 那样旧盘（没这个键）会被判成关，用户一升级就静默丢掉形状规则。
  const shapeEnabled = src.shapeEnabled !== false
  const pinLastUser = src.pinLastUser === true
  const clearBubble = src.clearBubble === true
  let pinBlur = Math.round(Number(src.pinBlur) * 10) / 10   // 保留 1 位小数（1.3 / 1.5 这类微调档）
  if (!Number.isFinite(pinBlur)) pinBlur = DEFAULTS.pinBlur
  pinBlur = Math.min(PIN_BLUR_MAX, Math.max(PIN_BLUR_MIN, pinBlur))
  let pinMaxVh = Math.round(Number(src.pinMaxVh))
  if (!Number.isFinite(pinMaxVh) || pinMaxVh <= 0) pinMaxVh = DEFAULTS.pinMaxVh
  pinMaxVh = Math.min(PIN_MAX_VH_MAX, Math.max(PIN_MAX_VH_MIN, pinMaxVh))
  // v1.5.0：chatWidth 单位从 px 改成百分比；盘上的旧 px 值（>100）由 normalizeChatWidth 落到 80%
  const chatWidth = normalizeChatWidth(src.chatWidth)
  const chatWidthEnabled = src.chatWidthEnabled === true
  const hideResizer = src.hideResizer === true
  const hideDivider = src.hideDivider === true
  // v1.11.0：审查技能开关。默认开，所以判据是 `!== false`（与 shapeEnabled 同族），
  // 不能写 `=== true` —— 那样旧 host / 旧盘上没这个字段时会被判成关，用户一升级就丢技能。
  const reviewSkillEnabled = src.reviewSkillEnabled !== false
  // v1.14.0：压缩接管已移除，这份备份不再被写入、也不再被用来还原；但它存的是用户
  // 接管前的 preset 原文（那个文件现已不存在，这是磁盘上唯一的副本），所以原样保留、
  // 永不丢弃 —— 任何一次写盘都要把它带出去。
  const compactionBackup = readBackup(src)
  return {
    gateEnabled, ponytailEnabled, shapeEnabled, pinLastUser, clearBubble, pinBlur, pinMaxVh,
    chatWidth, chatWidthEnabled, hideResizer, hideDivider, reviewSkillEnabled, compactionBackup,
  }
}

/** 取出（并校验）settings.json 里的历史压缩行备份；形状不对一律当没有。只读，不再写入。 */
export function readBackup(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const b = src.compactionBackup
  if (!b || typeof b !== 'object') return null
  if (typeof b.text !== 'string' || b.text === '') return null
  const at = Number(b.at)
  if (!Number.isFinite(at)) return null
  return { text: b.text, at }
}

async function readSettings() {
  if (frozenPolicy) return { ...frozenPolicy.settings }
  try {
    const parsed = JSON.parse(await fs.readFile(SETTINGS_FILE(), 'utf8'))
    return sanitize(parsed)
  } catch {
    return { ...DEFAULTS }
  }
}

/**
 * 同步读设置：提示词解析器在 assemble 热路径上，不能是异步的。
 * 按 mtime+size 记忆化；本进程写盘后强制失效（见 invalidateSettings）。
 */
const settingsMemo = { key: '', value: null }

function invalidateSettings() { settingsMemo.key = ''; settingsMemo.value = null }

let frozenPolicy = null
function readSettingsSync() {
  if (frozenPolicy) return frozenPolicy.settings
  let st = null
  try { st = statSync(SETTINGS_FILE()) } catch { st = null }
  if (!st || !st.isFile()) {
    invalidateSettings()
    settingsMemo.value = { ...DEFAULTS }
    settingsMemo.key = 'missing'
    return settingsMemo.value
  }
  const key = st.mtimeMs + '|' + st.size
  if (key !== settingsMemo.key || settingsMemo.value === null) {
    let parsed = null
    try { parsed = JSON.parse(readFileSync(SETTINGS_FILE(), 'utf8')) } catch { parsed = null }
    settingsMemo.key = key
    settingsMemo.value = parsed ? sanitize(parsed) : { ...DEFAULTS }
  }
  return settingsMemo.value
}

async function writeSettings(settings) {
  await fs.mkdir(SETTINGS_DIR(), { recursive: true })
  const file = SETTINGS_FILE()
  const temporary = file + '.' + process.pid + '.' + (++settingsWriteId) + '.tmp'
  try {
    await fs.writeFile(temporary, JSON.stringify(settings, null, 2), { encoding: 'utf8', flag: 'wx' })
    await fs.rename(temporary, file)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {})
  }
  invalidateSettings()
}

let settingsWriteId = 0
let settingsMutation = Promise.resolve()
function mutateSettings(task) {
  const pending = settingsMutation.then(task)
  settingsMutation = pending.catch(() => {})
  return pending
}

function settingsPayload(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('settings must be an object')
  // 压缩备份是 host 侧的历史遗留数据（v1.14.0 起只读、不再更新）：客户端不许覆盖它。
  const { compactionBackup, ...patch } = parsed
  return patch
}

/**
 * 一次性迁移：把「对话页固定宽度」从 dsh-bg-atelier 搬过来。
 *
 * 该功能的开关与数值原先存在 $DSH_HOME/dsh-bg-atelier/settings.json（客户端 PUT
 * 整个 state 写盘，字段名 chatWidth / chatWidthEnabled）；界面区块已挪到本插件，
 * 数值也就得跟着走。判定标准是"本插件的 settings.json 里没这两个字段"—— 迁移一次
 * 后写盘即带上，不会每启动都读对方的文件；底图工坊那边没有（或已删）时静默跳过。
 *
 * 迁移只在 host 启动时跑：客户端随后 GET 到的就是搬过来的值。
 */
const ATELIER_SETTINGS_FILE = () => path.join(dshHome(), 'dsh-bg-atelier', 'settings.json')

export async function migrateFromAtelier() {
  let mine = null
  try { mine = JSON.parse(await fs.readFile(SETTINGS_FILE(), 'utf8')) } catch { mine = null }
  const src = mine && typeof mine === 'object' ? mine : {}
  if (src.chatWidth !== undefined && src.chatWidthEnabled !== undefined) return null
  let atelier = null
  try { atelier = JSON.parse(await fs.readFile(ATELIER_SETTINGS_FILE(), 'utf8')) } catch { atelier = null }
  if (!atelier || typeof atelier !== 'object') return null
  if (atelier.chatWidth === undefined && atelier.chatWidthEnabled === undefined) return null
  const merged = sanitize(Object.assign({}, src, {
    chatWidth: atelier.chatWidth,
    chatWidthEnabled: atelier.chatWidthEnabled,
  }))
  await writeSettings(merged)
  return { chatWidth: merged.chatWidth, chatWidthEnabled: merged.chatWidthEnabled }
}

// ---------------------------------------------------------------------------
// 会话门禁 · 规则文本
//
// 文本按 mtime+size 缓存；提示词解析器用同步读（assemble 不允许异步 text），
// 冷启动与 HTTP 处理各有一处，之后命中缓存即零 IO。
//
// 提示词路径额外做 {{ / }} 中和：renderPrompt 对完整变量引用是"抛错"策略
// （unknown prompt variable ⇒ 该 agent 每次请求组装失败）。规则由用户自行编辑，
// 绝不能因为写了花括号就把整个会话弄挂，所以注入前替换为全角等价字形。
// 界面预览读的就是这个注入形态 —— 预览即模型实际所见，不另开一条原始读路径。
// ---------------------------------------------------------------------------
function sanitizeGateText(raw) {
  let text = String(raw || '').replace(/\r\n/g, '\n').trim()
  let guard = 0
  while ((/\{\{|\}\}/.test(text)) && guard++ < 32) {
    text = text.replace(/\{\{/g, '｛｛').replace(/\}\}/g, '｝｝')
  }
  return text
}

const gateCache = { key: '', text: '', record: null }
// ponytail 段与门禁段同构但**独立缓存**：两段各自有各自的 mtime+size 键，
// 共用一份缓存会让"改了 ponytail.md"把门禁段的缓存顶掉（反之亦然），
// assemble 热路径上表现为无谓的重读，且 gateMeta/ponyMeta 的 record 会互相串。
const ponyCache = { key: '', text: '', record: null }
// 输出形状段（v1.12.0）同理：第三份独立缓存，理由同上。
const shapeCache = { key: '', text: '', record: null }

/**
 * 一次计算同时给出"注入文本"与"截断元信息"，两者必须**同源**：
 * 分开算（例如 gateMeta 再截一次）就会出现"文本是这份、标记是那份"的错配。
 */
function cacheInto(cache, key, record) {
  cache.key = key
  cache.text = record.text
  cache.record = record
  return cache.text
}

/**
 * 一个规则段的加载器对（同步给 assemble 热路径、异步给路由与元信息）。
 * 三段各有一份**独立缓存**，不能共用：共用会让"改了 ponytail.md"把门禁段的缓存顶掉
 * （反之亦然），热路径上表现为无谓重读，且两边的 record 会互相串。
 * 三段之前是逐字复制的三对函数，收成这个工厂。
 *
 * ⚠ overrideFile 收的是**函数**不是路径：必须在每次读取时现求值。三个套件都是先 import
 * 本模块、再改写 process.env.DSH_HOME 指向临时目录，模块加载期就把路径定下来的话，
 * 它们写的 override 全都落在测试自己的临时目录里、而加载器还在看真实 home —— 表现为
 * "override 明明写了却读回内置正文"（v1.12.2 收工厂时踩过，verify-ponytail-gate 第 2 组红）。
 */
function makeRuleLoader(builtinFile, overrideFile, cache) {
  const sync = () => loadRuleFile(builtinFile, overrideFile(), cache, GATE_MAX_BYTES)
  const load = async () => {
    try { return sync() } catch { return '' }
  }
  return [sync, load]
}

const [loadGateSync, loadGate] = makeRuleLoader(GATE_BUILTIN_FILE, GATE_OVERRIDE_FILE, gateCache)
const [loadPonytailSync, loadPonytail] = makeRuleLoader(PONY_BUILTIN_FILE, PONY_OVERRIDE_FILE, ponyCache)
const [loadShapeSync, loadShape] = makeRuleLoader(SHAPE_BUILTIN_FILE, SHAPE_OVERRIDE_FILE, shapeCache)

/**
 * 「内置 + override」两段共用的加载器。loadGateSync 与 loadPonytailSync 都是它的一行特化，
 * 别再复制一份 mtime+size 记忆化 —— 两处实现必然漂移（cache-control 的老教训）。
 */
function loadRuleFile(builtinFile, overrideFile, cache, maxBytes) {
  if (frozenPolicy) {
    const key = Object.keys(policyFiles).find(key => policyFiles[key].override() === overrideFile)
    if (key) return truncateBytes(sanitizeGateText(frozenPolicy.rules[key].text), maxBytes).text
  }
  let target = overrideFile
  try {
    if (!existsSync(overrideFile)) target = builtinFile
  } catch { target = builtinFile }
  let st = null
  try { st = statSync(target) } catch { st = null }
  if (!st || !st.isFile()) {
    let builtin = ''
    try { builtin = readFileSync(builtinFile, 'utf8') } catch { builtin = '' }
    return cacheInto(cache, 'missing', truncateBytes(sanitizeGateText(builtin), maxBytes))
  }
  const key = target + '|' + st.mtimeMs + '|' + st.size
  if (key !== cache.key) {
    let raw = ''
    try { raw = readFileSync(target, 'utf8') } catch { raw = '' }
    cacheInto(cache, key, truncateBytes(sanitizeGateText(raw), maxBytes))
  }
  return cache.text
}

/**
 * 按字节上限截断，**直接返回一次截断的全部事实**（不返回裸字符串）：
 *   { text, originalBytes, keptBytes, truncated }
 * 调用方一律读 `truncated` 判断"有没有被砍过"。
 *
 * **不要**改成"拿返回文本的长度跟上限比"来反推（v1.6.2 修掉的缺陷）：
 * 截断后的长度必然**小于**上限（含末尾那句省略提示也就 5.6–6.1 KB 一档，
 * 且取决于原文的字节/字符比），所以 `bytes >= max` 这种判据对已截断的文本
 * 恒为 false —— 界面于是对用户的超长规则显示"未截断"，规则被砍了也没人知道。
 * 反方向同样会错：原文**恰好**等于上限时文本原样返回、`bytes === max`，
 * 那个判据又会把没截断的判成截断。两个方向都只能用显式标记，不能用长度猜。
 */
function truncateBytes(text, max) {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= max) {
    // 未超限：原样返回，两个长度相等 —— "标记为假"与"内容没变"必须同时成立。
    return { text, originalBytes: buf.length, keptBytes: buf.length, truncated: false }
  }
  let cut = text.slice(0, max)
  while (Buffer.byteLength(cut, 'utf8') > max - 32) cut = cut.slice(0, Math.floor(cut.length * 0.9))
  // 只可能在尾部留下被切开的代理对半字符，剥掉它，避免 HTTP JSON 里出现替换字符。
  cut = cut.replace(/[\uD800-\uDFFF]$/, '')
  const kept = cut + '\n\n[…规则文本超出字节上限，其余部分已省略]'
  return { text: kept, originalBytes: buf.length, keptBytes: Buffer.byteLength(kept, 'utf8'), truncated: true }
}

/** 注入形态：开关关 / 文本空 ⇒ 空串（renderPrompt 会丢掉空段）。 */
export function gatePromptText(settings) {
  if (!settings || settings.gateEnabled !== true) return ''
  return loadGateSync()
}

/** ponytail 段的注入形态，语义与 gatePromptText 完全一致。 */
export function ponytailPromptText(settings) {
  if (!settings || settings.ponytailEnabled !== true) return ''
  return loadPonytailSync()
}

/**
 * 输出形状段的注入形态。默认**开**，所以这里读的是 `!== false` ——
 * 与 gate/ponytail 两个"默认关"的段不同，不能照抄它们的 `=== true`。
 * 逃生开关保留 dsh-output-shape 时期的那个名字（旧环境变量继续有效）。
 */
export function shapePromptText(settings) {
  if (process.env[SHAPE_DISABLE_ENV] === '1') return ''
  // 只有**显式的 false** 才关：null / undefined 都按默认开走（与 sanitize 的 `!== false` 同一口径）。
  if (settings && settings.shapeEnabled === false) return ''
  return loadShapeSync()
}

/**
 * 「内置 + override」三段共用的元信息（门禁 / ponytail / 输出形状）。与旧的 gateMeta 同一套口径：
 * 截断三元组必须与文本同源，预览返回的就是注入形态 —— 别再复制第二份实现。
 *
 * `defaultOn` 只影响 enabled 的判读：门禁/ponytail 缺省关（`=== true`），
 * 输出形状缺省开（`!== false`，见 DEFAULTS.shapeEnabled 的注释）。
 */
async function ruleMeta(settings, enabledKey, builtinFile, overrideFile, cache, defaultOn = false) {
  const key = Object.keys(policyFiles).find(key => policyFiles[key].override() === overrideFile)
  const frozen = frozenPolicy && key ? frozenPolicy.rules[key] : null
  const usingOverride = frozen ? frozen.override !== null : existsSync(overrideFile)
  const sourcePath = usingOverride ? overrideFile : builtinFile
  let text = ''
  try { text = loadRuleFile(builtinFile, overrideFile, cache, GATE_MAX_BYTES) } catch { text = '' }
  const bytes = Buffer.byteLength(text, 'utf8')
  // 与 text 同源的截断记录（loadRuleFile 里一并算出）。truncated 是**显式标记**；
  // 旧写法 `bytes >= GATE_MAX_BYTES` 既漏判截断又误判恰好压线的原文，见 truncateBytes 的注释。
  // record 为空只在加载吞掉异常时出现，退化成"无截断"。
  const info = frozen ? truncateBytes(sanitizeGateText(frozen.text), GATE_MAX_BYTES)
    : cache.record || { originalBytes: bytes, keptBytes: bytes, truncated: false }
  const on = settings && settings[enabledKey] !== undefined
    ? (defaultOn ? settings[enabledKey] !== false : settings[enabledKey] === true)
    : defaultOn
  return {
    enabled: on,
    source: usingOverride ? 'override' : 'builtin',
    builtinPath: builtinFile,
    overridePath: overrideFile,
    sourcePath,
    editablePath: overrideFile,
    bytes,
    maxBytes: GATE_MAX_BYTES,
    truncated: info.truncated,
    originalBytes: info.originalBytes,
    keptBytes: info.keptBytes,
    lines: text ? text.split('\n').length : 0,
    text,
  }
}

export async function gateMeta(settings) {
  return ruleMeta(settings, 'gateEnabled', GATE_BUILTIN_FILE, GATE_OVERRIDE_FILE(), gateCache)
}

export async function ponytailMeta(settings) {
  return ruleMeta(settings, 'ponytailEnabled', PONY_BUILTIN_FILE, PONY_OVERRIDE_FILE(), ponyCache)
}

export async function shapeMeta(settings) {
  const meta = await ruleMeta(settings, 'shapeEnabled', SHAPE_BUILTIN_FILE, SHAPE_OVERRIDE_FILE(), shapeCache, true)
  // 逃生开关压过设置：界面要能说出"开关开着、其实没注入"这个状态，而不是继续报"开"。
  return { ...meta, disabledByEnv: process.env[SHAPE_DISABLE_ENV] === '1' }
}

/** 写入 / 清除（text 为 null 或空串）规则 override。 */
export async function writeGateOverride(text) {
  return writeRuleOverride(GATE_OVERRIDE_FILE(), gateCache, loadGate, text)
}

export async function writePonytailOverride(text) {
  return writeRuleOverride(PONY_OVERRIDE_FILE(), ponyCache, loadPonytail, text)
}

export async function writeShapeOverride(text) {
  return writeRuleOverride(SHAPE_OVERRIDE_FILE(), shapeCache, loadShape, text)
}

/**
 * 「内置 + override」两段共用的写盘（门禁 / ponytail）。
 * 与 gateMeta 同一套口径：写完立刻失效对应缓存并回读注入形态，
 * 调用方拿到的就是模型下一步实际会看到的东西。
 */
async function writeRuleOverride(overrideFile, cache, reload, text) {
  const key = Object.keys(policyFiles).find(key => policyFiles[key].override() === overrideFile)
  await policy.writeRule(key, text)
  return reload()
}

const policyFiles = {
  gate: { builtin: GATE_BUILTIN_FILE, override: GATE_OVERRIDE_FILE, cache: gateCache },
  ponytail: { builtin: PONY_BUILTIN_FILE, override: PONY_OVERRIDE_FILE, cache: ponyCache },
  shape: { builtin: SHAPE_BUILTIN_FILE, override: SHAPE_OVERRIDE_FILE, cache: shapeCache },
}
function scopedRuleText(key, context) {
  const id = policy.sessionId(context)
  const settings = policy.effective(readSettingsSync(), id)
  if (settings[key + 'Enabled'] !== true || (key === 'shape' && process.env[SHAPE_DISABLE_ENV] === '1')) return ''
  const text = policy.sessionRule(key, context)
  if (text !== null) return truncateBytes(sanitizeGateText(text), GATE_MAX_BYTES).text
  return ({ gate: gatePromptText, ponytail: ponytailPromptText, shape: shapePromptText })[key](settings)
}
export const policy = createPolicyManager({
  home: dshHome, readSettings, writeSettings, mutate: mutateSettings, files: policyFiles,
  invalidateRule(key) { Object.assign(policyFiles[key].cache, { key: '', text: '', record: null }) },
  freeze(snapshot) { frozenPolicy = snapshot },
  getFrozen() { return frozenPolicy },
  expectedRules(id) { return Object.fromEntries(Object.keys(policyFiles).map(key => [key, scopedRuleText(key, { agent: { session: { id } } })])) },
})

// ---------------------------------------------------------------------------
// HTTP 路由
// ---------------------------------------------------------------------------
/**
 * 读请求体。超限时**不**销毁 socket：继续排空、在 end 时再报错，
 * 让 handler 能干净地回 400。（旧写法直接 req.destroy()，客户端会看到
 * ECONNRESET，Windows 下还能触发 libuv 的 handle-closing 断言。）
 */
function readBody(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let overflow = false
    req.on('data', (c) => {
      size += c.length
      if (size > maxBytes) { overflow = true; chunks.length = 0; return }
      chunks.push(c)
    })
    req.on('end', () => {
      if (overflow) { reject(new Error('body too large (> ' + maxBytes + ' B)')); return }
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

export async function apply(ctx) {
  // Complete or roll back an interrupted multi-file preset update before serving requests.
  await policy.recover()
  const webServer = ctx.get('webServer')
  if (webServer === undefined) {
    console.error('[dsh-cache-control] webServer service unavailable, host half disabled')
    return
  }
  let gateSectionActive = false
  let ponySectionActive = false
  let shapeSectionActive = false
  // v1.11.0：审查技能。注册状态与 dispose 都记在这里，卸载时必须撤干净。
  const reviewState = { registered: [], disposers: [], serviceAvailable: false }
  // v1.12.0：并入的两条常驻技能（i-have-adhd / ponytail）。**独立于 reviewState** ——
  // 审查技能是可开关的，关掉时会 dispose 自己那一批；共用一份状态会把这两条一起注销掉。
  const ruleSkillState = { registered: [], disposers: [] }

  // v1.14.0：压缩接管（改写 standard 组装文件）随 DSH 0.1.7 一并移除 —— 0.1.7 起
  // agent preset 不再是可编辑的 agent.cordis.yml，安装里已无该文件，这条路没有落点。
  // 启动时只剩一件事：把底图工坊的「对话页固定宽度」搬过来。
  try {
    // 先把「对话页固定宽度」从底图工坊搬过来（只在缺字段时读对方文件，见 migrateFromAtelier）。
    const moved = await migrateFromAtelier()
    if (moved) console.log('[dsh-cache-control] 对话页宽度已从 dsh-bg-atelier 迁入：' + JSON.stringify(moved))
  } catch (err) {
    console.warn('[dsh-cache-control] boot migrate skipped: ' + String((err && err.message) || err))
  }

  // ---- 省 token（v1.13.0）：并入自 dsh-plugin-save-token 的压缩/去重/取回 ----
  // 用 ctx.plugin 挂成**嵌套 Cordis 插件**（不是独立 bundle 行）：
  //   · 它有自己的装配条目才能独立装卸，那样就又多了一个会与别人冲突的槽位；
  //   · 嵌套挂载下 inject=['tools','webServer'] 由 Cordis 自己等服务就绪，
  //     父层不必把 tools 写进自己的 inject 列表；
  //   · 卸载本插件时子插件随之卸载（ctx.effect 语义一致），旧会话的
  //     spillStore 引用也不会残留。
  // 上游的 compaction assist 分支已整段删除：压缩契约只归本插件的「省缓存」
  // 一块所有（它写 preset 那行 + 字节级备份还原），两处驱动同一个引擎就是
  // 这次嵌入要避免的冲突。理由与删除清单见 save-token-host.js 文件头。
  let saveTokenMounted = false
  if (typeof ctx.plugin === 'function') {
    try {
      ctx.plugin(saveToken, {})
      saveTokenMounted = true
      console.log('[dsh-cache-control] save-token half mounted as nested plugin (compress + dedupe + save_token_expand)')
    } catch (err) {
      console.warn('[dsh-cache-control] save-token half failed to mount: ' + String((err && err.message) || err))
    }
  }
  // ctx.plugin 不在时**不算挂载失败**（老上下文/测试替身没有嵌套挂载 API）：不 warning，
  // 只在下面 host up 那行标 saveToken=absent，免得八套别的替身每次都喊"挂载失败"。

  // ---- 会话门禁：向提示词注册表挂一段常驻规则（宿主全局层）----
  // 用 ctx.inject 惰性依赖：拿不到 systemPrompt 服务时只关掉门禁功能，
  // 不连带把压缩开关一起弄挂。text 为函数 ⇒ 每次 assemble 重新求值，
  // 于是开关与规则编辑对"已经打开的会话"的下一个 step 也生效。
  try {
    ctx.inject(['systemPrompt'], (promptCtx) => {
      try {
        promptCtx.systemPrompt.section({
          name: GATE_SECTION,
          order: GATE_SECTION_ORDER,
          text: (context) => {
            try {
              return scopedRuleText('gate', context)
            } catch {
              return ''
            }
          },
        })
        gateSectionActive = true
        console.log('[dsh-cache-control] session gate section mounted (order ' + GATE_SECTION_ORDER + ')')
      } catch (err) {
        console.warn('[dsh-cache-control] gate section rejected: ' + String((err && err.message) || err))
      }
    })
  } catch (err) {
    console.warn('[dsh-cache-control] systemPrompt unavailable, gate disabled: ' + String((err && err.message) || err))
  }

  // ---- ponytail 编码纪律：第二段常驻规则（v1.10.0），与门禁同一条挂载路径 ----
  try {
    ctx.inject(['systemPrompt'], (promptCtx) => {
      try {
        promptCtx.systemPrompt.section({
          name: PONY_SECTION,
          order: PONY_SECTION_ORDER,
          text: (context) => {
            try {
              return scopedRuleText('ponytail', context)
            } catch {
              return ''
            }
          },
        })
        ponySectionActive = true
        console.log('[dsh-cache-control] ponytail section mounted (order ' + PONY_SECTION_ORDER + ')')
      } catch (err) {
        console.warn('[dsh-cache-control] ponytail section rejected: ' + String((err && err.message) || err))
      }
    })
  } catch (err) {
    console.warn('[dsh-cache-control] systemPrompt unavailable, ponytail disabled: ' + String((err && err.message) || err))
  }

  // ---- 输出形状：第三段常驻规则（v1.12.0，并入自 dsh-output-shape），同一挂载路径 ----
  // 段名从 `dsh-output-shape:output-shape` 改成 `dsh-cache-control:shape-gate`；order 仍是 410
  // （守则 400 → ponytail 405 → 本段 410）。段名只在运行时用，盘上没有引用，改名不需要迁移。
  try {
    ctx.inject(['systemPrompt'], (promptCtx) => {
      try {
        promptCtx.systemPrompt.section({
          name: SHAPE_SECTION,
          order: SHAPE_SECTION_ORDER,
          text: (context) => {
            try {
              return scopedRuleText('shape', context)
            } catch {
              return ''
            }
          },
        })
        shapeSectionActive = true
        console.log('[dsh-cache-control] output shape section mounted (order ' + SHAPE_SECTION_ORDER + ')')
      } catch (err) {
        console.warn('[dsh-cache-control] output shape section rejected: ' + String((err && err.message) || err))
      }
    })
  } catch (err) {
    console.warn('[dsh-cache-control] systemPrompt unavailable, output shape disabled: ' + String((err && err.message) || err))
  }

  // ---- 自动代码审查（v1.11.0）：注册**按需技能**，不注入常驻段 ----
  // 与上面两段的根本区别：这里一个字都不进 system prompt。技能装了只在目录里多一行说明，
  // 正文由模型真正要用时才加载 ⇒ 零常驻 token；审什么文件、按哪条规则，每次现向 ocr 取。
  // 开关关掉 ⇒ dispose 并清空目录条目（不是"留着但不用"）。
  async function syncReviewSkill() {
    const skillsService = ctx.get('skills')
    reviewState.serviceAvailable = skillsService !== undefined
    if (skillsService === undefined) return reviewState.registered.slice()
    const want = readSettingsSync().reviewSkillEnabled === true
    const have = reviewState.registered.length > 0
    if (!want && !have) return reviewState.registered.slice()
    if (!want && have) {
      for (const d of reviewState.disposers) { try { d() } catch { /* 已撤 */ } }
      reviewState.disposers = []
      reviewState.registered = []
      console.log('[dsh-cache-control] 审查技能已注销（开关关）')
      return reviewState.registered.slice()
    }
    if (want && have) return reviewState.registered.slice()
    let text = ''
    try {
      const { readFile } = await import('node:fs/promises')
      text = await readFile(path.join(SKILLS_ROOT, REVIEW_SKILL_NAME, 'SKILL.md'), 'utf8')
    } catch (err) {
      console.warn('[dsh-cache-control] 审查技能正文读取失败：' + String((err && err.message) || err))
      return reviewState.registered.slice()
    }
    const { attrs, body } = parseSkillFrontmatter(text)
    const name = (attrs.name || REVIEW_SKILL_NAME).trim()
    const description = (attrs.description || '').replace(/\s+/g, ' ').trim()
    if (description === '') {
      console.warn('[dsh-cache-control] 审查技能缺 description，未注册（目录里躺一个没说明的技能比少一个更糟）')
      return reviewState.registered.slice()
    }
    try {
      const dispose = skillsService.register({
        name,
        description,
        ...(attrs.whenToUse ? { whenToUse: attrs.whenToUse } : {}),
        content: body.trim(),
        source: 'custom',
        provider: 'dsh-cache-control',
        invocation: { modelInvocable: true, userInvocable: true },
        resourceBase: { kind: 'directory', path: path.join(SKILLS_ROOT, REVIEW_SKILL_NAME) },
        path: path.join(SKILLS_ROOT, REVIEW_SKILL_NAME, 'SKILL.md'),
      })
      reviewState.disposers.push(dispose)
      reviewState.registered.push(name)
      console.log('[dsh-cache-control] 审查技能已注册：' + name)
    } catch (err) {
      console.warn('[dsh-cache-control] 审查技能注册失败：' + String((err && err.message) || err))
    }
    return reviewState.registered.slice()
  }
  await syncReviewSkill().catch((err) => {
    console.warn('[dsh-cache-control] 审查技能初始化失败：' + String((err && err.message) || err))
  })
  ctx.effect(() => () => {
    for (const d of reviewState.disposers) { try { d() } catch { /* 已撤 */ } }
    reviewState.disposers = []
    reviewState.registered = []
  })

  // ---- 常驻技能（v1.12.0，并入自 dsh-output-shape）：i-have-adhd / ponytail ----
  // 无开关、无路由：注册一次就完事。正文来自本插件自己的规则文件（见 RULE_SKILLS 注释）。
  async function syncRuleSkills() {
    const skillsService = ctx.get('skills')
    if (skillsService === undefined) {
      console.warn('[dsh-cache-control] skills 服务不可用，形状/ponytail 技能未注册（常驻段不受影响）')
      return []
    }
    for (const spec of RULE_SKILLS) {
      let content = ''
      try { content = spec.body() } catch (err) {
        console.warn('[dsh-cache-control] 技能 ' + spec.name + ' 正文读取失败：' + String((err && err.message) || err))
      }
      if (!content.trim()) {
        console.warn('[dsh-cache-control] 技能 ' + spec.name + ' 正文为空，未注册')
        continue
      }
      try {
        const dispose = skillsService.register({
          name: spec.name,
          description: spec.description,
          ...(spec.whenToUse ? { whenToUse: spec.whenToUse } : {}),
          content,
          source: 'custom',
          provider: 'dsh-cache-control',
          invocation: { modelInvocable: true, userInvocable: true },
          resourceBase: { kind: 'directory', path: PACKAGE_ROOT },
          path: spec.builtinFile,
        })
        ruleSkillState.disposers.push(dispose)
        ruleSkillState.registered.push(spec.name)
        console.log('[dsh-cache-control] 常驻技能已注册：' + spec.name)
      } catch (err) {
        console.warn('[dsh-cache-control] 技能 ' + spec.name + ' 注册失败：' + String((err && err.message) || err))
      }
    }
    return ruleSkillState.registered.slice()
  }
  await syncRuleSkills().catch((err) => {
    console.warn('[dsh-cache-control] 常驻技能初始化失败：' + String((err && err.message) || err))
  })
  ctx.effect(() => () => {
    for (const d of ruleSkillState.disposers) { try { d() } catch { /* 已撤 */ } }
    ruleSkillState.disposers = []
    ruleSkillState.registered = []
  })

  const send = (res, status, obj) => {
    try {
      const body = JSON.stringify(obj)
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-cache',
        'content-length': Buffer.byteLength(body),
      })
      res.end(body)
    } catch { /* socket gone */ }
  }

  // ---- 存储用量 / 清理（v1.8.0）：GET 只读汇总，POST 移到回收目录，PURGE 清回收目录 ----
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: STORAGE_PATH,
    handler: async (req, res) => {
      try {
        if (req.method !== 'GET') { send(res, 405, { ok: false, error: 'method not allowed' }); return }
        const home = dshHome()
        send(res, 200, await readStorageSnapshot(home, /[?&]refresh=1(?:&|$)/.test(req.url || '')))
      } catch (err) {
        send(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    },
  }))

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: CLEAN_PATH,
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') { send(res, 405, { ok: false, error: 'method not allowed' }); return }
        const body = JSON.parse(await readBody(req))
        const home = dshHome()
        const allowed = (await cleanCandidates(home)).map((c) => path.resolve(c.path))
        const wants = Array.isArray(body.paths) ? body.paths : allowed
        invalidateStorageSnapshot()
        const result = await recyclePaths(wants, home, allowed)
        invalidateStorageSnapshot()
        send(res, 200, { ok: true, ...result })
      } catch (err) {
        send(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    },
  }))

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: PURGE_PATH,
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') { send(res, 405, { ok: false, error: 'method not allowed' }); return }
        const dir = RECYCLE_DIR()
        invalidateStorageSnapshot()
        const before = await dirUsage(dir)
        if (existsSync(dir)) await fs.rm(dir, { recursive: true, force: true })
        invalidateStorageSnapshot()
        send(res, 200, { ok: true, freed: before.bytes, files: before.files })
      } catch (err) {
        send(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    },
  }))

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: GET_PATH,
    handler: async (req, res) => {
      if (req.method === 'GET') {
        try {
          const settings = await readSettings()
          const gate = await gateMeta(settings)
          const ponytail = await ponytailMeta(settings)
          const shape = await shapeMeta(settings)
          send(res, 200, {
            settings,
            gate,
            ponytail,
            shape,
          })
        } catch (err) {
          send(res, 500, { ok: false, error: String((err && err.message) || err) })
        }
        return
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        try {
          const parsed = JSON.parse(await readBody(req))
          const patch = settingsPayload(parsed)
          const { settings } = await mutateSettings(async () => {
            const before = await readSettings()
            const settings = sanitize({ ...before, ...patch })
            await writeSettings(settings)
            if (before.reviewSkillEnabled !== settings.reviewSkillEnabled) await syncReviewSkill()
            return { settings }
          })
          send(res, 200, {
            ok: true,
            gateEnabled: settings.gateEnabled,
            ponytailEnabled: settings.ponytailEnabled,
            shapeEnabled: settings.shapeEnabled,
          })
        } catch (err) {
          send(res, 400, { ok: false, error: String((err && err.message) || err) })
        }
        return
      }
      send(res, 405, { ok: false, error: 'method not allowed' })
    },
  }), 'dsh-cache-control: settings route')

  /**
   * 三段规则文本路由（门禁 / ponytail / 输出形状）逐字同构，只是键名与读写函数不同：
   * GET 返回 meta，PUT/POST 写 override 并回带同一份 meta。合并前这三条各 ~38 行。
   */
  const ruleRoutes = [
    { path: GATE_PATH, key: 'gate', label: 'gate route', write: writeGateOverride, meta: gateMeta },
    { path: PONY_PATH, key: 'ponytail', label: 'ponytail route', write: writePonytailOverride, meta: ponytailMeta },
    { path: SHAPE_PATH, key: 'shape', label: 'shape route', write: writeShapeOverride, meta: shapeMeta },
  ]
  for (const r of ruleRoutes) {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: r.path,
      handler: async (req, res) => {
        if (req.method === 'GET') {
          try {
            send(res, 200, { ok: true, [r.key]: await r.meta(await readSettings()) })
          } catch (err) {
            send(res, 500, { ok: false, error: String((err && err.message) || err) })
          }
          return
        }
        if (req.method === 'PUT' || req.method === 'POST') {
          try {
            const parsed = JSON.parse(await readBody(req))
            await r.write(parsed && parsed.text)
            // 响应直接带出截断状态：刚保存完就该知道规则有没有被砍（原 N 字节 → 保留 M 字节）。
            // 字段与 meta 同源，老字段（bytes / lines / source / enabled）一个不少。
            const m = await r.meta(await readSettings())
            send(res, 200, {
              ok: true,
              [r.key]: m,
              bytes: m.bytes,
              lines: m.lines,
              source: m.source,
              enabled: m.enabled,
              maxBytes: m.maxBytes,
              truncated: m.truncated,
              originalBytes: m.originalBytes,
              keptBytes: m.keptBytes,
            })
          } catch (err) {
            send(res, 400, { ok: false, error: String((err && err.message) || err) })
          }
          return
        }
        send(res, 405, { ok: false, error: 'method not allowed' })
      },
    }), 'dsh-cache-control: ' + r.label)
  }

  // Observe the actual system text at the request boundary without retaining it.
  if (typeof ctx.on === 'function') {
    ctx.on('llm/stream', (options, next) => {
      try { policy.observe(options) } catch (error) { console.warn('[dsh-cache-control] request check failed:', error.message) }
      return next()
    })
    policy.attachProbe()
  }
  const mounted = () => ({ gate: gateSectionActive, ponytail: ponySectionActive, shape: shapeSectionActive })
  for (const endpoint of ['policy', 'history', 'diagnostics', 'analyze']) {
    ctx.effect(() => webServer.register({
      kind: 'exact', path: '/cc/' + endpoint,
      handler: async (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost'), sid = url.searchParams.get('sessionId') || null
          if (req.method === 'GET') {
            if (endpoint === 'policy') return send(res, 200, { ok: true, ...(await policy.view(sid)) })
            if (endpoint === 'history') return send(res, 200, { ok: true, history: await policy.history(url.searchParams.get('key'), url.searchParams.get('id') || undefined) })
            if (endpoint === 'diagnostics') return send(res, 200, { ok: true, ...policy.diagnostics(sid, mounted()) })
          }
          if (req.method === 'POST') {
            const body = JSON.parse(await readBody(req, 256 * 1024))
            if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('请求必须为对象')
            if (endpoint === 'analyze') return send(res, 200, { ok: true, ...analyzeRules(body.rules) })
            if (endpoint === 'policy') {
              const result = body.action === 'preview' ? await policy.preview(body.id, body.scope, body.sessionId) : await policy.action(body)
              return send(res, 200, { ok: true, ...result })
            }
            if (endpoint === 'history' && body.action === 'restore') {
              await policy.restore(body.key, body.id)
              return send(res, 200, { ok: true, [body.key]: await ({ gate: gateMeta, ponytail: ponytailMeta, shape: shapeMeta })[body.key](await readSettings()) })
            }
          }
          send(res, 405, { ok: false, error: 'method not allowed' })
        } catch (error) { send(res, 400, { ok: false, error: error.message || String(error) }) }
      },
    }), 'dsh-cache-control: ' + endpoint)
  }

  // ---- 自动代码审查（v1.11.0）：状态查询 + 开关切换 ----
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: REVIEW_PATH,
    handler: async (req, res) => {
      if (req.method === 'GET') {
        try {
          const s = await readSettings()
          send(res, 200, { ok: true, review: await reviewMeta(s, reviewState) })
        } catch (err) {
          send(res, 500, { ok: false, error: String((err && err.message) || err) })
        }
        return
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        try {
          const parsed = JSON.parse(await readBody(req))
          settingsPayload(parsed)
          const { next, registered } = await mutateSettings(async () => {
            const next = sanitize(Object.assign({}, await readSettings(), {
              reviewSkillEnabled: parsed.enabled !== false,
            }))
            await writeSettings(next)
            const registered = await syncReviewSkill()
            return { next, registered }
          })
          send(res, 200, { ok: true, review: await reviewMeta(next, reviewState, registered) })
        } catch (err) {
          send(res, 400, { ok: false, error: String((err && err.message) || err) })
        }
        return
      }
      send(res, 405, { ok: false, error: 'method not allowed' })
    },
  }), 'dsh-cache-control: review route')

  const settings = await readSettings()
  const gateText = await loadGate()
  const ponyText = await loadPonytail()
  const shapeText = await loadShape()
  console.log('[dsh-cache-control] host up (' + GET_PATH + ', ' + GATE_PATH + ', ' + PONY_PATH + ', ' + SHAPE_PATH + ')'
    + ' gate=' + settings.gateEnabled
    + ' gateSection=' + (gateSectionActive ? 'mounted' : 'absent')
    + ' gateBytes=' + Buffer.byteLength(gateText, 'utf8')
    + ' pony=' + settings.ponytailEnabled
    + ' ponySection=' + (ponySectionActive ? 'mounted' : 'absent')
    + ' ponyBytes=' + Buffer.byteLength(ponyText, 'utf8')
    + ' shape=' + settings.shapeEnabled
    + ' shapeSection=' + (shapeSectionActive ? 'mounted' : 'absent')
    + ' shapeBytes=' + Buffer.byteLength(shapeText, 'utf8')
    + ' skills=' + (ruleSkillState.registered.length ? ruleSkillState.registered.join('+') : 'none')
    + ' saveToken=' + (saveTokenMounted ? 'mounted' : 'absent'))
}
