// 直接在你正在跑的 GUI 里量：chip 在不在、祖先谁在裁、面板 portal 到哪儿、点开后中心点是不是它自己。
// 用法: node cc-probe.cjs [url]
const { spawn } = require('node:child_process')
const http = require('node:http')
const crypto = require('node:crypto')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL0 = process.argv[2] || 'http://127.0.0.1:62208'
const port = 9543 + Math.floor(Math.random() * 300)

const wget = (p, path) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: p, path }, (r) => { let d = ''; r.on('data', (c) => { d += c }); r.on('end', () => res(d)) }).on('error', rej)
})

const PROBE = `(() => {
  const out = { url: location.href, title: document.title };
  const chip = document.querySelector('[data-cache-control-toggle]');
  out.segs = [...document.querySelectorAll('.cc-seg')].map(e => e.textContent.trim());
  out.caret = !!document.querySelector('.cc-caret');
  if (!chip) {
    out.chip = false;
    out.bodyText = (document.body && document.body.innerText || '').replace(/\\s+/g,' ').slice(0, 160);
    out.hasComposer = !!document.querySelector('textarea, [contenteditable], [class*="composer" i]');
    return JSON.stringify(out);
  }
  out.chip = true;
  const r = chip.getBoundingClientRect();
  out.rect = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  out.viewport = { w: innerWidth, h: innerHeight };
  out.chipHitTest = (() => { const h = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2); return h ? ((h.className||'')+'').slice(0,40) : null; })();
  // 祖先链上所有会造成裁剪/接管 fixed 包含块的层
  const chain = []; let n = chip.parentElement;
  while (n && n !== document.documentElement) {
    const cs = getComputedStyle(n);
    const clipped = cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
    const takesFixed = cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none'
      || cs.contain !== 'none' || /transform|filter|backdrop/.test(cs.willChange || '');
    if (clipped || takesFixed) chain.push({
      cls: ((n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className) || n.tagName+'').slice(0, 46),
      overflow: cs.overflowX + '/' + cs.overflowY,
      rect: Math.round(n.getBoundingClientRect().height) + 'h',
      transform: cs.transform === 'none' ? '' : cs.transform.slice(0, 18),
      contain: cs.contain === 'none' ? '' : cs.contain,
      willChange: cs.willChange === 'auto' ? '' : cs.willChange,
    });
    n = n.parentElement;
  }
  out.clippingAncestors = chain;
  return JSON.stringify(out);
})()`

const CLICK = `(() => {
  const c = document.querySelector('.cc-caret');
  if (!c) return 'no-caret';
  if (c.disabled) return 'caret-disabled';
  c.click();
  return 'clicked';
})()`

const PANEL = `(() => {
  const p = document.querySelector('[data-cache-control-panel]');
  const out = {};
  out.panelPresent = !!p;
  if (!p) { out.bodyChildPanels = [...document.body.children].map(e => (e.className||e.tagName)+'').slice(0,30); return JSON.stringify(out); }
  out.parentIsBody = p.parentElement === document.body;
  out.parentClass = ((p.parentElement.className)||'') + '';
  const r = p.getBoundingClientRect();
  out.rect = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) };
  out.fullyInsideViewport = r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
  out.clippedByOwnBox = p.scrollHeight > p.clientHeight + 1;
  // 标题行下方 40px 处（就是上次被裁掉的位置）现在命中的是谁
  const head = p.querySelector('.cc-panelHead');
  const hr = head.getBoundingClientRect();
  const probeY = Math.min(hr.bottom + 12, innerHeight - 1);
  const hit = document.elementFromPoint(r.left + r.width / 2, probeY);
  out.hitUnderHead = hit ? (((hit.className||'')+'').slice(0, 40)) : null;
  out.hitInsidePanel = !!(hit && p.contains(hit));
  out.textSample = (p.innerText || '').replace(/\\s+/g, ' ').slice(0, 120);
  out.sections = [...p.querySelectorAll('.cc-sectTitle')].map(e => e.textContent.trim());
  out.sliders = p.querySelectorAll('input[type="range"]').length;
  out.switches = p.querySelectorAll('input[type="checkbox"]').length;
  out.computedPosition = getComputedStyle(p).position;
  return JSON.stringify(out);
})()`

