// Real React mount + effects + user callbacks. Deferred transport exposes races
// that static markup and source-string checks cannot exercise. No real DSH/API.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import React from 'react'
import { create, act } from 'react-test-renderer'

let module, pass = 0, clock = 0
const pending = [], timers = new Map()
const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const sandbox = {
  window: { __ModuleLoader__: { load(value) { module = value } } },
  console, AbortController,
  setTimeout(fn, ms) { const id = ++clock; timers.set(id, { fn, ms }); return id },
  clearTimeout(id) { timers.delete(id) },
  fetch(url, options) {
    return new Promise((resolve, reject) => pending.push({ url, options, resolve, reject }))
  },
}
vm.runInNewContext(source, sandbox)
const exported = module.factory((name) => {
  if (name === 'react') return React
  throw new Error('optional host package absent: ' + name)
})
const Card = exported.internals.SaveTokenCard
const data = (compress = true) => ({ flags: { compress, dedupe: true, expandTool: true }, totals: {}, compression: {} })
const check = (name, condition) => { assert.ok(condition, name); pass++; console.log('PASS ' + name) }
const settle = async (req, body, status = 200) => act(async () => {
  req.resolve({ ok: status >= 200 && status < 300, status, json: async () => body })
})
const tick = async (ms) => act(async () => {
  for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn() }
})
let root
const text = () => JSON.stringify(root.toJSON())
const button = (label) => root.root.findAllByType('button').find((node) => node.children.join('') === label)
await act(async () => { root = create(React.createElement(Card)) })
check('真实组件挂载显示加载态，并触发一次 GET', text().includes('正在读取') && pending.length === 1)
await tick(2500)
check('慢请求期间不叠加轮询', pending.length === 1)
await settle(pending[0], data())
check('异步取数完成后真实组件渲染 KPI 与开关', text().includes('模型请求') && !!button('压缩：开'))
check('可访问开关暴露当前状态', button('压缩：开').props['aria-pressed'] === true)
check('重启语义在默认展开内容可见', text().includes('重启后计数归零'))
await tick(2500)
const oldRead = pending.at(-1)
await act(async () => { button('压缩：开').props.onClick(); button('压缩：开').props.onClick() })
const write = pending.at(-1)
check('点击中止旧 GET，并发送正确写入值', oldRead.options.signal.aborted && JSON.parse(write.options.body).value === false)
check('重复点击仅发送一次 POST', pending.filter((r) => r.options.method === 'POST').length === 1)
check('写入期间按钮禁用', button('压缩：开').props.disabled === true)
await settle(write, { ok: true })
check('POST 成功后仍等待回读再解锁', button('压缩：开').props.disabled === true && pending.at(-1).url.endsWith('dashboard'))
await settle(pending.at(-1), data(false))
check('回读成功显示新状态并解锁', !!button('压缩：关') && button('压缩：关').props.disabled === false)
await settle(oldRead, data(true)) // Simulate a transport that ignores AbortSignal.
check('迟到的旧 GET 不能把关覆盖成开', !!button('压缩：关') && !button('压缩：开'))
await act(async () => { button('压缩：关').props.onClick() })
await settle(pending.at(-1), { ok: true }, 503)
check('HTTP 失败明确显示且按钮恢复', text().includes('HTTP 503') && button('压缩：关').props.disabled === false)
await tick(2500)
const onExit = pending.at(-1)
await act(async () => { root.unmount() })
check('卸载终止在途请求', onExit.options.signal.aborted)
await settle(onExit, data())
check('卸载后迟到响应不再安排轮询', timers.size === 0)

await act(async () => { root = create(React.createElement(Card)) })
await settle(pending.at(-1), { error: 'not ready' }, 500)
check('初次读取失败提供重试入口', !!button('重新读取') && text().includes('HTTP 500'))
await act(async () => { button('重新读取').props.onClick() })
await settle(pending.at(-1), data())
check('重试能恢复真实组件内容', !!button('压缩：开') && !text().includes('HTTP 500'))
await tick(2500)
const slow = pending.at(-1)
slow.options.signal.addEventListener('abort', () => slow.reject(new Error('aborted')), { once: true })
await tick(10000)
check('超时有可理解的提示并允许下一次轮询', text().includes('请求超时，请重试') && [...timers.values()].some((t) => t.ms === 2500))
await act(async () => { root.unmount() })
check('卸载清理全部定时器', timers.size === 0)
console.log(`${pass} passed, 0 failed`)
