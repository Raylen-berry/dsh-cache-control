// ============================================================================
// dsh-cache-control · Host half
//
// 职责：
//   1. 动态改写 standard agent preset 组装文件（agent.cordis.yml）中
//      @deepseek-ai/dsh-compaction-basic 那一行的 config：
//      - 开启(enabled=true)时写入 thresholdRatio / retainRatio / auto；
//      - 关闭时移除该行上的 config（回到出厂默认 0.8 / 0.16 / auto:true）。
//   2. 会话门禁（session gate）：把插件内的长期规则文件 session-gate.md 作为
//      一段 system prompt 常驻注入（通过 ctx.systemPrompt.section，宿主全局层，
//      与 dsh-web-app 注入 "app:web-surface" 段同一条路）。开关只决定这段文本
//      是否为空 —— 空段在 renderPrompt 里被丢弃，因此关=完全不进提示词。
//   3. 设置持久化到 $DSH_HOME/dsh-cache-control/settings.json（HTTP GET/PUT
//      /cc/settings.json）；规则的可编辑副本持久化到
//      $DSH_HOME/dsh-cache-control/gate.md（override，删除即回到插件内置文本），
//      经 HTTP GET/PUT /cc/gate.json 读写（仿 dsh-bg-atelier 的路由写法）。
//      settings.json 里还带着两块纯界面的值：③ 外观（pinLastUser / clearBubble /
//      pinBlur）与 ④ 对话页（chatWidth / chatWidthEnabled）—— host 只做校验与
//      存取，具体怎么作用到页面上全在 client 侧。④ 这两项原属 dsh-bg-atelier，
//      启动时经 migrateFromAtelier() 一次性搬过来。
//
// 生效语义（DSH 自身机制，非本插件发明）：
//   * 压缩参数：preset 常驻挂载按组装文件的 mtime+size 分代；文件一变，下一个
//     “新建”的会话挂载时就自动使用新一代际。已打开的会话保持其建会话时的组装。
//   * 会话门禁：system prompt 每个 model step 重新 assemble()，且压缩只折叠历史
//     不折叠 system prompt ⇒ 门禁对已打开的会话在下一个 step 生效，且不被压缩稀释。
//     两者生效范围不同，故界面上分别说明。
//
// 只读打包目录、只写 $DSH_HOME 与目标 preset 文件那一行，不改任何其它文件。
// ============================================================================

import { promises as fs } from 'node:fs'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const name = 'dsh-cache-control'
export const inject = ['webServer']

/** 仅用于界面换算显示：deepseek-v4-flash (deepseek-official) 适配器声明的窗口。 */
export const ROUTED_CONTEXT_WINDOW = 1_000_000

const SETTINGS_DIR = () => path.join(dshHome(), 'dsh-cache-control')
const SETTINGS_FILE = () => path.join(dshHome(), 'dsh-cache-control', 'settings.json')
const GET_PATH = '/cc/settings.json'
const GATE_PATH = '/cc/gate.json'

/** 规则 override 落盘位置（用户在界面上编辑后写入；删除它即回到插件内置文本）。 */
const GATE_OVERRIDE_FILE = () => path.join(dshHome(), 'dsh-cache-control', 'gate.md')

/** 插件自带、随包分发的长期规则。 */
const GATE_BUILTIN_FILE = fileURLToPath(new URL('./session-gate.md', import.meta.url))

/** 注入提示词的字节上限：这段文本每请求重复计费，必须留硬闸。 */
const GATE_MAX_BYTES = 6 * 1024

/** 门禁段的提示词位置：persona(0) 之后、plan 政策(500) 之前，越靠前权重越稳。 */
export const GATE_SECTION = 'dsh-cache-control:session-gate'
export const GATE_SECTION_ORDER = 400

/** 写入 config 时的标记注释：既便于用户识别，也让插件能识别“这是我写过的行”。 */
const MANAGER_MARK = '# managed by dsh-cache-control (auto-rewritten)'

export function dshHome() {
  return process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh')
}