async function main() {
  const log = (m) => {
    const line = '[probe] ' + m + '\n'
    try { require('node:fs').appendFileSync(__dirname + '\\cc-probe.log', line) } catch {}
    process.stderr.write(line)
  }
  require('node:fs').writeFileSync(__dirname + '\\cc-probe.log', '=== run ' + new Date().toISOString() + ' ===\n')
  const fs = require('node:fs')
  log('chrome 路径存在: ' + fs.existsSync(CHROME) + '  url=' + URL0)
  const userDir = process.env.TEMP + '\\cdp_cc_' + crypto.randomBytes(4).toString('hex')
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--remote-allow-origins=*', '--window-size=1440,900',
    '--remote-debugging-port=' + port, '--user-data-dir=' + userDir, 'about:blank',
  ], { stdio: 'ignore' })
  chrome.on('error', (e) => log('spawn error ' + e.message))
  chrome.on('exit', (code) => log('chrome exit ' + code))
  log('spawned pid=' + chrome.pid + ' port=' + port)
  let list = null
  for (let i = 0; i < 24; i++) {
    try { list = JSON.parse(await wget(port, '/json')); log('devtools ready 第 ' + (i + 1) + ' 次轮询'); break }
    catch (e) { if (i === 3) log('前 4 次轮询失败: ' + e.message); await new Promise((r) => setTimeout(r, 250)) }
  }
  if (!list) { log('devtools 未就绪，放弃'); chrome.kill(); process.exit(1) }
  const wsUrl = (list.find((t) => t.type === 'page') || list[0]).webSocketDebuggerUrl.replace(/ws:\/\/[^/]+/, 'ws://127.0.0.1:' + port)
  log('typeof WebSocket=' + typeof global.WebSocket + '  wsUrl=' + wsUrl)

  const ws = new global.WebSocket(wsUrl)
  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    let msg
    try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')) }
    catch { return }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) p.rej(new Error(msg.error.message)); else p.res(msg.result)
    } else if (msg.method === 'Runtime.exceptionThrown') {
      log('页内异常: ' + JSON.stringify(msg.params).slice(0, 220))
    }
  })
  const send = (method, params) => new Promise((res, rej) => {
    const id = ++seq
    const t = setTimeout(() => { pending.delete(id); rej(new Error('CDP 超时 10s: ' + method)) }, 10000)
    pending.set(id, { res: (v) => { clearTimeout(t); res(v) }, rej: (e) => { clearTimeout(t); rej(e) } })
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false })
    if (r.exceptionDetails) throw new Error('页内异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
  const J = (s) => JSON.parse(s)
  const show = (label, o) => {
    const txt = label + '\n' + JSON.stringify(o, null, 1)
    console.log('\n— ' + txt)
    log(txt)
  }

  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ws open 超时 12s')), 12000)
    ws.addEventListener('open', () => { clearTimeout(t); res() })
    ws.addEventListener('error', (e) => { clearTimeout(t); rej(new Error('ws error ' + (e && e.message))) })
  })
  process.stderr.write('[probe] ws open\n')
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: URL0 })
  process.stderr.write('[probe] navigated，等 6s 渲染\n')
  await new Promise((r) => setTimeout(r, 6000))

  const a = J(await evaluate(PROBE))
  show('chip 与裁剪祖先', a)
  if (a.chip) {
    console.log('\ncaret click → ' + await evaluate(CLICK))
    await new Promise((r) => setTimeout(r, 700))
    show('展开后的面板', J(await evaluate(PANEL)))
    // 再点一次收起，确认不留下 body 上的残节点
    await evaluate(`(() => { const c=document.querySelector('.cc-caret'); if(c&&!c.disabled) c.click(); return 'x' })()`)
    await new Promise((r) => setTimeout(r, 500))
    show('收起后', J(await evaluate(`(() => ({
      stillOpen: !!document.querySelector('[data-cache-control-panel]'),
      bodyStrays: [...document.body.children].map(e => ((e.className)||e.tagName)+'').filter(s => /cc-panel/.test(s)),
    }))()`)))
  }
  chrome.kill()
  process.exit(0)
}
main().catch((e) => {
  const msg = 'ERR ' + (e && e.message) + '\n' + (e && e.stack || '')
  try { require('node:fs').appendFileSync(__dirname + '\\cc-probe.log', msg + '\n') } catch {}
  console.log(msg)
  process.exitCode = 1
})
