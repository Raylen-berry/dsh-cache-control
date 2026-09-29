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

let bad = 0, passed = 0
const t = (name, cond, extra) => { if (cond) { passed++; console.log('  PASS  ' + name) } else { bad++; console.log('  FAIL  ' + name + '  [' + extra + ']') } }
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
const legacy = m.sanitize({ gateEnabled: true, pinLastUser: true, clearBubble: true })
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
  && onDisk.pinBlur === 10 && onDisk.gateEnabled === false, J(onDisk))
// 自家已有配置时：除新字段外一律原样保留（这是真机场景）
fs.writeFileSync(ccFile, JSON.stringify({ gateEnabled: true, pinLastUser: true, clearBubble: true }), 'utf8')
const real = await m.migrateFromAtelier()
const realDisk = JSON.parse(fs.readFileSync(ccFile, 'utf8'))
t('真机形态：自家门禁/外观参数原样保留，只补对话页宽度（旧 px → 80%）',
  !!real && realDisk.gateEnabled === true && realDisk.pinLastUser === true && realDisk.clearBubble === true
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

// --- 3. 压缩接管已移除（v1.14.0）------------------------------------------
// 原第 3 节（旧 91–236 行）验证「改写 standard 组装文件 + 备份/还原」整套：
// DSH 0.1.7 起 agent preset 不再是可编辑的 agent.cordis.yml（整个安装里已没有这个文件），
// 接管没有落点 ⇒ 整条写盘路径删除。这一节只留"删干净了"的守护，免得哪天被捡回来。
console.log('— 压缩接管已移除 —')
t('host 不再导出接管的写盘函数',
  !m.resolveValues && !m.spliceCompactionRow && !m.applyToStandard && !m.readComposition && !m.standardCompositionCandidates)
t('DEFAULTS 里不再有压缩开关字段',
  !('enabled' in m.DEFAULTS) && !('triggerPct' in m.DEFAULTS) && !('retainPct' in m.DEFAULTS) && !('auto' in m.DEFAULTS))
t('sanitize 不再吐出压缩字段（旧盘残留会被下一次保存清掉）',
  !('enabled' in m.sanitize({ enabled: true })) && !('triggerPct' in m.sanitize({ triggerPct: 30 })))
t('外观与门禁字段照常清洗（删除没有牵连邻居）', (() => {
  const s = m.sanitize({ pinLastUser: true, chatWidth: 72, hideDivider: true, gateEnabled: true })
  return s.pinLastUser === true && s.chatWidth === 72 && s.hideDivider === true && s.gateEnabled === true
})())

// --- 4. 启动对账节已删除：压缩接管移除后启动只剩 migrateFromAtelier()（见第 2 节，v1.14.0）

// --- 3. sanitize 必须把 compactionBackup 带出来（历史数据，不能在任何一次写盘时被吃掉）---
console.log('— sanitize 带出 compactionBackup —')
const withBackup = m.sanitize({ compactionBackup: { text: 'x\ny', at: 123 } })
t('sanitize 原样保留合法备份', J(withBackup.compactionBackup) === J({ text: 'x\ny', at: 123 }), J(withBackup.compactionBackup))
t('sanitize 把形状不对的备份归 null（text 空 / at 非数字 / 非对象）',
  m.sanitize({ compactionBackup: { text: '', at: 1 } }).compactionBackup === null
  && m.sanitize({ compactionBackup: { text: 'a', at: 'x' } }).compactionBackup === null
  && m.sanitize({ compactionBackup: 7 }).compactionBackup === null
  && m.sanitize({}).compactionBackup === null, '')
t('sanitize 的输出里 key 齐全（旧盘升级后写盘不会丢字段）',
  'compactionBackup' in m.sanitize({}) && 'hideResizer' in m.sanitize({}) && 'hideDivider' in m.sanitize({}), Object.keys(m.sanitize({})).join(','))

// --- 6 已删除：splice / compactionFieldsChanged（压缩接管随 DSH 0.1.7 一并移除，v1.14.0）

// --- 4. 存储用量与清理（v1.8.0）：只读统计 + 白名单回收 ----------------------
console.log('— storage：统计 / 候选 / 白名单回收 —')
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-storage-'))
  const mk = (rel, bytes) => {
    const f = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, 'x'.repeat(bytes))
  }
  mk('sessions/s1.jsonl', 1000)
  mk('dsh-browser-live/shots/a.png', 500)
  mk('dsh-browser-live/shots/b.png', 700)
  mk('dsh-browser-live/chrome-profile-plugin/Default/Cache/c1', 300)
  mk('dsh-browser-live/chrome-profile-plugin/Default/Cookies', 999)   // 登录态：绝不能进候选

  const rep = await m.storageReport(tmp)
  const byId = Object.fromEntries(rep.categories.map((c) => [c.id, c]))
  const bl = byId['browser-live']
  t('browser-live 分类统计全部文件', bl.bytes === 500 + 700 + 300 + 999, bl.bytes)
  t('sessions 分类独立统计', byId.sessions.bytes === 1000, byId.sessions.bytes)
  t('总计 = 各类之和', rep.total.bytes === 3499, rep.total.bytes)
  t('不存在的目录标 exists=false 且不报错', byId.bill.exists === false)
  t('统计带 truncated 标记（大树防呆）', rep.categories.every((c) => typeof c.truncated === 'boolean'))

  mk('dsh-video-prompt/runs/valuable-prompt.md', 100)
  mk('dsh-cache-control/recycle/old-cache.txt', 40)
  const cands = await m.cleanCandidates(tmp)
  const paths = cands.map((c) => c.path)
  t('候选含观察窗截图', paths.some((p) => p.endsWith(path.join('dsh-browser-live', 'shots'))))
  t('候选含浏览器 Cache（明确可再生成）', paths.some((p) => p.endsWith(path.join('Default', 'Cache'))))
  t('候选**不含**登录态（Cookies 不进去）', !paths.some((p) => p.includes('Cookies')))
  t('候选**不含**会话记录（聊天历史不许被清）', !paths.some((p) => p.endsWith('sessions')))
  t('提示词产物与回收目录都不进缓存候选', !paths.some(p => p.includes('runs') || p.includes('recycle')))
  t('回收统计使用传入的隔离目录', (await m.storageReport(tmp)).recycle.bytes === 40)
  m.invalidateStorageSnapshot()
  const [snapshot1, snapshot2] = await Promise.all([m.readStorageSnapshot(tmp), m.readStorageSnapshot(tmp)])
  t('并发读取共用同一次目录统计', snapshot1 === snapshot2)
  mk('sessions/new.jsonl', 80)
  t('短时复用统计避免重复扫盘', await m.readStorageSnapshot(tmp) === snapshot1)
  const fresh = await m.readStorageSnapshot(tmp, true)
  t('主动刷新能读取新增文件', fresh.total.bytes === snapshot1.total.bytes + 80)
  m.invalidateStorageSnapshot()
  t('清理后失效机制会重新统计', await m.readStorageSnapshot(tmp) !== fresh)
  t('候选按占用从大到小排', cands.every((c, i) => i === 0 || cands[i - 1].bytes >= c.bytes))

  const res = await m.recyclePaths([path.join(tmp, 'sessions'), path.join(tmp, 'dsh-browser-live', 'shots')], tmp, paths)
  t('只搬白名单内的那一项', res.moved.length === 1, JSON.stringify(res.moved.map((x) => x.path)))
  t('白名单外的被跳过并说明原因', res.skipped.length === 1 && res.skipped[0].reason === '不在候选清单内', JSON.stringify(res.skipped))
  t('会话记录仍在原地（没被搬走）', fs.existsSync(path.join(tmp, 'sessions', 's1.jsonl')))
  t('观察窗截图已移出原位置', !fs.existsSync(path.join(tmp, 'dsh-browser-live', 'shots')))
  t('回收目录里能找到它（可回溯）', fs.existsSync(res.recycleDir) && fs.readdirSync(res.recycleDir).length === 1)
  t('释放字节 = 被搬走目录的大小', res.freed === 1200, res.freed)

  // Exercise HTTP refresh and invalidation with an isolated home, including an
  // empty selection: it must never unexpectedly mean "clean everything".
  const http = await import('node:http')
  const routes = new Map()
  process.env.DSH_HOME = tmp
  await m.apply({
    get: name => name === 'webServer' ? { register(r) { routes.set(r.path, r.handler); return () => {} } } : undefined,
    effect: fn => fn(), inject() {},
  })
  const server = http.createServer((req, res) => routes.get(req.url.split('?')[0])(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  const get = async () => (await fetch(base + '/cc/storage?refresh=1')).json()
  const post = async (suffix, body = {}) => (await fetch(base + '/cc/storage/' + suffix, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })).json()
  try {
    const before = await get()
    t('存储 HTTP 路由返回分类与最新候选', before.ok && before.candidates.length === 1)
    const nothing = await post('clean', { paths: [] })
    t('空路径列表不会退化为全部清理', nothing.ok && nothing.moved.length === 0 && (await get()).candidates.length === 1)
    const cleaned = await post('clean', { paths: before.candidates.map(c => c.path) })
    const after = await (await fetch(base + '/cc/storage')).json()
    t('回收后普通 GET 已失效重算，旧缓存不倒灌', cleaned.ok && cleaned.moved.length === 1 && after.candidates.length === 0)
    t('实际批量清理保留提示词产物与会话', fs.existsSync(path.join(tmp, 'dsh-video-prompt/runs/valuable-prompt.md')) && fs.existsSync(path.join(tmp, 'sessions/s1.jsonl')))
    const purged = await post('purge')
    const empty = await (await fetch(base + '/cc/storage')).json()
    t('清空回收后重新统计且释放字节准确', purged.ok && purged.freed === after.recycle.bytes && empty.recycle.files === 0)
  } finally {
    await new Promise(resolve => server.close(resolve))
    process.env.DSH_HOME = HOME
  }

  fs.rmSync(tmp, { recursive: true, force: true })
}



console.log(`${passed} passed, ${bad} failed`); process.exitCode = bad ? 1 : 0
