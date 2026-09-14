// 省缓存插件 host 半的离线回归：新字段清洗 + 「对话页固定宽度」从底图工坊的一次性迁移。
// 关键前提：所有路径都经 dshHome()（读 process.env.DSH_HOME），所以把 DSH_HOME 指到
// 临时目录就能在真机配置之外跑完整逻辑 —— 绝不碰 AppData 里那份真 settings.json。
//
// v1.5.0：对话页宽度单位从 **px 变百分比**（30–100）。盘上的旧 px 值（>100，例如 900/1920/3840）
// 不再按 px 使用，一律落到默认 80%（约等于本机 1139px 会话区里 900px 的观感）。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-host-'))
process.env.DSH_HOME = HOME
const MOD = process.env.DSH_CC_INDEX || 'D:/DeepSeek/dsh-plugins/dsh-cache-control/index.js'
const m = await import('file:///' + MOD + '?t' + Date.now())

let bad = 0
const t = (name, cond, extra) => { if (cond) { console.log('  PASS  ' + name) } else { bad++; console.log('  FAIL  ' + name + '  [' + extra + ']') } }
const J = (o) => JSON.stringify(o)

// ---- 1. sanitize：三个新字段都要有区间钳制与默认值兜底 ----
console.log('— sanitize 新字段 —')
const d = m.sanitize({})
t('默认值：pinBlur=10 / chatWidth=80(%) / chatWidthEnabled=false',
  d.pinBlur === 10 && d.chatWidth === 80 && d.chatWidthEnabled === false, J(d))
t('pinBlur 上钳到 24', m.sanitize({ pinBlur: 999 }).pinBlur === 24, J(m.sanitize({ pinBlur: 999 })))
t('pinBlur 下钳到 0（0 = 合法值，不能被当缺省）', m.sanitize({ pinBlur: 0 }).pinBlur === 0, J(m.sanitize({ pinBlur: 0 })))
t('pinBlur 非数字退回默认', m.sanitize({ pinBlur: 'x' }).pinBlur === 10, J(m.sanitize({ pinBlur: 'x' })))
t('chatWidth(%) 区间内原样通过：60 → 60', m.sanitize({ chatWidth: 60 }).chatWidth === 60, J(m.sanitize({ chatWidth: 60 })))
t('chatWidth 下钳到 30', m.sanitize({ chatWidth: 10 }).chatWidth === 30, J(m.sanitize({ chatWidth: 10 })))
t('chatWidth 旧 px 值（900 / 3840）落到默认 80，而不是被当成 900%/3840%',
  m.sanitize({ chatWidth: 900 }).chatWidth === 80 && m.sanitize({ chatWidth: 3840 }).chatWidth === 80,
  m.sanitize({ chatWidth: 900 }).chatWidth + ' / ' + m.sanitize({ chatWidth: 3840 }).chatWidth)
t('chatWidthEnabled 只认 true', m.sanitize({ chatWidthEnabled: 'yes' }).chatWidthEnabled === false, J(m.sanitize({ chatWidthEnabled: 'yes' })))
// 老配置（无新字段）过一遍 sanitize：新字段必须补齐 ⇒ 旧 host 写过的盘不会被"缺字段"卡住
const legacy = m.sanitize({ enabled: true, triggerPct: 30, retainPct: 4, auto: true, gateEnabled: true, pinLastUser: true, clearBubble: true })
t('旧 settings.json 形态过 sanitize 后新字段齐全',
  legacy.pinBlur === 10 && legacy.chatWidth === 80 && legacy.chatWidthEnabled === false, J(legacy))

// ---- 2. 迁移：只在自家缺字段时读对方的文件 ----
console.log('— migrateFromAtelier —')
const ccDir = path.join(HOME, 'dsh-cache-control')
const ccFile = path.join(ccDir, 'settings.json')
const bgaDir = path.join(HOME, 'dsh-bg-atelier')
fs.mkdirSync(bgaDir, { recursive: true })
// 底图工坊时代存的是 px（1920）—— 迁移时必须换成百分比，这是 v1.5.0 的关键回归点
fs.writeFileSync(path.join(bgaDir, 'settings.json'), JSON.stringify({
  effect: 'firefly', chatWidth: 1920, chatWidthEnabled: true,
}), 'utf8')

