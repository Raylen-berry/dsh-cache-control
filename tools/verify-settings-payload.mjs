// Exercise real callbacks and deferred requests: partial writes, ordering, retry,
// every persisted control, and independence from rule text / review endpoints.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import React from 'react'
import { DEFAULTS } from '../index.js'
let module, id = 0, passed = 0
const timers = new Map(), requests = []
const sandbox = {
  window: { __ModuleLoader__: { load(m) { module = m } } },
  document: { querySelector() { return null }, querySelectorAll() { return [] } },
  console, AbortController, Blob,
  setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id },
  clearTimeout(id) { timers.delete(id) },
  fetch(url, options) { return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })) },
}
vm.runInNewContext(fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8'), sandbox)
const x = module.factory(name => { if (name === 'react') return React; throw Error(name) }).internals
const store = x.STORE
store.set({ ...DEFAULTS, loaded: true, loading: false, gateReady: true, ponytailReady: true, shapeReady: true,
  appearanceReady: true, resizerReady: true, dividerReady: true, reviewReady: true })
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const settle = async (r, body = { ok: true }, status = 200) => {
  r.resolve({ ok: status < 400, status, json: async () => body }); await flush()
}
const tick = async ms => { for (const [id,t] of [...timers]) if(t.ms === ms){timers.delete(id);t.fn()} await flush() }
const body = r => JSON.parse(r.options.body)
const check = (name, condition) => { assert.ok(condition, name); passed++; console.log('PASS '+name) }
const cases = [
  ['gateEnabled', () => x.flipGate()], ['ponytailEnabled', () => x.setPonytailEnabled(true)],
  ['shapeEnabled', () => x.setShapeEnabled(false)], ['pinLastUser', () => x.setPinLastUser(true)],
  ['clearBubble', () => x.setClearBubble(true)], ['pinBlur', () => x.setPinBlur(18)],
  // v1.16.19：钉顶气泡里图片的不透明度（0 是合法档位，用例取 35 走一趟真实保存）
  ['imgFade', () => x.setImgFade(35)],
  ['pinMaxVh', () => x.setPinMaxVh(52)], ['chatWidth', () => x.commitChatWidth(88)],
  ['chatWidthEnabled', () => x.setChatWidthEnabled(true)], ['hideResizer', () => x.setHideResizer(true)],
  ['hideDivider', () => x.setHideDivider(true)],
  // v1.16.1：回答气泡限高（开关 + 比例值）
  ['outputCapEnabled', () => x.setOutputCapEnabled(false)], ['outputCapVh', () => x.setOutputCapVh(58)],
  // v1.16.2：钉顶气泡宽度比例
  ['pinWidthPct', () => x.setPinWidthPct(78)],
  // v1.16.7：普通提问气泡宽度比例
  ['userWidthPct', () => x.setUserWidthPct(72)],
  // v1.16.3：提问气泡限高（开关 + 比例值）
  ['userCapEnabled', () => x.setUserCapEnabled(false)], ['userCapVh', () => x.setUserCapVh(52)],
]
for (const [key, action] of cases) {
  const start = requests.length; action(); await tick(250)
  const r = requests.at(-1)
  check(key+' 只提交变动字段及真实显示值', requests.length===start+1 && r.url==='/cc/settings.json' &&
    Object.keys(body(r)).join()===key && body(r)[key]===store.state[key])
  await settle(r)
  check(key+' 完成保存且不产生覆盖本地状态的 GET', !store.state.saving && !store.state.error && requests.length===start+1)
}
x.setReviewEnabled(false); const review=requests.at(-1)
check('审查开关独立写入专属接口',review.url==='/cc/review.json' && body(review).enabled===false)
await settle(review,{ok:true,review:{enabled:false,registered:false}})
check('DEFAULTS 中每项均有实际可保存的控件', Object.keys(DEFAULTS).sort().join() === [...cases.map(c=>c[0]),'reviewSkillEnabled'].sort().join())

x.setPinBlur(5); await tick(250); const first=requests.at(-1), before=requests.length
x.setPinBlur(7); x.setPinBlur(12); x.setHideDivider(false); await tick(250)
check('旧写入未完成时，后续更改合并等待而不并发写盘',requests.length===before && store.state.pinBlur===12)
await settle(first)
check('上一轮结束后提交最新值与其他改动，不夹带审查开关',JSON.stringify(body(requests.at(-1)))===JSON.stringify({pinBlur:12,hideDivider:false}))
await settle(requests.at(-1))
check('快速连续调整的最终状态正确',!store.state.saving && store.state.pinBlur===12 && store.state.reviewEnabled===false)

x.setPinBlur(9); await tick(250); const failed=requests.at(-1)
x.setPinBlur(15); await tick(250); await settle(failed,{ok:false,error:'磁盘暂不可写'},503)
check('失败保留新输入并明确提示未保存',store.state.pinBlur===15 && !store.state.saving && store.state.error.includes('尚未保存'))
x.saveNow(); check('重试采用较新的待保存值',body(requests.at(-1)).pinBlur===15)
await settle(requests.at(-1)); check('重试完成清除错误',!store.state.error && !store.state.saving)

store.set({gateDraft:'new rule',gateText:'old rule',gateEnabled:true})
x.saveGateText('new rule'); const rule=requests.at(-1)
x.flipGate(); await tick(250); await settle(requests.at(-1))
await settle(rule,{ok:true,gate:{text:'new rule',bytes:8,enabled:true}})
check('保存规则正文不能倒灌旧开关状态',store.state.gateEnabled===false && store.state.gateDraft===null && store.state.gateText==='new rule')
store.set({gateDraft:'keep my draft'}); x.saveGateText('keep my draft'); await settle(requests.at(-1),{error:'保存失败'},500)
check('规则保存失败保留草稿并提供错误信息',store.state.gateDraft==='keep my draft' && !!store.state.gateError && !store.state.gateSaving)
const count=requests.length; x.reloadGate(); check('未保存的草稿阻止规则重读',requests.length===count)

store.set({gateDraft:null});x.reloadSettings()
const oldSettings=requests.findLast(r=>r.url==='/cc/settings.json' && !r.options.method)
const oldReview=requests.findLast(r=>r.url==='/cc/review.json' && !r.options.method)
x.setPinBlur(21); await tick(250); await settle(requests.at(-1))
await settle(oldSettings,{settings:{...DEFAULTS,pinBlur:1},gate:{text:'old',enabled:true}})
await settle(oldReview,{review:{enabled:false,registered:false}})
check('迟到的全量读取不会回滚刚改好的设置',store.state.pinBlur===21 && !store.state.loading)

// v1.16.20：**加载路径也要搬 imgFade**。这里原来是漏的 —— pull() 只写了一半字段，
// imgFade 永远停在 DEFAULTS=100，用户报"钉顶里的图片还是不透明，调完刷新又变回去"。
// 本用例直接对一个"盘上 imgFade=35 的 GET 响应"断言它进了 STORE（缺陷时这里拿到的是 100）。
store.set({imgFade:100})
x.reloadSettings()
await settle(requests.findLast(r=>r.url==='/cc/settings.json' && !r.options.method),{settings:{...DEFAULTS,imgFade:35}})
check('全量读取把盘上的 imgFade 搬进状态（原来漏搬 ⇒ 永远 100）',store.state.imgFade===35)
check('imgFade 的合法档位可钳（0 = 全透明）',x.clampImgFade(0)===0 && x.clampImgFade(500)===100 && x.clampImgFade('x')===100)
// 旧盘没有这个键 ⇒ 必须保留当前值，而不是被 undefined 钳成 0（那会让图片直接消失）
x.reloadSettings()
await settle(requests.findLast(r=>r.url==='/cc/settings.json' && !r.options.method),{settings:{...DEFAULTS,imgFade:undefined}})
check('旧盘缺 imgFade 时保留现值（不落成全透明）',store.state.imgFade===35)

x.setClearBubble(false);await tick(250);const timeout=requests.at(-1)
await tick(10000)
check('保存超时终止请求并保留重试能力',timeout.options.signal.aborted && store.state.error.includes('超时') && !store.state.saving)
x.saveNow();await settle(requests.at(-1));check('超时后可恢复保存',!store.state.saving && !store.state.error)
check('所有请求完成后无残留定时器',timers.size===0)
console.log(`${passed} passed, 0 failed`)
