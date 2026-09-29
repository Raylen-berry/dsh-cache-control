import { promises as fs, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export const RULE_KEYS = ['gate', 'ponytail', 'shape']
export const RULE_LABELS = { gate: '会话守则', ponytail: 'ponytail', shape: '输出形状' }
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const validSession = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !['__proto__', 'constructor', 'prototype'].includes(value) && !/[\x00-\x1f]/.test(value)
const fail = message => { throw new Error(message) }

/** Conservative text heuristics, never edits or sends rule text to a model. */
export function analyzeRules(rules) {
  const seen = new Map(), warnings = [], rows = [], styles = { concise: [], detailed: [] }
  let bytes = 0
  for (const key of RULE_KEYS) {
    const rule = rules?.[key] || {}, text = String(rule.text || '')
    const size = Buffer.byteLength(text)
    rows.push({ key, bytes: size, enabled: rule.enabled !== false })
    if (rule.enabled === false) continue
    bytes += size
    let code = false
    text.split(/\r?\n/).forEach((line, index) => {
      if (/^\s*(```|~~~)/.test(line)) { code = !code; return }
      if (code) return
      const normalized = line.trim().replace(/^[-*#\d.、)\s]+/, '').replace(/\s+/g, ' ').toLowerCase()
      if (normalized.length < 12) return
      const ref = { key, line: index + 1, excerpt: line.trim().slice(0, 120) }
      if (seen.has(normalized) && warnings.length < 12) warnings.push({ kind: 'duplicate', message: '疑似重复要求', refs: [seen.get(normalized), ref] })
      else seen.set(normalized, ref)
      // Negative instructions and mixed instructions are deliberately skipped.
      if (/(不要|不必|无需|避免|禁止).{0,5}(简短|简洁|详细|展开)/.test(line)) return
      const concise = /尽量简短|尽可能简短|保持简洁|只给结论|回答.{0,3}简短/.test(line)
      const detailed = /充分展开|详细解释|尽可能详细|完整展开|逐步详细/.test(line)
      if (concise && !detailed) styles.concise.push(ref)
      if (detailed && !concise) styles.detailed.push(ref)
    })
  }
  if (styles.concise.length && styles.detailed.length) warnings.push({ kind: 'conflict', message: '可能存在篇幅要求冲突：简短与详细展开', refs: [styles.concise[0], styles.detailed[0]] })
  return { bytes, tokenEstimate: { min: Math.ceil(bytes / 4), max: Math.ceil(bytes / 1.5) }, rows, warnings,
    note: 'token 为按文本体积粗估的范围，不是实测或计费值；提示只匹配常见表达，可能误报或漏报。' }
}

/** Exact changed block after removing equal leading/trailing lines. Bounded output. */
export function ruleDiff(before, after) {
  const a = String(before || '').split('\n'), b = String(after || '').split('\n')
  let start = 0, endA = a.length, endB = b.length
  while (start < endA && start < endB && a[start] === b[start]) start++
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  return { startLine: start + 1, removed: a.slice(start, endA).join('\n'), added: b.slice(start, endB).join('\n'), changed: endA !== start || endB !== start }
}

export async function atomicText(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = file + '.' + randomUUID() + '.tmp'
  try { await fs.writeFile(temp, text, { flag: 'wx', encoding: 'utf8' }); await fs.rename(temp, file) }
  finally { await fs.rm(temp, { force: true }).catch(() => {}) }
}
async function optionalText(file) {
  try { return await fs.readFile(file, 'utf8') } catch (e) { if (e.code === 'ENOENT') return null; throw e }
}

/** Presets and per-session overrides have one atomic document. Legacy .md files
 * remain authoritative for global rules; multi-file preset updates use a journal. */
export function createPolicyManager(a) {
  const dir = () => path.join(a.home(), 'dsh-cache-control')
  const stateFile = () => path.join(dir(), 'policy.json')
  const journalFile = () => path.join(dir(), 'policy-transaction.json')
  let memo = { key: '', value: null }, probeAttached = false
  const evidence = new Map()
  const empty = () => ({ version: 1, revision: 0, presets: [], sessions: {} })
  function state() {
    const file = stateFile()
    let st
    try { st = statSync(file) } catch (e) { if (e.code === 'ENOENT') return empty(); throw e }
    const key = file + '|' + st.mtimeMs + '|' + st.size
    if (key !== memo.key) {
      const value = JSON.parse(readFileSync(file, 'utf8'))
      if (value.version !== 1 || !Array.isArray(value.presets) || !object(value.sessions)) fail('策略文件格式异常，请保留文件并检查备份')
      memo = { key, value }
    }
    return memo.value
  }
  async function saveState(next) {
    next.revision = (next.revision || 0) + 1
    await atomicText(stateFile(), JSON.stringify(next, null, 2)); memo.key = ''
  }
  function sessionId(context) {
    const id = context?.agent?.session?.id || context?.scope?.session?.id
    return validSession(id) ? id : null
  }
  function effective(settings, id) {
    const override = validSession(id) ? state().sessions[id]?.rules : null
    return { ...settings, ...Object.fromEntries(RULE_KEYS.filter(key => typeof override?.[key]?.enabled === 'boolean').map(key => [key + 'Enabled', override[key].enabled])) }
  }
  function sessionRule(key, context) {
    const id = sessionId(context)
    const rule = id ? state().sessions[id]?.rules?.[key] : null
    return rule && typeof rule.text === 'string' ? rule.text : null
  }
  async function rawSnapshot() {
    const frozen = a.getFrozen?.()
    if (frozen) return structuredClone(frozen)
    const settings = await a.readSettings(), rules = {}
    for (const key of RULE_KEYS) {
      const raw = await optionalText(a.files[key].override())
      const text = raw === null ? await fs.readFile(a.files[key].builtin, 'utf8') : raw
      rules[key] = { enabled: settings[key + 'Enabled'] === true, text, override: raw }
    }
    return { settings, rules }
  }
  function builtins() {
    const values = [['builtin:daily', '日常聊天', [false, false, true]], ['builtin:code', '写代码', [true, true, true]], ['builtin:analysis', '深入分析', [true, false, true]]]
    return values.map(([id, name, flags]) => ({ id, name, builtin: true, rules: Object.fromEntries(RULE_KEYS.map((key, i) => [key, {
      enabled: flags[i], text: readFileSync(a.files[key].builtin, 'utf8'), override: null,
    }])) }))
  }
  function preset(id) { return [...builtins(), ...state().presets].find(p => p.id === id) || fail('预设不存在，请刷新后重试') }
  function checkName(name) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 40) fail('预设名称需要 1–40 个字符')
    return name.trim()
  }
  async function current(id) {
    const snap = await rawSnapshot(), override = validSession(id) ? state().sessions[id]?.rules : null
    for (const key of RULE_KEYS) if (override?.[key]) Object.assign(snap.rules[key], override[key])
    return snap
  }
  function checkScope(scope, id) {
    if (scope !== 'global' && scope !== 'session') fail('请指定全局或当前会话')
    if (scope === 'session' && !validSession(id)) fail('当前没有可用会话，请先打开一个会话')
  }
  async function preview(id, scope, sid) {
    checkScope(scope, sid)
    const p = preset(id), before = await current(scope === 'session' ? sid : null)
    const changes = RULE_KEYS.map(key => ({ key, label: RULE_LABELS[key], before: before.rules[key].enabled, after: p.rules[key].enabled,
      diff: ruleDiff(before.rules[key].text, p.rules[key].text) }))
    const revision = digest({ state: state().revision, rules: before.rules, preset: p })
    return { id, name: p.name, scope, sessionId: scope === 'session' ? sid : null, changes, revision }
  }
  async function recordHistory(key, reason = '编辑规则') {
    if (!RULE_KEYS.includes(key)) fail('未知规则')
    const raw = await optionalText(a.files[key].override())
    const text = raw === null ? await fs.readFile(a.files[key].builtin, 'utf8') : raw
    const item = { id: Date.now() + '-' + randomUUID(), at: Date.now(), reason, source: raw === null ? 'builtin' : 'override', text }
    await atomicText(path.join(dir(), 'history', key, item.id + '.json'), JSON.stringify(item))
    return item
  }
  async function history(key, id) {
    if (!RULE_KEYS.includes(key)) fail('未知规则')
    const folder = path.join(dir(), 'history', key)
    if (id !== undefined) {
      if (!/^\d+-[a-f0-9-]{36}$/.test(id)) fail('无效历史版本')
      const item = JSON.parse(await fs.readFile(path.join(folder, id + '.json'), 'utf8'))
      const snap = await rawSnapshot()
      return { ...item, diff: ruleDiff(snap.rules[key].text, item.text) }
    }
    let files
    try { files = await fs.readdir(folder) } catch (e) { if (e.code === 'ENOENT') return []; throw e }
    const records = await Promise.all(files.filter(f => /^\d+-[a-f0-9-]{36}\.json$/.test(f)).sort().reverse().slice(0, 50).map(async file => {
      const item = JSON.parse(await fs.readFile(path.join(folder, file), 'utf8'))
      return { id: item.id, at: item.at, reason: item.reason, source: item.source, bytes: Buffer.byteLength(item.text) }
    }))
    return records
  }
  async function writeRaw(key, value) {
    if (value === null) await fs.rm(a.files[key].override(), { force: true })
    else await atomicText(a.files[key].override(), value)
    a.invalidateRule(key)
  }
  async function writeRule(key, value, reason = '编辑规则') {
    return a.mutate(async () => {
      const next = value == null || !String(value).trim() ? null : String(value).replace(/\r\n/g, '\n').trim() + '\n'
      if (await optionalText(a.files[key].override()) === next) return
      await recordHistory(key, next === null ? '回到内置规则' : reason)
      await writeRaw(key, next)
    })
  }
  async function restoreJournal(journal) {
    // Targets are fixed by this module, never supplied by the journal.
    if (!object(journal?.settings) || !object(journal?.rules) || RULE_KEYS.some(k => journal.rules[k]?.override !== null && typeof journal.rules[k]?.override !== 'string')) fail('规则事务记录异常，请保留原文件')
    await a.writeSettings(journal.settings)
    for (const key of RULE_KEYS) await writeRaw(key, journal.rules[key].override)
    await fs.rm(journalFile(), { force: true })
  }
  async function recover() {
    const raw = await optionalText(journalFile())
    if (raw !== null) await restoreJournal(JSON.parse(raw))
  }
  async function applyPreset(body) {
    const checked = await preview(body.id, body.scope, body.sessionId)
    if (!body.revision || checked.revision !== body.revision) fail('规则或预设已有变化，请重新预览后应用')
    const p = preset(body.id)
    if (body.scope === 'session') {
      const next = structuredClone(state())
      if (!next.sessions[body.sessionId] && Object.keys(next.sessions).length >= 300) fail('会话独立设置已达 300 项，请先将旧会话恢复跟随全局')
      next.sessions[body.sessionId] = { at: Date.now(), rules: Object.fromEntries(RULE_KEYS.map(key => [key, { enabled: p.rules[key].enabled, text: p.rules[key].text }])) }
      await saveState(next)
    } else {
      const before = await rawSnapshot()
      for (const key of RULE_KEYS) if (before.rules[key].override !== p.rules[key].override) await recordHistory(key, '应用预设：' + p.name)
      await atomicText(journalFile(), JSON.stringify(before))
      a.freeze(before)
      try {
        for (const key of RULE_KEYS) await writeRaw(key, p.rules[key].override)
        await a.writeSettings({ ...before.settings, ...Object.fromEntries(RULE_KEYS.map(key => [key + 'Enabled', p.rules[key].enabled])) })
        await fs.rm(journalFile(), { force: true })
      } catch (error) { await restoreJournal(before); throw error }
      finally { a.freeze(null) }
    }
  }
  async function view(id) {
    const s = state(), snap = await current(id)
    const expected = a.expectedRules(id)
    for (const key of RULE_KEYS) snap.rules[key].injectedBytes = Buffer.byteLength(expected[key])
    return { version: '1.16.0', revision: s.revision,
      presets: [...builtins(), ...s.presets].map(p => ({ id: p.id, name: p.name, builtin: !!p.builtin, at: p.at })),
      session: validSession(id) ? { id, overrides: s.sessions[id]?.rules || {}, effective: snap.rules } : null }
  }
  async function action(body) {
    return a.mutate(async () => {
      const next = structuredClone(state())
      if (body.action === 'create') {
        if (next.presets.length >= 40) fail('最多保存 40 个自定义预设')
        checkScope(body.scope, body.sessionId)
        const name = checkName(body.name)
        if ([...builtins(), ...next.presets].some(p => p.name === name)) fail('已有同名预设，请换一个名字')
        const snap = await current(body.scope === 'session' ? body.sessionId : null)
        const rules = Object.fromEntries(RULE_KEYS.map(key => [key, { ...snap.rules[key], override: snap.rules[key].text }]))
        if (RULE_KEYS.some(key => Buffer.byteLength(rules[key].text) > 65536)) fail('单段规则超过 64 KB，请先精简后再保存预设')
        next.presets.push({ id: randomUUID(), name, at: Date.now(), rules })
        await saveState(next)
      } else if (body.action === 'rename' || body.action === 'delete') {
        const i = next.presets.findIndex(p => p.id === body.id)
        if (i < 0) fail('仅自定义预设可修改')
        if (body.action === 'delete') next.presets.splice(i, 1)
        else {
          const name = checkName(body.name)
          if ([...builtins(), ...next.presets].some(p => p.name === name && p.id !== body.id)) fail('已有同名预设')
          next.presets[i].name = name
        }
        await saveState(next)
      } else if (body.action === 'apply') await applyPreset(body)
      else if (body.action === 'session') {
        if (!validSession(body.sessionId)) fail('无效会话')
        if (body.reset === true) delete next.sessions[body.sessionId]
        else {
          if (!RULE_KEYS.includes(body.key) || ![true, false, null].includes(body.enabled)) fail('会话开关值无效')
          if (!next.sessions[body.sessionId] && Object.keys(next.sessions).length >= 300) fail('会话独立设置已达上限')
          const entry = next.sessions[body.sessionId] || { rules: {} }
          if (body.enabled === null) delete entry.rules[body.key]
          else entry.rules[body.key] = { ...(entry.rules[body.key] || {}), enabled: body.enabled }
          entry.at = Date.now()
          if (Object.keys(entry.rules).length) next.sessions[body.sessionId] = entry
          else delete next.sessions[body.sessionId]
        }
        await saveState(next)
      } else fail('未知策略操作')
      return view(body.sessionId)
    })
  }
  async function restore(key, id) {
    const item = await history(key, id)
    // Store the exact historic text as an override: package updates must not
    // silently change what "restore this version" means.
    await writeRule(key, item.text, '恢复历史版本')
  }
  function signature(id) {
    return digest(a.expectedRules(id))
  }
  function observe(options) {
    if (options?.purpose || !validSession(options?.sessionId)) return
    const id = options.sessionId, expected = a.expectedRules(id), texts = []
    if (typeof options.system === 'string') texts.push(options.system)
    for (const msg of options.messages || []) if (msg.role === 'system') {
      if (typeof msg.content === 'string') texts.push(msg.content)
      else if (Array.isArray(msg.content)) for (const part of msg.content) if (part.type === 'text' && typeof part.text === 'string') texts.push(part.text)
    }
    const prompt = texts.join('\n\n')
    const result = { at: Date.now(), sessionId: id, signature: digest(expected), rules: Object.fromEntries(RULE_KEYS.map(key => [key, {
      bytes: Buffer.byteLength(expected[key]), status: !expected[key] ? 'off' : prompt.includes(expected[key]) ? 'present' : 'missing',
    }])) }
    evidence.delete(id); evidence.set(id, result)
    if (evidence.size > 100) evidence.delete(evidence.keys().next().value)
  }
  function diagnostics(id, mounted) {
    const previous = validSession(id) ? evidence.get(id) : null
    const expected = a.expectedRules(id)
    return { version: '1.16.0', loaded: true, mounted, requestProbe: probeAttached,
      sessionId: validSession(id) ? id : null,
      lastRequest: previous ? { ...previous, current: previous.signature === signature(id) } : null,
      configured: Object.fromEntries(RULE_KEYS.map(key => [key, { bytes: Buffer.byteLength(expected[key]) }])) }
  }
  return { state, effective, sessionId, sessionRule, view, preview, action, history, writeRule, restore, recover, observe, diagnostics,
    attachProbe() { probeAttached = true } }
}