const first = await m.migrateFromAtelier()
t('首次启动：把底图工坊的旧 px 1920 迁成 80%', !!first && first.chatWidth === 80 && first.chatWidthEnabled === true, J(first))
const onDisk = JSON.parse(fs.readFileSync(ccFile, 'utf8'))
t('迁移结果已写盘（写的是 sanitize 后的完整形状，新字段带上）',
  onDisk.chatWidth === 80 && onDisk.chatWidthEnabled === true
  && onDisk.pinBlur === 10 && onDisk.enabled === false && onDisk.auto === true, J(onDisk))
// 自家已有配置时：除新字段外一律原样保留（这是真机场景：那边已存着 30/4 的压缩参数）
fs.writeFileSync(ccFile, JSON.stringify({ enabled: true, triggerPct: 30, retainPct: 4, auto: true, gateEnabled: true, pinLastUser: true, clearBubble: true }), 'utf8')
const real = await m.migrateFromAtelier()
const realDisk = JSON.parse(fs.readFileSync(ccFile, 'utf8'))
t('真机形态：自家压缩/门禁参数原样保留，只补对话页宽度（旧 px → 80%）',
  !!real && realDisk.enabled === true && realDisk.triggerPct === 30 && realDisk.retainPct === 4
  && realDisk.gateEnabled === true && realDisk.pinLastUser === true && realDisk.clearBubble === true
  && realDisk.chatWidth === 80 && realDisk.chatWidthEnabled === true && realDisk.pinBlur === 10, J(realDisk))
const second = await m.migrateFromAtelier()
t('第二次启动：自家已带字段 ⇒ 不再读对方文件（返回 null）', second === null, J(second))
// 改盘后再跑：自家有值即为准，不能被底图工坊的旧值盖回去（这里改成百分比 90 更贴新语义）
fs.writeFileSync(ccFile, JSON.stringify(Object.assign({}, onDisk, { chatWidth: 90 })), 'utf8')
t('用户改过数值后，底图工坊的旧值不会覆盖', await m.migrateFromAtelier() === null, '')
// 底图工坊没有这两个字段时：什么都不做。
// 注意：**不要用"删掉文件再看它不存在"来判**——本机的沙箱会把 fs.rmSync 拦成空操作
// （实测：rmSync 之后 existsSync 仍为 true），那样写会假失败。改成先放一份**哨兵文件**，
// 跑完看它有没有被改写：这才直接证明"不写盘"，也不依赖删除能不能生效。
fs.writeFileSync(ccFile, JSON.stringify({ sentinel: 'must-not-be-overwritten' }), 'utf8')
fs.writeFileSync(path.join(bgaDir, 'settings.json'), JSON.stringify({ effect: 'off' }), 'utf8')
const noFields = await m.migrateFromAtelier()
const sentinelAfter = JSON.parse(fs.readFileSync(ccFile, 'utf8'))
t('底图工坊没这两个字段 ⇒ 不迁移、不写盘（哨兵文件原样未动）',
  noFields === null && sentinelAfter.sentinel === 'must-not-be-overwritten',
  J({ ret: noFields, fileAfter: sentinelAfter }))
// 底图工坊整个不在
fs.rmSync(bgaDir, { recursive: true, force: true })
t('底图工坊配置文件不存在 ⇒ 静默跳过', await m.migrateFromAtelier() === null, '')
// 自家文件是坏 JSON
fs.mkdirSync(ccDir, { recursive: true })
fs.writeFileSync(ccFile, '{ broken', 'utf8')
fs.mkdirSync(bgaDir, { recursive: true })
fs.writeFileSync(path.join(bgaDir, 'settings.json'), JSON.stringify({ chatWidth: 1600, chatWidthEnabled: true }), 'utf8')
const afterBroken = await m.migrateFromAtelier()
t('自家 settings.json 坏了也能重建并完成迁移（旧 px 1600 → 80%）', !!afterBroken && afterBroken.chatWidth === 80, J(afterBroken))

