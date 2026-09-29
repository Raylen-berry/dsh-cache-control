// Isolated browser fixture. Policy/settings routes use the real host with a temporary
// home; stats/storage are synthetic. No user settings or files are changed.
// CC_PLAYWRIGHT_MODULE and CC_BROWSER_PATH select locally installed test runtimes.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { pathToFileURL, fileURLToPath } from 'node:url'
import * as host from '../index.js'
import http from 'node:http'
const { DEFAULTS } = host
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pw = process.env.CC_PLAYWRIGHT_MODULE
const { chromium } = await import(pw ? pathToFileURL(pw).href : 'playwright')
const out = process.env.CC_SCREENSHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(),'cc-workbench-'))
fs.mkdirSync(out, { recursive: true })
const baseline = !!process.env.CC_TEST_CLIENT
const settings = { ...DEFAULTS, gateEnabled: true, ponytailEnabled: true, shapeEnabled: true }
const rule = (file,enabled=true) => {
  const text=fs.readFileSync(path.join(repo,file),'utf8'),bytes=Buffer.byteLength(text)
  return {text,bytes,lines:text.split('\n').length,enabled,source:'builtin',maxBytes:16384,originalBytes:bytes,keptBytes:bytes}
}
const rules={gate:rule('session-gate.md'),ponytail:rule('ponytail-gate.md'),shape:rule('shape-gate.md')}
const storage={ok:true,total:{bytes:214000000,files:1180},recycle:{bytes:12000000,files:40},categories:[
  {id:'sessions',label:'会话记录',bytes:145000000,files:240,exists:true,note:'每个会话的全文，不参与清理'},
  {id:'browser',label:'浏览器观察窗',bytes:44000000,files:720,exists:true,note:'浏览器缓存、截图和下载'},
  {id:'attachment',label:'附件副本',bytes:25000000,files:220,exists:true,note:'旧对话中的图片与文件，保留'},
],candidates:[{label:'观察窗截图',bytes:6000000,files:60,path:'C:/fixture/shots',why:'调试留痕',risk:'无'}]}
const dashboard={flags:{compress:true,dedupe:true,expandTool:true},totals:{},compression:{}}
const fixtureHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-browser-policy-'))
process.env.DSH_HOME = fixtureHome
fs.mkdirSync(path.join(fixtureHome,'dsh-cache-control'),{recursive:true})
fs.writeFileSync(path.join(fixtureHome,'dsh-cache-control/settings.json'),JSON.stringify(settings))
const apiRoutes=new Map()
await host.apply({get(name){return name==='webServer'?{register(r){apiRoutes.set(r.path,r.handler);return()=>{}}}:undefined},effect:fn=>fn(),inject(names,fn){if(names.includes('systemPrompt'))fn({systemPrompt:{section(){}}})},on(){}})
const server=http.createServer((req,res)=>{const fn=apiRoutes.get(req.url.split('?')[0]);if(fn)fn(req,res);else{res.writeHead(404);res.end('{}')}})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const apiBase='http://127.0.0.1:'+server.address().port
const calls=[], errors=[]
let failSave=false,holdStorage=false,heldStorage,holdPolicy=false,heldPolicy
const browser=await chromium.launch({headless:true,...(process.env.CC_BROWSER_PATH?{executablePath:process.env.CC_BROWSER_PATH}:{})})
const page=await browser.newPage({viewport:{width:1200,height:1040},deviceScaleFactor:1})
page.on('pageerror',e=>errors.push(String(e)))
let passed=0
const check=(label,value)=>{assert.ok(value,label);passed++;console.log('PASS '+label)}
const snap=async name=>{
  // Let the 150ms tab/theme transition finish before visual comparison.
  await page.waitForTimeout(180)
  await page.screenshot({path:path.join(out,name+'.png'),fullPage:true})
}
const tab=name=>page.getByRole('tab',{name,exact:true})
const light=`:root{color-scheme:light;--dsw-alias-label-primary:#232735;--dsw-alias-label-secondary:#646c80;--dsw-alias-border-l1:#e1e4ec;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#eff2f8;--dsw-alias-bg-hover:#f5f6fa;--dsw-alias-brand-primary:#5269d8}body{margin:0;padding:40px;background:#f7f8fb;font-family:'Microsoft Yahei',Arial,sans-serif}#app{max-width:1040px;margin:auto}button,input,textarea{font:inherit}button{cursor:pointer}button:disabled{cursor:default}@media(max-width:760px){body{padding:18px}}`
const dark=`:root{color-scheme:dark;--dsw-alias-label-primary:#e8ebf3;--dsw-alias-label-secondary:#a0a8b9;--dsw-alias-border-l1:#333948;--dsw-alias-bg-layer-1:#222733;--dsw-alias-bg-layer-2:#333b4c;--dsw-alias-bg-hover:#2b3342;--dsw-alias-brand-primary:#96a8ff}body{background:#181d27}`
try{
await page.route('http://cc-workbench.test/**',async route=>{
  const req=route.request(),url=new URL(req.url()),method=req.method()
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh"><meta charset="utf-8"><style>'+light+'</style><div id="app"></div></html>'})
  const body=req.postDataJSON();calls.push({url:url.pathname,method,body})
  let result={ok:true}
  if (!url.pathname.startsWith('/cc/storage') && !url.pathname.startsWith('/cc/st/')) {
    if (failSave && url.pathname==='/cc/settings.json' && method==='PUT') {
      failSave=false;return route.fulfill({status:503,json:{ok:false,error:'模拟磁盘暂不可写'}})
    }
    const response=await fetch(apiBase+url.pathname+url.search,{method,...(body==null?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})})
    if(holdPolicy && url.pathname==='/cc/policy' && body?.action==='apply'){
      holdPolicy=false;await new Promise(resolve=>heldPolicy=resolve)
    }
    return route.fulfill({status:response.status,contentType:'application/json',body:await response.text()})
  }  else if(url.pathname==='/cc/st/api/dashboard')result=dashboard
  else if(url.pathname==='/cc/storage'){
    if(holdStorage){await new Promise(resolve=>heldStorage=resolve);holdStorage=false}
    result=storage
  }else if(url.pathname==='/cc/storage/clean')result={ok:true,moved:[],skipped:[{reason:'文件占用中'}]}
  else if(url.pathname==='/cc/storage/purge')result={ok:true,freed:12000000}
  else{
    const pre=/^\/cc\/(gate|ponytail|shape)\.json$/.exec(url.pathname)?.[1]
    if(pre){if(method==='PUT')rules[pre]={...rules[pre],text:body.text,bytes:Buffer.byteLength(body.text),source:'override'};result={ok:true,[pre]:rules[pre]}}
  }
  await route.fulfill({json:result})
})
await page.goto('http://cc-workbench.test/')
await page.addScriptTag({path:path.join(repo,'node_modules/react/umd/react.development.js')})
await page.addScriptTag({path:path.join(repo,'node_modules/react-dom/umd/react-dom.development.js')})
await page.evaluate(()=>{window.__ModuleLoader__={load(m){window.clientModule=m}}})
await page.addScriptTag({path:process.env.CC_TEST_CLIENT || path.join(repo,'client.js')})
await page.evaluate(()=>{
  const client=window.clientModule.factory(name=>{if(name==='react')return React;if(name==='react-dom')return ReactDOM;throw Error('optional '+name)})
  const slots={inject(name,fn){fn()},register(entry,comp){if(entry.name==='settings.section')window.Page=comp;if(entry.name==='conversation.input.right')window.Chip=comp}}
  client.apply({get(name){return name==='slots'?slots:undefined},effect(fn){fn()}})
  window.cc=client.internals
  function Frame(){
    const pair=React.useState('fixture-A');window.switchTestSession=pair[1];const chip=React.useState(false);window.showTestChip=chip[1]
    return React.createElement(React.Fragment,null,React.createElement(window.Page,{useSessions:selector=>selector({byId:{[pair[0]]:{id:pair[0],retainedBy:{mainView:1}}}})}),chip[0]?React.createElement('div',{id:'test-chip'},React.createElement(window.Chip,{sessionId:pair[0]})):null)
  }
  ReactDOM.createRoot(document.getElementById('app')).render(React.createElement(Frame))
})
await page.waitForFunction(()=>window.cc.STORE.state.loaded)
if(baseline){await snap('before');console.log('Baseline screenshot: '+out);process.exitCode=0}
else{
await page.getByRole('tab',{name:'规则',exact:true}).waitFor()
check('首次只加载设置与审查，不提前扫描磁盘或轮询', !calls.some(c=>c.url==='/cc/storage'||c.url==='/cc/st/api/dashboard'))
await snap('rules-light')
const gate=page.locator('section').filter({has:page.getByRole('heading',{name:'会话守则',exact:true})})
await gate.getByRole('button',{name:'编辑规则',exact:true}).click()
await gate.locator('textarea').fill('保留这段测试草稿')
await tab('对话外观').click();await snap('appearance-light')
await tab('规则').click()
check('切换分区保留未保存的正文',await gate.locator('textarea').inputValue()==='保留这段测试草稿')
await gate.getByRole('button',{name:'保存并生效',exact:true}).click()
await gate.getByRole('button',{name:'编辑规则',exact:true}).waitFor()
check('正文真正经专用接口保存',calls.some(c=>c.url==='/cc/gate.json'&&c.method==='PUT'&&c.body.text==='保留这段测试草稿'))
failSave=true
await gate.locator('input[type=checkbox]').click()
await page.getByRole('alert').filter({hasText:'改动尚未保存'}).waitFor()
await page.getByRole('button',{name:'重试',exact:true}).click()
await page.waitForFunction(()=>!window.cc.STORE.state.error&&!window.cc.STORE.state.saving)
check('保存失败有提示并可点击重试',calls.filter(c=>c.url==='/cc/settings.json'&&c.method==='PUT').length===2)
await tab('省 token').click();await page.getByRole('button',{name:'压缩：开',exact:true}).waitFor();await snap('tokens-light')
await tab('规则').click()
const previous=calls.filter(c=>c.url==='/cc/st/api/dashboard').length
// Deliberately span the 2.5s poll deadline after unmount.
await page.waitForTimeout(2750)
check('离开统计分区后停止网络轮询',calls.filter(c=>c.url==='/cc/st/api/dashboard').length===previous)
await tab('存储').click();await page.getByRole('button',{name:'刷新统计',exact:true}).waitFor()
await page.getByRole('button',{name:/清理预览/}).click()
await snap('storage-light')
await page.getByRole('button',{name:'全部移入回收',exact:true}).click()
check('批量清理先显示具体数量和体积',await page.getByRole('alertdialog').isVisible()&&!calls.some(c=>c.url==='/cc/storage/clean'))
await page.getByRole('button',{name:'取消',exact:true}).click()
check('取消不产生文件操作',!calls.some(c=>c.url==='/cc/storage/clean'))
await page.getByRole('button',{name:'全部移入回收',exact:true}).click()
await page.getByRole('button',{name:'确认批量移入回收',exact:true}).click()
await page.getByRole('status').filter({hasText:'文件占用中'}).waitFor()
check('清理只提交预览内的路径，并显示部分失败',JSON.stringify(calls.find(c=>c.url==='/cc/storage/clean').body.paths)===JSON.stringify(['C:/fixture/shots']))
await page.getByRole('button',{name:'清空回收目录',exact:true}).click()
check('永久清空单独确认，取消前未调用删除',await page.getByRole('alertdialog').innerText().then(t=>t.includes('永久删除'))&&!calls.some(c=>c.url==='/cc/storage/purge'))
await page.getByRole('button',{name:'取消',exact:true}).click()
holdStorage=true;await page.getByRole('button',{name:'刷新统计',exact:true}).click()
await page.waitForFunction(()=>document.body.innerText.includes('正在统计目录占用'))
await tab('规则').click();heldStorage?.();await page.waitForTimeout(100)
check('离开存储页后迟到结果不影响规则页',await page.getByRole('heading',{name:'模型如何协作',exact:true}).isVisible())
await tab('规则').focus();await page.keyboard.press('ArrowRight')
check('键盘方向键能切换分区并移动焦点',await tab('省 token').getAttribute('aria-selected')==='true')
await tab('规则').click()
await page.getByRole('button',{name:'策略预设',exact:true}).click()
await page.getByRole('button',{name:/保存与管理我的预设/}).click()
await page.getByLabel('预设名称',{exact:true}).fill('浏览器测试组合')
await page.getByRole('button',{name:'保存当前组合',exact:true}).click()
await page.getByRole('status').filter({hasText:'当前组合已保存为预设'}).waitFor()
const custom=await page.getByLabel('规则组合',{exact:true}).inputValue()
check('可从真实界面新建有正文快照的预设',!custom.startsWith('builtin:'))
await page.getByLabel('规则组合',{exact:true}).selectOption('builtin:code')
await page.getByRole('button',{name:'预览应用',exact:true}).click()
await page.getByRole('button',{name:'确认应用',exact:true}).waitFor()
check('预览先显示开关变化，尚未修改设置',!await page.evaluate(()=>window.cc.STORE.state.gateEnabled))
await snap('preset-preview')
holdPolicy=true
await page.getByRole('button',{name:'确认应用',exact:true}).click()
await page.waitForFunction(()=>window.cc.STORE.state.policyWriting===true)
await tab('对话外观').click()
while(!heldPolicy)await new Promise(resolve=>setTimeout(resolve,10))
heldPolicy();heldPolicy=null
await page.waitForFunction(()=>window.cc.STORE.state.gateEnabled===true && !window.cc.STORE.state.loading)
check('应用预设时切走页面，完成后仍同步实际设置',await tab('对话外观').getAttribute('aria-selected')==='true')
check('确认后预设才真正生效',await page.evaluate(()=>window.cc.STORE.state.ponytailEnabled===true))
await tab('规则').click()
await page.getByLabel('预设应用范围',{exact:true}).selectOption('session')
await page.getByLabel('规则组合',{exact:true}).selectOption('builtin:daily')
await page.getByRole('button',{name:'预览应用',exact:true}).click()
await page.getByRole('button',{name:'确认应用',exact:true}).click()
await page.getByRole('button',{name:'当前会话',exact:true}).click()
await page.waitForFunction(()=>document.querySelector('[aria-label="会话守则当前会话"]')?.value==='false')
check('仅当前会话应用预设不改全局开关',await page.evaluate(()=>window.cc.STORE.state.gateEnabled===true))
await snap('session-overrides')
await page.evaluate(()=>window.switchTestSession('fixture-B'))
await page.waitForFunction(()=>document.querySelector('[aria-label="会话守则当前会话"]')?.value==='inherit')
check('切换会话正确显示独立设置',await page.getByLabel('会话守则当前会话').inputValue()==='inherit')
await page.evaluate(()=>window.switchTestSession('fixture-A'))
await page.waitForFunction(()=>document.querySelector('[aria-label="会话守则当前会话"]')?.value==='false')
await page.getByRole('button',{name:'全部恢复跟随全局',exact:true}).click()
await page.waitForFunction(()=>document.querySelector('[aria-label="会话守则当前会话"]')?.value==='inherit')
check('会话可以一键恢复跟随全局',true)
await gate.getByRole('button',{name:/历史与恢复/}).click()
const historySelect=gate.getByLabel('会话守则历史版本')
await historySelect.selectOption({index:1})
await gate.getByRole('button',{name:'恢复此版本',exact:true}).waitFor()
await snap('rule-history')
await gate.getByRole('button',{name:'恢复此版本',exact:true}).click()
await page.waitForFunction(()=>window.cc.STORE.state.gateText.includes('保留这段测试草稿'))
check('从历史预览恢复到原始自定义正文',true)
await gate.getByRole('button',{name:'编辑规则',exact:true}).click()
await gate.locator('textarea').fill('回答尽量简短，只给结论而无需解释。\n相同要求必须在所有场景认真执行。')
const pony=page.locator('section').filter({has:page.getByRole('heading',{name:'ponytail',exact:true})})
await pony.getByRole('button',{name:'编辑规则',exact:true}).click()
await pony.locator('textarea').fill('请详细解释每一步并充分展开理由。\n相同要求必须在所有场景认真执行。')
await page.getByText('疑似重复要求',{exact:true}).waitFor()
await page.getByText('可能存在篇幅要求冲突：简短与详细展开',{exact:true}).waitFor()
check('编辑时显示实际负担估算及重复、冲突位置',await page.getByText(/不是实测或计费值/).isVisible())
await snap('rule-feedback')
await gate.getByRole('button',{name:'取消编辑',exact:true}).click()
await pony.getByRole('button',{name:'取消编辑',exact:true}).click()
await page.getByRole('button',{name:'生效检查',exact:true}).click()
await page.getByText('从配置到实际请求',{exact:true}).waitFor()
await page.getByText('已挂载；尚未观察到当前会话的新请求',{exact:true}).first().waitFor()
check('无请求证据时明确显示等待，而非假报已生效',true)
await snap('diagnostics')
await page.getByRole('button',{name:'策略预设',exact:true}).click()
await page.evaluate(()=>window.showTestChip(true))
const chipGate=page.locator('#test-chip .cc-seg').first()
await page.waitForFunction(()=>{const el=document.querySelector('#test-chip .cc-seg');return el && !el.disabled})
check('快捷开关明确标为本会话',await page.locator('#test-chip').getByText('本会话',{exact:true}).isVisible())
await chipGate.click()
await page.waitForFunction(()=>document.querySelector('#test-chip .cc-seg')?.getAttribute('aria-pressed')==='false' && !document.querySelector('#test-chip .cc-seg')?.disabled)
check('快捷开关只改当前会话，全局不被连带修改',await page.evaluate(()=>window.cc.STORE.state.gateEnabled===true))
await page.evaluate(()=>window.switchTestSession('fixture-B'))
await page.waitForFunction(()=>document.querySelector('#test-chip .cc-seg')?.getAttribute('aria-pressed')==='true' && !document.querySelector('#test-chip .cc-seg')?.disabled)
check('切换会话后快捷开关显示该会话的生效值',true)
await page.evaluate(()=>{window.showTestChip(false);window.switchTestSession('fixture-A')})
await page.addStyleTag({content:dark});await snap('rules-dark')
await page.setViewportSize({width:390,height:844})
for(const name of ['规则','省 token','对话外观','存储']){
  await tab(name).click();if(name==='存储')await page.getByRole('button',{name:'刷新统计',exact:true}).waitFor()
  check(name+' 在390px窄窗没有横向溢出',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await snap('narrow-'+({'规则':'rules','省 token':'tokens','对话外观':'appearance','存储':'storage'}[name]))
}
check('真实浏览器无脚本异常',errors.length===0)
console.log(`${passed} passed, 0 failed; screenshots: ${out}`)
}
}finally{heldStorage?.();heldPolicy?.();await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(fixtureHome,{recursive:true,force:true})}