// ---------------------------------------------------------------------------
// 目标文件定位：standard preset 的 agent.cordis.yml。
// profiles/node_modules/@deepseek-ai/dsh-agent-presets 是指向 app 安装目录的
// junction，因此候选列表覆盖常见布局；取第一个存在的。
// ---------------------------------------------------------------------------
export function standardCompositionCandidates() {
  const home = dshHome()
  const list = []
  if (home) {
    list.push(
      path.join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets', 'standard', 'agent.cordis.yml'),
      path.join(home, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets', 'standard', 'agent.cordis.yml')
    )
  }
  return list
}

export async function resolveStandardFile() {
  for (const candidate of standardCompositionCandidates()) {
    try {
      const stat = await fs.stat(candidate)
      if (stat.isFile()) return candidate
    } catch { /* try next */ }
  }
  throw new Error('cannot locate standard preset agent.cordis.yml (tried: ' + standardCompositionCandidates().join(' | ') + ')')
}

// ---------------------------------------------------------------------------
// 纯文本改写：只替换 compaction-basic 那一行块，其余字节不动。
// 行块 = `- id: compaction-basic` 起到（其后缩进属性行/注释行的末尾）为止，
// 遇到空行或下一个 `- id:` 行即结束。
// values === null 时输出“无 config”的出厂形态（引擎默认 0.8/0.16/auto）。
// ---------------------------------------------------------------------------
export function compactionConfigLines(values) {
  const out = []
  if (!values) return out
  out.push('      ' + MANAGER_MARK)
  out.push('      config:')
  out.push('        thresholdRatio: ' + values.thresholdRatio.toFixed(2))
  out.push('        retainRatio: ' + values.retainRatio.toFixed(2))
  out.push('        auto: ' + (values.auto ? 'true' : 'false'))
  return out
}

export function spliceCompactionRow(text, values) {
  const lines = String(text).split('\n')
  const start = lines.findIndex((l) => /^\s*- id: compaction-basic\s*$/.test(l))
  if (start < 0) throw new Error('compaction-basic row not found in composition')
  let end = start + 1
  while (end < lines.length) {
    const l = lines[end]
    if (l.trim() === '') break
    if (/^\s*- id:/.test(l)) break
    if (!/^\s/.test(l)) break
    end += 1
  }
  const row = ['    - id: compaction-basic', "      name: '@deepseek-ai/dsh-compaction-basic'"]
  row.push(...compactionConfigLines(values))
  return lines.slice(0, start).concat(row, lines.slice(end)).join('\n')
}

export function hasManagedMarker(text) {
  return String(text).includes(MANAGER_MARK)
}

// ---------------------------------------------------------------------------
// 设置：默认值与清洗
// ---------------------------------------------------------------------------
export const DEFAULTS = Object.freeze({
  enabled: false,
  triggerPct: 25,   // 触发点 = 窗口的 25% (~250k / 1M)
  retainPct: 5,     // 逐字保留尾部 = 窗口的 5% (~50k / 1M)
  auto: true,
  gateEnabled: false, // 会话门禁：独立于压缩开关
  pinLastUser: false,    // 会话区外观：最近一条"我的提问"钉在顶部
  clearBubble: false,    // 会话区外观：我的气泡背景透明（露出壁纸）
  pinBlur: 10,           // 会话区外观：钉顶底衬（圆角矩形毛玻璃）的模糊半径 px
  pinMaxVh: 38,          // 会话区外观：被钉气泡自身的最高高度（vh；超出的部分在气泡内滚）
  chatWidth: 860,        // 对话页：固定会话列宽 px（chatWidthEnabled 为真时生效）
  chatWidthEnabled: false, // 对话页：是否启用固定列宽（关 = 跟随 DSH 自适应）
})

/** 钉顶底衬模糊半径的取值区间（与 client 侧 clampBlur 同口径）。 */
export const PIN_BLUR_MIN = 0
export const PIN_BLUR_MAX = 24
/** 被钉气泡最高高度的取值区间，单位 vh（与 client 侧 clampPinMaxVh 同口径）。 */
export const PIN_MAX_VH_MIN = 12
export const PIN_MAX_VH_MAX = 80
/** 对话页固定宽度的取值区间（与 bg-atelier 时代一致：640–3840px）。 */
export const CHAT_WIDTH_MIN = 640
export const CHAT_WIDTH_MAX = 3840

export function sanitize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const enabled = src.enabled === true
  let triggerPct = Math.round(Number(src.triggerPct))
  if (!Number.isFinite(triggerPct)) triggerPct = DEFAULTS.triggerPct
  triggerPct = Math.min(95, Math.max(5, triggerPct))
  let retainPct = Math.round(Number(src.retainPct))
  if (!Number.isFinite(retainPct)) retainPct = DEFAULTS.retainPct
  retainPct = Math.min(triggerPct - 1, Math.max(1, retainPct))
  const auto = src.auto !== false
  const gateEnabled = src.gateEnabled === true
  const pinLastUser = src.pinLastUser === true
  const clearBubble = src.clearBubble === true
  let pinBlur = Math.round(Number(src.pinBlur) * 10) / 10   // 保留 1 位小数（1.3 / 1.5 这类微调档）
  if (!Number.isFinite(pinBlur)) pinBlur = DEFAULTS.pinBlur
  pinBlur = Math.min(PIN_BLUR_MAX, Math.max(PIN_BLUR_MIN, pinBlur))
  let pinMaxVh = Math.round(Number(src.pinMaxVh))
  if (!Number.isFinite(pinMaxVh) || pinMaxVh <= 0) pinMaxVh = DEFAULTS.pinMaxVh
  pinMaxVh = Math.min(PIN_MAX_VH_MAX, Math.max(PIN_MAX_VH_MIN, pinMaxVh))
  let chatWidth = Math.round(Number(src.chatWidth))
  if (!Number.isFinite(chatWidth) || chatWidth <= 0) chatWidth = DEFAULTS.chatWidth
  chatWidth = Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, chatWidth))
  const chatWidthEnabled = src.chatWidthEnabled === true
  return { enabled, triggerPct, retainPct, auto, gateEnabled, pinLastUser, clearBubble, pinBlur, pinMaxVh, chatWidth, chatWidthEnabled }
}