// --- 3. 破坏性配置缺陷回归（v1.6.1）---------------------------------------
// 缺陷：保存入口（PUT/POST /cc/settings.json）无条件 applyToStandard，而 applyToStandard
// 在 enabled=false 时 spliceCompactionRow(text, null) —— 于是**只改外观开关**（钉顶/气泡/
// 宽度/拖拽条）也会重写 standard 组装文件，把用户自己那份压缩配置抹掉。
// 修法：① 只有压缩字段（enabled/triggerPct/retainPct/auto）变化才碰那个文件；
//       ② 首次接管前把**原文**存进 settings.json.compactionBackup，关闭时还原它；
//       ③ 幂等：无变化不写盘（保留 next === text 早退）。
// 这一节走真 HTTP 路由（假 cordis ctx + 真的 node:http），DSH_HOME 依旧指临时目录 ——
// 绝不动 %APPDATA% 下那份真实 settings.json 与真实 preset。
console.log('— 压缩配置不再被外观保存破坏（v1.6.1）—')
const http = await import('node:http')
const crypto = await import('node:crypto')
const setHome = path.join(HOME, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets', 'standard', 'agent.cordis.yml')

// 用户自己的 preset：压缩配置是他手写的 0.66/0.11，并且带着一句自己的注释。
// 行块按真实文件的形状嵌在 items: 列表里（前面 6 空格，属性 8 空格），
// 所以不能让 fixture 对缩进有任何"恰好如此"的假设。
const USER_PRESET = [
  'realm:',
  '  - id: compaction',
  '    group: true',
  '    items:',
  '      - id: compaction-basic',
  "        name: '@deepseek-ai/dsh-compaction-basic'",
  '        # 用户自己写的说明：这一行别动',
  '        config:',
  '          thresholdRatio: 0.66',
  '          retainRatio: 0.11',
  '      - id: next-row',
  "        name: '@deepseek-ai/dsh-next'",
  '',
  '- id: tail',
  '  name: x',
  '',
].join('\n')
fs.mkdirSync(path.dirname(setHome), { recursive: true })
fs.writeFileSync(setHome, USER_PRESET, 'utf8')
const homeOf = () => crypto.createHash('sha256').update(fs.readFileSync(setHome)).digest('hex')
const H0 = homeOf()

const routes = new Map()
const webServer = { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }
const ctx = {
  get: (n) => (n === 'webServer' ? webServer : undefined),
  effect: (fn) => fn(),
  inject: (deps, cb) => { cb({ systemPrompt: { section: () => () => {} } }) },
}
await m.apply(ctx)
const server = http.createServer((req, res) => {
  const h = routes.get((req.url || '').split('?')[0])
  if (!h) { res.writeHead(404); res.end('{}'); return }
  h(req, res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port
const getJ = async (p) => { const r = await fetch(base + p, { cache: 'no-store' }); return { status: r.status, body: await r.json() } }
const putJ = async (p, obj) => {
  const r = await fetch(base + p, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) })
  return { status: r.status, body: await r.json() }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ① 只改外观字段 ⇒ standard 文件逐字节不变（哈希比对）
const appearance = { pinLastUser: true, clearBubble: true, pinBlur: 3.5, pinMaxVh: 44, chatWidth: 72, chatWidthEnabled: true, hideResizer: true, hideDivider: true }
const a1 = await putJ('/cc/settings.json', appearance)
const H1 = homeOf()
t('① 只改外观（8 个字段一次提交）⇒ standard 文件哈希不变',
  a1.status === 200 && a1.body.ok === true && H1 === H0, 'H0=' + H0.slice(0, 12) + ' H1=' + H1.slice(0, 12))
t('① 响应标明这次保存没碰组装文件', a1.body.touched === false && a1.body.changed === false, J({ touched: a1.body.touched, changed: a1.body.changed }))
t('① 只改外观时不该凭空造出备份（还没接管过）', (await getJ('/cc/settings.json')).body.hasBackup === false, J((await getJ('/cc/settings.json')).body.hasBackup))
t('① 用户原有的压缩配置仍在文件里（0.66 / 0.11 一个字没动）',
  fs.readFileSync(setHome, 'utf8').includes('thresholdRatio: 0.66') && fs.readFileSync(setHome, 'utf8').includes('retainRatio: 0.11'))

// ② 改压缩字段 ⇒ 确实被改，且顺手存下接管前的原文
const c1 = await putJ('/cc/settings.json', { enabled: true, triggerPct: 30, retainPct: 4, auto: true })
const H2 = homeOf()
const text2 = fs.readFileSync(setHome, 'utf8')
t('② 改压缩字段 ⇒ standard 文件被改（哈希变了）', c1.body.touched === true && c1.body.changed === true && H2 !== H1, 'H1=' + H1.slice(0, 12) + ' H2=' + H2.slice(0, 12))
t('② 受管 config 已写入（0.30 / 0.04 / auto）',
  /thresholdRatio: 0\.30/.test(text2) && /retainRatio: 0\.04/.test(text2) && /auto: true/.test(text2))
t('② 用户手写的那句注释没被顺手删掉', text2.includes('# 用户自己写的说明：这一行别动'))
t('② 旧 config 是被替换而不是又追加一份（thresholdRatio 只出现一次）',
  text2.split('thresholdRatio').length - 1 === 1, 'count=' + (text2.split('thresholdRatio').length - 1))
t('② 接管前的原文已存成备份（settings.json.compactionBackup.text === 原文件）',
  (() => { const s = JSON.parse(fs.readFileSync(ccFile, 'utf8')); return s.compactionBackup && typeof s.compactionBackup.at === 'number' && s.compactionBackup.text === USER_PRESET })(),
  J(Object.keys(JSON.parse(fs.readFileSync(ccFile, 'utf8')))))
const gBackup = await getJ('/cc/settings.json')
t('② GET hasBackup=true 且 backupAt 是数字',
  gBackup.body.hasBackup === true && typeof gBackup.body.backupAt === 'number', J({ hasBackup: gBackup.body.hasBackup, backupAt: gBackup.body.backupAt }))

// ③ 重复保存同一份设置 ⇒ 不产生第二次写盘
const mtimeAt = (fs.statSync(setHome).mtimeMs)
await sleep(60)
const r2 = await putJ('/cc/settings.json', { enabled: true, triggerPct: 30, retainPct: 4, auto: true })
const H3 = homeOf()
t('③ 重复保存同一份压缩设置 ⇒ changed=false 且文件哈希、mtime 都没动',
  r2.body.ok === true && r2.body.changed === false && H3 === H2 && fs.statSync(setHome).mtimeMs === mtimeAt,
  'changed=' + r2.body.changed + ' mtime same=' + (fs.statSync(setHome).mtimeMs === mtimeAt))
const mtimeAt2 = fs.statSync(setHome).mtimeMs
await putJ('/cc/settings.json', appearance)
t('③ 改完压缩再改一遍外观 ⇒ standard 文件仍然没被碰（哈希+mtime 都不动）',
  homeOf() === H2 && fs.statSync(setHome).mtimeMs === mtimeAt2, 'H=' + homeOf().slice(0, 12))

// ④ 关闭省缓存 ⇒ 用户原有压缩行被**还原**（不是消失）
const d1 = await putJ('/cc/settings.json', { enabled: false })
const H4 = homeOf()
t('④ 关闭省缓存 ⇒ standard 文件被还原（哈希回到接管前 H0）', d1.body.ok === true && d1.body.changed === true && H4 === H0, 'H0=' + H0.slice(0, 12) + ' H4=' + H4.slice(0, 12))
t('④ 还原是逐字节的（文件内容 === 接管前原文）', fs.readFileSync(setHome, 'utf8') === USER_PRESET)
t('④ 用户原有的 0.66 / 0.11 回来了（不是"没有 config"）',
  fs.readFileSync(setHome, 'utf8').includes('thresholdRatio: 0.66') && fs.readFileSync(setHome, 'utf8').includes('retainRatio: 0.11'))
t('④ 插件受管标记已撤走', !m.hasManagedMarker(fs.readFileSync(setHome, 'utf8')))
const gAfterOff = await getJ('/cc/settings.json')
t('④ 还原后备份被清掉（hasBackup=false / backupAt=null）',
  gAfterOff.body.hasBackup === false && gAfterOff.body.backupAt === null, J({ hasBackup: gAfterOff.body.hasBackup, backupAt: gAfterOff.body.backupAt }))
const off2 = await putJ('/cc/settings.json', { enabled: false })
t('④ 再关一次 ⇒ changed=false（还原只写一次）', off2.body.changed === false, 'changed=' + off2.body.changed)

// ④b 回落：没有备份可还原时，仍走旧的"摘掉受管行"，且不伤用户其它内容。
// 造盘面要经它自己的 API：先关一次把备份用掉（备份必须被清掉），再重置文件、打开（此刻
// 文件里没有受管行 ⇒ 会重新采一份备份），再关一次 —— 那一次就是"有标记但备份已用掉"的路径。
await putJ('/cc/settings.json', { enabled: false })
const noBackup = await getJ('/cc/settings.json')
t('④b 备份用掉后盘上是 null（不是留着一份旧的、会在下次启动被误用）',
  noBackup.body.hasBackup === false && (JSON.parse(fs.readFileSync(ccFile, 'utf8')).compactionBackup || null) === null,
  J(JSON.parse(fs.readFileSync(ccFile, 'utf8')).compactionBackup))
fs.writeFileSync(setHome, USER_PRESET, 'utf8')            // 用户手工把文件改回原样
await putJ('/cc/settings.json', { enabled: true, triggerPct: 30, retainPct: 4, auto: true })
fs.writeFileSync(setHome, USER_PRESET, 'utf8')            // 文件被重置（模拟 app 升级覆盖），备份改不动 ⇒ 仍是"接管前"那份
const fb = await putJ('/cc/settings.json', { enabled: false })
const fbText = fs.readFileSync(setHome, 'utf8')
t('④b 被重置的文件 + 仍有备份 ⇒ 还原，而不是删掉用户的 config',
  fb.body.ok === true && fbText === USER_PRESET, 'H=' + homeOf().slice(0, 12))
t('④b 干净盘面上再开一次（重新采备份）后关闭 ⇒ 摘掉受管 config 且不留标记',
  await (async () => {
    await putJ('/cc/settings.json', { enabled: true, triggerPct: 55, retainPct: 7, auto: true })
    const hasB = (await getJ('/cc/settings.json')).body.hasBackup === true
    const r = await putJ('/cc/settings.json', { enabled: false })
    const txt = fs.readFileSync(setHome, 'utf8')
    return hasB && r.body.changed === true && txt === USER_PRESET
  })(), '')
t('④b 关闭后文件里没有受管标记、也没有插件写过的 config',
  !m.hasManagedMarker(fs.readFileSync(setHome, 'utf8')) && !/thresholdRatio: 0\.55/.test(fs.readFileSync(setHome, 'utf8')),
  fs.readFileSync(setHome, 'utf8').slice(0, 80).replace(/\n/g, '|'))
t('④b 回落路径同样不删用户自己的注释', fbText.includes('# 用户自己写的说明：这一行别动'))

server.close()

// --- 4. 启动对账也受同一套备份/还原语义约束 ------------------------------
// （另起一个临时 HOME：换模块实例时模块级 memo 不会把上一份盘缓存带过来）
console.log('— 启动对账（apps 升级重置组装文件后）—')
const HOME2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-boot-'))
const setHome2 = path.join(HOME2, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets', 'standard', 'agent.cordis.yml')
fs.mkdirSync(path.dirname(setHome2), { recursive: true })
fs.mkdirSync(path.join(HOME2, 'dsh-cache-control'), { recursive: true })
fs.writeFileSync(path.join(HOME2, 'dsh-cache-control', 'settings.json'), JSON.stringify({ enabled: true, triggerPct: 30, retainPct: 4, auto: true }), 'utf8')
fs.writeFileSync(setHome2, USER_PRESET, 'utf8')
process.env.DSH_HOME = HOME2
const m2 = await import('file:///' + MOD + '?boot' + Date.now())
const ctx2 = {
  get: (n) => (n === 'webServer' ? { register: () => () => {} } : undefined),
  effect: (fn) => fn(),
  inject: (deps, cb) => { cb({ systemPrompt: { section: () => () => {} } }) },
}
await m2.apply(ctx2)
const bootText = fs.readFileSync(setHome2, 'utf8')
t('启动对账（开关=开、文件无受管行）⇒ 首次接管，并且当场存下原文备份',
  /thresholdRatio: 0\.30/.test(bootText)
  && (JSON.parse(fs.readFileSync(path.join(HOME2, 'dsh-cache-control', 'settings.json'), 'utf8')).compactionBackup || {}).text === USER_PRESET,
  JSON.stringify(Object.keys(JSON.parse(fs.readFileSync(path.join(HOME2, 'dsh-cache-control', 'settings.json'), 'utf8')))))
const afterBoot = JSON.parse(fs.readFileSync(path.join(HOME2, 'dsh-cache-control', 'settings.json'), 'utf8'))
afterBoot.enabled = false
fs.writeFileSync(path.join(HOME2, 'dsh-cache-control', 'settings.json'), JSON.stringify(afterBoot, null, 2), 'utf8')
await m2.apply(ctx2)
t('启动对账（开关=关、文件有受管行）⇒ 还原而不是删掉',
  fs.readFileSync(setHome2, 'utf8') === USER_PRESET, 'marker=' + m2.hasManagedMarker(fs.readFileSync(setHome2, 'utf8')))

// --- 5. sanitize 必须把新字段带出来（否则任何一次写盘都会吃掉备份）----------
console.log('— sanitize 带出 compactionBackup —')
const withBackup = m.sanitize({ enabled: true, compactionBackup: { text: 'x\ny', at: 123 } })
t('sanitize 原样保留合法备份', J(withBackup.compactionBackup) === J({ text: 'x\ny', at: 123 }), J(withBackup.compactionBackup))
t('sanitize 把形状不对的备份归 null（text 空 / at 非数字 / 非对象）',
  m.sanitize({ compactionBackup: { text: '', at: 1 } }).compactionBackup === null
  && m.sanitize({ compactionBackup: { text: 'a', at: 'x' } }).compactionBackup === null
  && m.sanitize({ compactionBackup: 7 }).compactionBackup === null
  && m.sanitize({}).compactionBackup === null, '')
t('sanitize 的输出里 key 齐全（旧盘升级后写盘不会丢字段）',
  'compactionBackup' in m.sanitize({}) && 'hideResizer' in m.sanitize({}) && 'hideDivider' in m.sanitize({}), Object.keys(m.sanitize({})).join(','))

// --- 6. 纯函数层：splice 幂等 + 判据只看压缩四字段 --------------------------
console.log('— splice / compactionFieldsChanged —')
const sv = m.resolveValues({ triggerPct: 30, retainPct: 4, auto: true })
const once = m.spliceCompactionRow(USER_PRESET, sv)
const twice = m.spliceCompactionRow(once, sv)
t('splice 幂等：same row 连续跑两次，第二次逐字节相同', once === twice, 'len ' + once.length + ' / ' + twice.length)
t('splice 不改动调用方的原文本（纯函数）', USER_PRESET.includes('thresholdRatio: 0.66'))
t('splice 保留行块里用户自写的注释', once.includes('# 用户自己写的说明：这一行别动'))
t('splice(text, null) 摘掉受管 config，但仍保留用户注释与其它键',
  (() => { const out = m.spliceCompactionRow(once, null); return !/thresholdRatio/.test(out) && out.includes('# 用户自己写的说明：这一行别动') && out.includes('- id: next-row') })())
const f = (o) => m.sanitize(o)
t('compactionFieldsChanged：外观/门禁字段改动 ⇒ false',
  m.compactionFieldsChanged(f({ enabled: true }), f({ enabled: true, pinLastUser: true, clearBubble: true, pinBlur: 3, pinMaxVh: 50, chatWidth: 90, chatWidthEnabled: true, hideResizer: true, hideDivider: true, gateEnabled: true })) === false)
t('compactionFieldsChanged：enabled / triggerPct / retainPct / auto 任一改动 ⇒ true',
  m.compactionFieldsChanged(f({ enabled: true }), f({ enabled: false })) === true
  && m.compactionFieldsChanged(f({ enabled: true, triggerPct: 30 }), f({ enabled: true, triggerPct: 45 })) === true
  && m.compactionFieldsChanged(f({ enabled: true, retainPct: 4 }), f({ enabled: true, retainPct: 2 })) === true
  && m.compactionFieldsChanged(f({ enabled: true, auto: true }), f({ enabled: true, auto: false })) === true)

fs.rmSync(HOME2, { recursive: true, force: true })

