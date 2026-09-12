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

console.log('\n临时目录：' + HOME + '（跑完删除）')
fs.rmSync(HOME, { recursive: true, force: true })
process.exitCode = bad === 0 ? 0 : 1
