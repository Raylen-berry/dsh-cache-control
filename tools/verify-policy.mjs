import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { createPolicyManager, analyzeRules, ruleDiff } from '../policy-host.js'
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-policy-'))
process.env.DSH_HOME = root
const host = await import('../index.js')
const modules = process.env.CC_HOST_MODULES
const { Context } = await import(modules ? pathToFileURL(path.join(modules,'@deepseek-ai/cordis/lib/index.js')) : '@deepseek-ai/cordis')
const { SystemPrompt, renderPrompt } = await import(modules ? pathToFileURL(path.join(modules,'@deepseek-ai/dsh-system-prompt/lib/index.js')) : '@deepseek-ai/dsh-system-prompt')
const context = new Context(), sp = new SystemPrompt(context, { includeHarnessIdentity: false })
const routes = new Map(), events = new Map()
await host.apply({
  get(name) { return name === 'webServer' ? { register(r) { routes.set(r.path,r.handler); return () => {} } } : undefined },
  effect(fn) { return fn() },
  inject(names, cb) { if(names.includes('systemPrompt'))cb({systemPrompt:sp}) },
  on(name,fn) { events.set(name,fn) },
})
const server=http.createServer((req,res)=>{
  const route=routes.get(req.url.split('?')[0])
  if(!route){res.writeHead(404);res.end('{}');return}route(req,res)
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const base='http://127.0.0.1:'+server.address().port
const api=async(url,body,method=body===undefined?'GET':'POST')=>{
  const res=await fetch(base+url,{method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})})
  return {status:res.status,...await res.json()}
}
let passed=0
function check(label,value){assert.ok(value,label);passed++;console.log('PASS '+label)}
const prompt=async id=>{const agent={session:{id}};return renderPrompt(await sp.assemble({agent,scope:agent}))}
const setting=body=>api('/cc/settings.json',body,'PUT')
const rule=(key,text)=>api('/cc/'+key+'.json',{text},'PUT')
const policy=body=>api('/cc/policy',body)
try{
  let view=await api('/cc/policy?sessionId=A')
  check('内置预设齐全且当前会话初始跟随全局',view.presets.length===3 && Object.keys(view.session.overrides).length===0)
  check('无真实请求时不冒充已经验证',!(await api('/cc/diagnostics?sessionId=A')).lastRequest)
  await setting({gateEnabled:true,ponytailEnabled:false,shapeEnabled:false,pinBlur:8})
  const original='# 原始自定义\n保留这份中文规则与 {{字面量}}。\n'
  await rule('gate',original)
  const builtHistory=await api('/cc/history?key=gate')
  check('首次编辑记录内置原文',builtHistory.history.length===1 && builtHistory.history[0].source==='builtin')
  view=await policy({action:'create',name:'我的写作',scope:'global'})
  const mine=view.presets.find(p=>p.name==='我的写作')
  check('自定义预设保存当前组合',!!mine && !mine.builtin)
  check('预设同名有明确拒绝', (await policy({action:'create',name:'我的写作',scope:'global'})).status===400)
  check('拒绝错误范围而非默默改全局',(await policy({action:'create',name:'错误',scope:'unknown'})).status===400)
  await policy({action:'rename',id:mine.id,name:'我的工作流'})
  check('可以重命名自定义预设',(await api('/cc/policy')).presets.some(p=>p.name==='我的工作流'))
  check('内置预设不能删除',(await policy({action:'delete',id:'builtin:daily'})).status===400)

  let preview=await policy({action:'preview',id:'builtin:code',scope:'global'})
  check('预览同时提供开关和正文差异',preview.changes.find(r=>r.key==='gate').diff.changed && preview.changes.find(r=>r.key==='ponytail').after===true)
  await setting({gateEnabled:false})
  check('过期预览不能覆盖新设置',(await policy({action:'apply',id:preview.id,scope:'global',revision:preview.revision})).status===400)
  preview=await policy({action:'preview',id:'builtin:code',scope:'global'})
  await setting({pinBlur:21})
  check('只改外观不会使规则预览失效',(await policy({action:'apply',id:preview.id,scope:'global',revision:preview.revision})).ok)
  check('应用预设不改变外观配置',(await api('/cc/settings.json')).settings.pinBlur===21)
  check('内置预设真正还原内置正文',(await api('/cc/gate.json')).gate.source==='builtin')
  preview=await policy({action:'preview',id:mine.id,scope:'global'})
  await policy({action:'apply',id:mine.id,scope:'global',revision:preview.revision})
  check('自定义预设恢复保存的原文（含原始花括号）',await fs.readFile(path.join(root,'dsh-cache-control/gate.md'),'utf8')===original)
  check('真实提示词组装使用消毒后的规则',(await prompt('A')).includes('｛｛字面量｝｝'))

  await rule('gate','版本乙，保留这份即将清除的规则。')
  await rule('gate','')
  const history=(await api('/cc/history?key=gate')).history
  const saved=history.find(item=>item.reason==='回到内置规则')
  const detail=await api('/cc/history?key=gate&id='+saved.id)
  check('清除自定义前保存原文并可查看差异',detail.history.text.includes('版本乙') && detail.history.diff.changed)
  await api('/cc/history',{action:'restore',key:'gate',id:saved.id})
  check('历史恢复真正影响后续请求',(await prompt('A')).includes('版本乙'))
  const count=(await api('/cc/history?key=gate')).history.length
  await rule('gate','版本乙，保留这份即将清除的规则。')
  check('重复保存相同内容不制造历史垃圾',(await api('/cc/history?key=gate')).history.length===count)
  check('历史路径不能越界',(await api('/cc/history?key=gate&id=../../settings')).status===400)

  await policy({action:'session',sessionId:'A',key:'gate',enabled:false})
  check('当前会话关闭规则后，其他会话和子会话仍用全局',!(await prompt('A')).includes('版本乙') && (await prompt('B')).includes('版本乙') && (await prompt('A-child')).includes('版本乙'))
  check('会话单独设置不改全局磁盘开关',(await api('/cc/settings.json')).settings.gateEnabled===true)
  preview=await policy({action:'preview',id:mine.id,scope:'session',sessionId:'A'})
  await policy({action:'apply',id:mine.id,scope:'session',sessionId:'A',revision:preview.revision})
  await rule('gate','全局已经是第三版。')
  check('会话预设使用自己的正文快照，不串到其他会话',(await prompt('A')).includes('原始自定义') && !(await prompt('A')).includes('第三版') && (await prompt('B')).includes('第三版'))
  await policy({action:'session',sessionId:'A',key:'gate',enabled:null})
  check('单段跟随全局同时取消正文快照',(await prompt('A')).includes('第三版'))
  await policy({action:'session',sessionId:'A',reset:true})
  check('一键恢复跟随全局会清除全部会话覆盖',Object.keys((await api('/cc/policy?sessionId=A')).session.overrides).length===0)
  check('非法会话标识不能污染对象或全局',(await policy({action:'session',sessionId:'__proto__',key:'gate',enabled:true})).status===400)
  check('没有会话不能应用会话预设',(await policy({action:'preview',id:mine.id,scope:'session'})).status===400)

  const hook=events.get('llm/stream'), passthrough={untouched:true}
  const request={sessionId:'A',messages:[{role:'system',content:[{type:'text',text:await prompt('A')}]}]}
  check('生效探针不改请求，也不吞下游返回值',hook(request,()=>passthrough)===passthrough && request.messages.length===1)
  let diagnostic=await api('/cc/diagnostics?sessionId=A')
  check('实际系统消息包含规则才算验证成功',diagnostic.requestProbe && diagnostic.lastRequest.current && diagnostic.lastRequest.rules.gate.status==='present')
  await rule('gate','全局第四版。')
  diagnostic=await api('/cc/diagnostics?sessionId=A')
  check('修改规则后旧请求证据标为过期',diagnostic.lastRequest.current===false)
  hook({sessionId:'A',messages:[{role:'user',content:await prompt('A')}]},()=>passthrough)
  check('用户正文中的规则不能冒充系统提示词生效',(await api('/cc/diagnostics?sessionId=A')).lastRequest.rules.gate.status==='missing')
  const serialized=JSON.stringify(await api('/cc/diagnostics?sessionId=A'))
  check('诊断结果不保存会话正文',!serialized.includes('全局第四版') && !serialized.includes('messages'))
  await setting({shapeEnabled:true});process.env.DSH_OUTPUT_SHAPE_DISABLE='1'
  check('会话覆盖不能越过输出形状环境禁用开关',!(await prompt('A')).includes('# 输出形状'))
  delete process.env.DSH_OUTPUT_SHAPE_DISABLE

  const analyzed=analyzeRules({gate:{enabled:true,text:'回答尽量简短，只给结论而无需解释。\n相同要求必须在所有场景认真执行。'},ponytail:{enabled:true,text:'请详细解释每一步并充分展开理由。\n相同要求必须在所有场景认真执行。'},shape:{enabled:false,text:'disabled'}})
  check('负担检查识别重复与常见篇幅冲突',analyzed.warnings.some(w=>w.kind==='duplicate') && analyzed.warnings.some(w=>w.kind==='conflict'))
  check('成本估算不把关闭的规则算进去',analyzed.bytes===Buffer.byteLength('回答尽量简短，只给结论而无需解释。\n相同要求必须在所有场景认真执行。请详细解释每一步并充分展开理由。\n相同要求必须在所有场景认真执行。') && analyzed.note.includes('不是实测或计费值'))
  check('否定要求与代码示例不误判为冲突',analyzeRules({gate:{text:'不要详细解释或展开这段内容。\n```\n请详细解释所有内容并展开。\n```\n回答尽量简短，始终只给结论。'}}).warnings.length===0)
  check('文本差异保留新增和删除内容',ruleDiff('a\nold\nz','a\nnew\nz').removed==='old' && ruleDiff('a\nold\nz','a\nnew\nz').added==='new')
  await policy({action:'delete',id:mine.id})
  check('删除预设不改变已生效规则',(await prompt('B')).includes('全局第四版'))

  // A persisted journal simulates a process exiting halfway through a preset.
  const beforeSettings=(await api('/cc/settings.json')).settings
  const files={gate:'gate.md',ponytail:'ponytail.md',shape:'shape.md'},journal={settings:beforeSettings,rules:{}}
  for(const [key,file]of Object.entries(files)){
    let override=null;try{override=await fs.readFile(path.join(root,'dsh-cache-control',file),'utf8')}catch{}
    journal.rules[key]={override}
  }
  await fs.writeFile(path.join(root,'dsh-cache-control/policy-transaction.json'),JSON.stringify(journal))
  await fs.writeFile(path.join(root,'dsh-cache-control/gate.md'),'中断后的混合状态')
  await host.policy.recover()
  check('中断事务恢复原规则与开关',(await prompt('A')).includes('全局第四版') && (await api('/cc/settings.json')).settings.gateEnabled===beforeSettings.gateEnabled)

  // Inject one settings write failure after rule files have changed; rollback must
  // restore every rule and the old configuration and release the frozen snapshot.
  const isolated=path.join(root,'rollback'), files2={}
  await fs.mkdir(path.join(isolated,'dsh-cache-control'),{recursive:true})
  for(const key of ['gate','ponytail','shape']){
    const builtin=path.join(isolated,key+'-builtin.md'),override=path.join(isolated,'dsh-cache-control',key+'.md')
    await fs.writeFile(builtin,'builtin '+key);await fs.writeFile(override,'original '+key)
    files2[key]={builtin,override:()=>override}
  }
  let settings2={gateEnabled:true,ponytailEnabled:false,shapeEnabled:false}, frozen=null,failOnce=true
  const manager=createPolicyManager({home:()=>isolated,files:files2,readSettings:async()=>settings2,
    writeSettings:async next=>{if(failOnce){failOnce=false;throw Error('simulated disk failure')}settings2=next},
    mutate:fn=>fn(),freeze:value=>frozen=value,invalidateRule(){},expectedRules(){return {gate:'',ponytail:'',shape:''}}})
  const plan=await manager.preview('builtin:code','global')
  let failed=false;try{await manager.action({action:'apply',scope:'global',id:'builtin:code',revision:plan.revision})}catch{failed=true}
  check('多文件写入失败回滚全部规则并解除冻结',failed && frozen===null && settings2.ponytailEnabled===false && await fs.readFile(files2.gate.override(),'utf8')==='original gate' && await fs.readFile(files2.shape.override(),'utf8')==='original shape')
  console.log(`${passed} passed, 0 failed`)
}finally{
  await new Promise(resolve=>server.close(resolve))
  await fs.rm(root,{recursive:true,force:true})
}