/** 由百分比换算成引擎字段与展示数字。 */
export function resolveValues(settings) {
  return {
    thresholdRatio: settings.triggerPct / 100,
    retainRatio: settings.retainPct / 100,
    auto: settings.auto,
    triggerTokens: Math.floor(ROUTED_CONTEXT_WINDOW * settings.triggerPct / 100),
    retainTokens: Math.floor(ROUTED_CONTEXT_WINDOW * settings.retainPct / 100),
  }
}

async function readSettings() {
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

function readSettingsSync() {
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
  await fs.writeFile(SETTINGS_FILE(), JSON.stringify(settings, null, 2), 'utf8')
  invalidateSettings()
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

const gateCache = { key: '', text: '' }

function loadGateSync() {
  const override = GATE_OVERRIDE_FILE()
  let target = override
  try {
    if (!existsSync(override)) target = GATE_BUILTIN_FILE
  } catch { target = GATE_BUILTIN_FILE }
  let st = null
  try { st = statSync(target) } catch { st = null }
  if (!st || !st.isFile()) {
    let builtin = ''
    try { builtin = readFileSync(GATE_BUILTIN_FILE, 'utf8') } catch { builtin = '' }
    gateCache.key = 'missing'
    gateCache.text = truncateBytes(sanitizeGateText(builtin), GATE_MAX_BYTES)
    return gateCache.text
  }
  const key = target + '|' + st.mtimeMs + '|' + st.size
  if (key !== gateCache.key) {
    let raw = ''
    try { raw = readFileSync(target, 'utf8') } catch { raw = '' }
    gateCache.key = key
    gateCache.text = truncateBytes(sanitizeGateText(raw), GATE_MAX_BYTES)
  }
  return gateCache.text
}

async function loadGate() {
  try { return loadGateSync() } catch { return '' }
}

function truncateBytes(text, max) {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= max) return text
  let cut = text.slice(0, max)
  while (Buffer.byteLength(cut, 'utf8') > max - 32) cut = cut.slice(0, Math.floor(cut.length * 0.9))
  // 只可能在尾部留下被切开的代理对半字符，剥掉它，避免 HTTP JSON 里出现替换字符。
  cut = cut.replace(/[\uD800-\uDFFF]$/, '')
  return cut + '\n\n[…规则文本超出字节上限，其余部分已省略]'
}

/** 注入形态：开关关 / 文本空 ⇒ 空串（renderPrompt 会丢掉空段）。 */
export function gatePromptText(settings) {
  if (!settings || settings.gateEnabled !== true) return ''
  return loadGateSync()
}

export async function gateMeta(settings) {
  const override = GATE_OVERRIDE_FILE()
  const usingOverride = existsSync(override)
  const sourcePath = usingOverride ? override : GATE_BUILTIN_FILE
  const text = await loadGate()
  const bytes = Buffer.byteLength(text, 'utf8')
  return {
    enabled: settings.gateEnabled === true,
    source: usingOverride ? 'override' : 'builtin',
    builtinPath: GATE_BUILTIN_FILE,
    overridePath: override,
    sourcePath,
    editablePath: override,
    bytes,
    maxBytes: GATE_MAX_BYTES,
    truncated: bytes >= GATE_MAX_BYTES,
    lines: text ? text.split('\n').length : 0,
    text,
  }
}

/** 写入 / 清除（text 为 null 或空串）规则 override。 */
export async function writeGateOverride(text) {
  await fs.mkdir(SETTINGS_DIR(), { recursive: true })
  const file = GATE_OVERRIDE_FILE()
  if (text === null || text === undefined || String(text).trim() === '') {
    try { await fs.unlink(file) } catch { /* 不存在即已回到内置 */ }
  } else {
    await fs.writeFile(file, String(text).replace(/\r\n/g, '\n').trim() + '\n', 'utf8')
  }
  gateCache.key = ''
  gateCache.text = ''
  return loadGate()
}

async function readComposition() {
  const file = await resolveStandardFile()
  return { file, text: await fs.readFile(file, 'utf8') }
}

/** 把当前设置写到 standard 组装文件（幂等：无变化则不写盘）。 */
export async function applyToStandard(settings) {
  const clean = sanitize(settings)
  const values = resolveValues(clean)
  const { file, text } = await readComposition()
  const next = clean.enabled ? spliceCompactionRow(text, values) : spliceCompactionRow(text, null)
  if (next === text) return { file, changed: false, ...values }
  await fs.writeFile(file, next, 'utf8')
  return { file, changed: true, ...values }
}

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
  const webServer = ctx.get('webServer')
  if (webServer === undefined) {
    console.error('[dsh-cache-control] webServer service unavailable, host half disabled')
    return
  }
  let gateSectionActive = false

  // 启动自检：与本机磁盘状态对账（例如 app 升级重置了组装文件之后）。
  try {
    // 先把「对话页固定宽度」从底图工坊搬过来（只在缺字段时读对方文件，见 migrateFromAtelier）。
    const moved = await migrateFromAtelier()
    if (moved) console.log('[dsh-cache-control] 对话页宽度已从 dsh-bg-atelier 迁入：' + JSON.stringify(moved))
    const current = await readSettings()
    const { text } = await readComposition()
    const wantsMarker = current.enabled
    const hasMarker = hasManagedMarker(text)
    if (wantsMarker !== hasMarker) await applyToStandard(current)
  } catch (err) {
    console.warn('[dsh-cache-control] boot reconcile skipped: ' + String((err && err.message) || err))
  }

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
          text: () => {
            try {
              return gatePromptText(readSettingsSync())
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

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: GET_PATH,
    handler: async (req, res) => {
      if (req.method === 'GET') {
        try {
          const settings = await readSettings()
          const values = resolveValues(settings)
          const { text } = await readComposition()
          const gate = await gateMeta(settings)
          send(res, 200, {
            settings,
            windowTokens: ROUTED_CONTEXT_WINDOW,
            triggerTokens: values.triggerTokens,
            retainTokens: values.retainTokens,
            applied: settings.enabled ? hasManagedMarker(text) : !hasManagedMarker(text),
            gate,
          })
        } catch (err) {
          send(res, 500, { ok: false, error: String((err && err.message) || err) })
        }
        return
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        try {
          const parsed = JSON.parse(await readBody(req))
          const settings = sanitize({ ...(await readSettings()), ...parsed })
          await writeSettings(settings)
          const result = await applyToStandard(settings)
          send(res, 200, { ok: true, changed: result.changed, ...resolveValues(settings), gateEnabled: settings.gateEnabled })
        } catch (err) {
          send(res, 400, { ok: false, error: String((err && err.message) || err) })
        }
        return
      }
      send(res, 405, { ok: false, error: 'method not allowed' })
    },
  }), 'dsh-cache-control: settings route')

  // ---- 门禁规则文本：GET 读当前生效文本，PUT 写入或清除 override ----
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: GATE_PATH,
    handler: async (req, res) => {
      if (req.method === 'GET') {
        try {
          send(res, 200, { ok: true, gate: await gateMeta(await readSettings()) })
        } catch (err) {
          send(res, 500, { ok: false, error: String((err && err.message) || err) })
        }
        return
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        try {
          const parsed = JSON.parse(await readBody(req))
          const text = await writeGateOverride(parsed && parsed.text)
          const settings = await readSettings()
          send(res, 200, {
            ok: true,
            bytes: Buffer.byteLength(text, 'utf8'),
            lines: text ? text.split('\n').length : 0,
            source: existsSync(GATE_OVERRIDE_FILE()) ? 'override' : 'builtin',
            enabled: settings.gateEnabled === true,
          })
        } catch (err) {
          send(res, 400, { ok: false, error: String((err && err.message) || err) })
        }
        return
      }
      send(res, 405, { ok: false, error: 'method not allowed' })
    },
  }), 'dsh-cache-control: gate route')

  const settings = await readSettings()
  const gateText = await loadGate()
  console.log('[dsh-cache-control] host up (' + GET_PATH + ', ' + GATE_PATH + ')'
    + ' enabled=' + settings.enabled
    + ' gate=' + settings.gateEnabled
    + ' gateSection=' + (gateSectionActive ? 'mounted' : 'absent')
    + ' gateBytes=' + Buffer.byteLength(gateText, 'utf8'))
}
