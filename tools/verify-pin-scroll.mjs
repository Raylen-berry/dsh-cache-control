// 验证 ⑤ 钉顶 × 滚轮 × 回答限高的回归（2026-09-30）。
// 症状：长提问被钉顶后滚轮"一顿一顿、划不上去"。
// 四个根因（都在 client.js，改回去就红）：
//   ① 滚动回调直调 applyPin()：每个 scroll 事件跑一次 O(提问数) 强制布局
//   ② fitUserBubbles() 同样挂在 scroll 上：对每条提问做「读几何→写宽度→再读几何」
//   ③ pinTarget 里 `node = row` 漏 var（隐式全局）
//   ④ 滚轮无条件 scrollTop += deltaY 后 preventDefault（会话到边时吃掉滚轮、抢滚动位）
// 另加 v1.16.1 的回答气泡限高（比例于视口、开关可控）与合并器的行为断言。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath as __f2p, pathToFileURL as __p2u } from 'node:url';

const __here = path.dirname(__f2p(import.meta.url));
const PLUGIN = __pathResolve('../');
function __pathResolve(rel) { return path.resolve(__here, rel); }

const SRC = fs.readFileSync(path.join(PLUGIN, 'client.js'), 'utf8');
const HOST = fs.readFileSync(path.join(PLUGIN, 'index.js'), 'utf8');
const PKG = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'package.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')) }
};

/** 按大括号配对截取函数体（函数声明与 `name = function () {` 赋值式都认；跳过字符串/注释）。 */
const grabFn = (name) => {
  let i = SRC.indexOf('function ' + name + '(');
  if (i < 0) { const eq = SRC.indexOf(name + ' = function'); if (eq >= 0) i = SRC.indexOf('function', eq) }
  if (i < 0) return '';
  const open = SRC.indexOf('{', i);
  if (open < 0) return '';
  let depth = 0, k = open, str = '', esc = false, line = false, block = false;
  for (; k < SRC.length; k++) {
    const c = SRC[k], nx = SRC[k + 1];
    if (line) { if (c === '\n') line = false; continue }
    if (block) { if (c === '*' && nx === '/') { block = false; k++ } continue }
    if (str) { if (esc) { esc = false; continue } if (c === '\\') { esc = true; continue } if (c === str) str = ''; continue }
    if (c === '/' && nx === '/') { line = true; k++; continue }
    if (c === '/' && nx === '*') { block = true; k++; continue }
    if (c === '"' || c === "'" || c === '`') { str = c; continue }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { k++; break } }
  }
  return SRC.slice(i, k);
};

console.log('\n— ① 滚动不得直调 applyPin（改为 rAF 合并器）—');
const scrollHandler = grabFn('fitScrollHandler');
const resizeHandler = grabFn('fitResizeHandler');
const hasBareApplyPin = (body) => /applyPin\(\)/.test(body.replace(/requestApplyPin\(\)/g, ''));
ok('fitScrollHandler 走 requestApplyPin()', /requestApplyPin\(\)/.test(scrollHandler) && !hasBareApplyPin(scrollHandler));
ok('fitResizeHandler 走 requestApplyPin()', /requestApplyPin\(\)/.test(resizeHandler) && !hasBareApplyPin(resizeHandler));
ok('requestApplyPin 用 rAF 门闩合并', /if \(pinFrame\) return/.test(grabFn('requestApplyPin')) && /requestAnimationFrame/.test(grabFn('requestApplyPin')));
ok('MutationObserver 也走合并器', /new MutationObserver\(function \(\) \{ requestApplyPin\(\) \}\)/.test(SRC));

console.log('\n— ② 滚动期间不得全量贴合（一顿一顿的另一个根因）—');
ok('noteScrolling 存在且滚动回调首句就调它', /function noteScrolling\(\)/.test(SRC) && /fitScrollHandler = function \(\) \{\s*noteScrolling\(\)/.test(SRC));
ok('requestFit 滚动中只记账', /if \(isScrolling\) \{ fitDirtyWhileScrolling = true; return \}/.test(grabFn('requestFit')));
ok('静默后补一次 + stopFitWatch 清理计时器', /scrollIdleTimer = setTimeout\(/.test(grabFn('noteScrolling')) && /scrollIdleTimer/.test(grabFn('stopFitWatch')));

console.log('\n— ③ pinTarget 不得有隐式全局 —');
const pinTarget = grabFn('pinTarget');
ok('声明了 var node = row', /var node = row/.test(pinTarget));
ok('没有裸 node = row', !/[^r] node = row/.test(pinTarget.replace('var node = row', '')));

console.log('\n— ④ 滚轮只在真能滚时才接管 —');
const wheel = grabFn('pinWheelHandler');
const hand = grabFn('handOffToScroller');
ok('handOffToScroller 存在且两条分支都经它判定', hand.length > 0 && (wheel.match(/handOffToScroller\(/g) || []).length === 2);
ok('preventDefault 以"已接管"为条件', /if \(handOffToScroller\([\s\S]*?\)\) e\.preventDefault\(\)/.test(wheel));
ok('会话到顶/到底不再接管', /sc\.scrollTop >= scMax - 1\) return false/.test(hand) && /sc\.scrollTop <= 0\) return false/.test(hand));
ok('无增量/无余量直接放弃', /scMax <= 0\) return false/.test(hand) && /!\(dy > 0 \|\| dy < 0\)\) return false/.test(hand));

console.log('\n— ⑤ 回答气泡限高：v1.16.6 起默认关（界面已撤，字段保留）—');
ok('host 默认 **关** + 45vh', /outputCapEnabled: false/.test(HOST) && /outputCapVh: 45/.test(HOST));
ok('host 区间常量 15–80 与白名单保留', /OUTPUT_CAP_VH_MIN = 15/.test(HOST) && /OUTPUT_CAP_VH_MAX = 80/.test(HOST) && /outputCapEnabled, outputCapVh/.test(HOST));
ok('client 默认 **关** + 45vh', /outputCapEnabled: false/.test(SRC) && /outputCapVh: 45/.test(SRC));
ok('client 钳制 15–80', /Math\.min\(80, Math\.max\(15, v\)\)/.test(grabFn('clampOutputCapVh')));
ok('缺字段时判为关（与新生效口径一致）', /if \(s\.outputCapEnabled !== undefined\) patch\.outputCapEnabled = s\.outputCapEnabled !== false/.test(SRC));
ok('CSS 能力仍在（手动开启即可用）', /\[data-cc-output="1"\]\{max-height:min\(var\(--cc-output-max-vh,45vh\)/.test(SRC));
ok('标记只打在"有气泡且无提问行"的 flow item 上', /var hasUser = el\.querySelector\('\[class\*="_userRow"\]'\)/.test(grabFn('applyOutputCap')) && /if \(on && !hasUser && !marked\)/.test(grabFn('applyOutputCap')));
ok('clearFit 摘掉全部标记', /querySelectorAll\('\[data-cc-output\]'\)/.test(grabFn('clearFit')));
// 只看**界面字符串**是否还在渲染路径里（注释里提到历史不算）
ok('界面已撤掉回答限高的开关/滑杆', !/Switch\('限制回答气泡高度/.test(SRC) && !/'回答气泡最高'/.test(SRC) && !/'回答气泡限高（v1\.16\.1）'/.test(SRC));

console.log('\n— ⑥ 钉顶气泡宽度比例（v1.16.2）—');
ok('host 默认 55（= 改前写死的 .55）', /pinWidthPct: 55/.test(HOST));
ok('host 区间常量 30–100', /PIN_WIDTH_PCT_MIN = 30/.test(HOST) && /PIN_WIDTH_PCT_MAX = 100/.test(HOST));
ok('host sanitize 钳制并回写', /pinWidthPct = Math\.min\(PIN_WIDTH_PCT_MAX/.test(HOST) && /pinWidthPct,/.test(HOST));
ok('client 默认 55 + 钳制 30–100', /pinWidthPct: 55/.test(SRC) && /Math\.min\(100, Math\.max\(30, v\)\)/.test(grabFn('clampPinWidthPct')));
ok('旧盘缺键时 clamp 落到 55（不改变既有观感）', /if \(!Number\.isFinite\(v\) \|\| v <= 0\) v = 55/.test(grabFn('clampPinWidthPct')));
ok('只在缺字段时表态（不冲掉 host 读回的值）', /if \(s\.pinWidthPct !== undefined\) patch\.pinWidthPct/.test(SRC));
ok('applyAppearance 写 --cc-pin-width-pct', /setProperty\('--cc-pin-width-pct'/.test(grabFn('applyAppearance')));
ok('宽度滑杆 setter 立即生效并落盘', /clampPinWidthPct\(v\)/.test(grabFn('setPinWidthPct')) && /scheduleSave\(\{ pinWidthPct:/.test(grabFn('setPinWidthPct')));
ok('行不再是 fit-content+max-width 的组合（那组合会把行先夹死，见 v1.16.7）',
  !/width:fit-content !important;max-width:min\(calc\(var\(--dsh-chat-content-width,748px\) \* \.55\)/.test(SRC));

console.log('\n— ⑦ 右对齐复位 + 提问气泡限高（v1.16.3）—');
ok('行规则显式补 text-align:right（宿主靠 flex 对齐，改 block 后会失效）', /_userRow"\]\{display:block !important;text-align:right !important/.test(SRC));
ok('stack 右对齐（margin-left:auto）+ 骨架在 CSS 里',
  /_userStack"\]\{display:block !important;min-width:0 !important;width:fit-content !important;text-align:right !important;margin-left:auto !important/.test(SRC));
ok('气泡自身也右对齐兜底，文本仍左对齐', /_bubble"\]\{text-align:left !important;margin-left:auto !important;margin-right:0 !important\}/.test(SRC));
ok('钉顶几何自检已加入设置页（判定看气泡右缘差，不再误判 margin:auto）',
  /function readPinGeometry\(\)/.test(SRC) && /钉顶几何：/.test(SRC)
  && /气泡右缘差=/.test(SRC) && /这才是居中成因/.test(SRC));
ok('底衬量的是可见气泡宽度（不再含图标轨道）',
  /var bubble = row && row\.querySelector \? row\.querySelector\('\[class\*="_bubble"\]'\) : null/.test(grabFn('updatePinPlate'))
  && /var target = bubble \|\| stack \|\| row/.test(grabFn('updatePinPlate')));
ok('host 默认开 + 40vh', /userCapEnabled: true/.test(HOST) && /userCapVh: 40/.test(HOST));
ok('host 区间常量 15–80', /USER_CAP_VH_MIN = 15/.test(HOST) && /USER_CAP_VH_MAX = 80/.test(HOST));
ok('host sanitize 钳制并回写', /userCapVh = Math\.min\(USER_CAP_VH_MAX/.test(HOST) && /userCapEnabled, userCapVh/.test(HOST));
ok('client 默认开 + 40vh', /userCapEnabled: true/.test(SRC) && /userCapVh: 40/.test(SRC));
ok('client 钳制 15–80 且默认 40', /Math\.min\(80, Math\.max\(15, v\)\)/.test(grabFn('clampUserCapVh')) && /v = 40/.test(grabFn('clampUserCapVh')));
ok('旧盘缺键判为开', /if \(s\.userCapEnabled !== undefined\) patch\.userCapEnabled = s\.userCapEnabled !== false/.test(SRC));
ok('CSS 属性驱动限高 + 内部滚 + 视口兜底（v1.16.6 起作用在整条消息与 stack，覆盖图片）',
  /html\[data-cc-user-cap="1"\] \[class\*="_userRow"\],html\[data-cc-user-cap="1"\] \[class\*="_userRow"\] > \[class\*="_userStack"\]\{max-height:min\(var\(--cc-user-cap-vh,40vh\), calc\(100vh - var\(--dsh-composer-height,152px\) - 24px\)\);overflow-y:auto;overscroll-behavior:contain/.test(SRC)
  && /html\[data-cc-user-cap="1"\] \[class\*="_userRow"\] \[class\*="_bubble"\]\{max-height:none;overflow:visible\}/.test(SRC));
ok('applyAppearance 设属性与变量，且关掉时摘属性', /if \(s\.userCapEnabled !== false\) el\.setAttribute\('data-cc-user-cap', '1'\); else el\.removeAttribute\('data-cc-user-cap'\)/.test(grabFn('applyAppearance')) && /setProperty\('--cc-user-cap-vh'/.test(grabFn('applyAppearance')));
ok('开关/滑杆 setter 立即生效并落盘', /scheduleSave\(\{ userCapEnabled:/.test(grabFn('setUserCapEnabled')) && /scheduleSave\(\{ userCapVh:/.test(grabFn('setUserCapVh')));

console.log('\n— ⑧ v1.16.6/1.16.7：钉顶右对齐 + 宽度不再被锁死 —');
ok('钉顶态对行再做一次右对齐（**后代**选择器：钉顶元素下垫了一层无 class 的 div，`>` 会整条漏掉）', /html\[data-cc-pin-last-user="1"\] \[data-cc-pin="1"\] \[class\*="_userRow"\]\{margin-left:auto !important;margin-right:0 !important;text-align:right !important;max-width:none !important/.test(SRC));
ok('钉顶态对 stack 再做一次（不再写 width:auto，长度归 JS 量）', /\[data-cc-pin="1"\] \[class\*="_userRow"\] \[class\*="_userStack"\]\{margin-left:auto !important;margin-right:0 !important;text-align:right !important\}/.test(SRC) && !/\[class\*="_userStack"\]\{margin-left:auto !important;margin-right:0 !important;text-align:right !important;width:auto !important\}/.test(SRC));
ok('钉顶态对气泡再做一次', /\[class\*="_userStack"\] \[class\*="_bubble"\]\{margin-left:auto !important;margin-right:0 !important;text-align:left !important\}/.test(SRC));
// v1.16.17（用户第十三轮实测）：钉顶元素（flowItem）下先垫了一层**无 class 的 div**，
// 行是它的孙子 ⇒ 原来那几条 `[data-cc-pin="1"] > [class*="_userRow"]` **从来没匹配上**
// （本机 row.matches(...) === false 已确认）。这条锁死"不许再回到直接子选择器"。
ok('钉顶规则不许再用 `>` 直接子选择器（行是钉顶元素的孙子）',
  !/\[data-cc-pin="1"\] > \[class\*="_user/.test(SRC.replace(/^[ \t]*\/\/.*$/gm, '')));
ok('钉顶元素不再按列宽百分比夹（那会连行一起夹死）', !/\[data-cc-pin="1"\]\{max-width:min\(calc\(var\(--dsh-chat-content-width,748px\) \* var\(--cc-pin-width-pct/.test(SRC));
// v1.16.8：线上实测"钉顶那层自己"被那条 em 保险夹到 688px（列 1476）⇒ 行再 auto 也只能贴到列中间。
// 这条断言把它锁死：钉顶那层必须是无上限的满宽车道 —— 任何宽度上限都不许写在它身上。
ok('钉顶那层没有任何宽度上限（width:auto + max-width:none）',
  /\[data-cc-pin="1"\]\{width:auto !important;max-width:none !important;min-width:0 !important\}/.test(SRC));
ok('旧的 em"保险"上限已删（它就是三轮没修好的真凶）',
  !/\[data-cc-pin="1"\]\{max-width:calc\(var\(--cc-user-bubble-max,41em\) \+ 2em\)\}/.test(SRC));
ok('JS 也把钉顶那层写成满宽车道（inline + important，不赌选择器命中）',
  /function pinLane\(pick\)/.test(SRC) && /pick\.style\.setProperty\(k, want\[k\], 'important'\)/.test(grabFn('pinLane'))
  && /var want = \{ width: 'auto', 'max-width': 'none', 'min-width': '0' \}/.test(grabFn('pinLane')));
ok('stopPinWatch / 换条时撤掉 pinLane 的 inline 痕迹', /clearPinLane\(prev\[i\]\)/.test(grabFn('stopPinWatch'))
  && /function clearPinLane\(pick\)/.test(SRC) && /clearPinLane\(prevList\[i4\]\)/.test(grabFn('applyPin')));
ok('applyPin 幂等：摘旧的时保留本轮 pick（不抖一帧）', /if \(prevList\[i4\] === pick\) continue/.test(grabFn('applyPin')));
ok('提问限高覆盖整条消息（含图片），不只气泡', /html\[data-cc-user-cap="1"\] \[class\*="_userRow"\],\s*html\[data-cc-user-cap="1"\] \[class\*="_userRow"\] > \[class\*="_userStack"\]\{max-height:min\(var\(--cc-user-cap-vh,40vh\)/.test(SRC));

console.log('\n— ⑨ v1.16.7：宽度"先量自然宽、再由 CSS 夹"（修内联宽自锁 192px）—');
const nat = grabFn('naturalBubbleWidth');
const fit = grabFn('fitUserBubbles');
ok('新增 naturalBubbleWidth：量的是不受当下折行影响的自然宽',
  nat.length > 0 && /width:max-content;max-width:none/.test(nat) && /innerHTML = bubble\.innerHTML/.test(nat));
ok('量完就把探针盒摘掉（不留孤儿节点）', /finally \{/.test(nat) && /removeChild\(box\)/.test(nat));
ok('fitUserBubbles 用自然宽算目标宽', /natural = naturalBubbleWidth\(bubble\)/.test(fit) && /target = natural \+ Math\.ceil\(padL \+ padR \+ fitGutter\)/.test(fit));
ok('量自然宽有缓存（文字/包含块宽变了才重量）', /fitNaturalCache/.test(SRC) && /natRec\.text !== textSig \|\| natRec\.colW !== baseW/.test(fit));
ok('量不到自然宽时退回旧的"最宽一行"口径', /l0 = lines0\[0\]\.left, r0 = lines0\[0\]\.right/.test(fit));
ok('想要的宽度没变就不动 DOM（只刷新签名）', /if \(stack\.style\.width === nextW\)/.test(fit) && /data-cc-fit/.test(fit));
ok('旧的"溢出才摘内联宽"补丁已删（治症不治因）', !/if \(applied && bubble\.scrollWidth > bubble\.clientWidth \+ 2\)/.test(SRC));
// v1.16.17：宽度上限写成 **CSS 变量**（--cc-cap-user / --cc-cap-pin），由 CSS 选择器决定谁生效。
// 理由（本机滚动采样实测）：钉顶标记滚动中每帧都可能换行，而 inline 值"谁也抢不过" ⇒
// 上线要等下一次 JS 贴合才刷新，实测差 1–2 帧：pin=1 却按提问宽度渲染，停下后再跳回钉顶宽度。
ok('普通/钉顶两条上限都写成变量，各自读自己的滑杆',
  /function applyStackCap\(stack, colW\)/.test(SRC)
  && /'--cc-cap-user': Math\.round\(cw \* clampUserWidthPct\(STORE\.state\.userWidthPct\) \/ 100\) \+ 'px'/.test(grabFn('applyStackCap'))
  && /'--cc-cap-pin': Math\.round\(cw \* clampPinWidthPct\(STORE\.state\.pinWidthPct\) \/ 100\) \+ 'px'/.test(grabFn('applyStackCap')));
ok('不再写 inline max-width，撤除时两个变量一起摘',
  !/setProperty\('max-width', next, 'important'\)/.test(grabFn('applyStackCap'))
  && /removeProperty\('--cc-cap-user'\)/.test(grabFn('clearStackCap'))
  && /removeProperty\('--cc-cap-pin'\)/.test(grabFn('clearStackCap')));
ok('通用规则消费 --cc-cap-user、钉顶规则消费 --cc-cap-pin',
  /\[class\*="_userStack"\]\{[^}]*max-width:var\(--cc-cap-user,none\) !important\}/.test(SRC)
  && /\[data-cc-pin="1"\]\[data-cc-pin-top="1"\] \[class\*="_userStack"\]\{max-width:var\(--cc-cap-pin,/.test(SRC));
// v1.16.12（用户第八轮）：两个滑杆曾共用 --cc-user-width-pct ⇒「提问气泡宽度」实际在控钉顶，
// 普通提问气泡反而没有 UI 可调。现在钉顶那条走自己的 --cc-pin-width-cap。
ok('钉顶那条有**独立**的宽度上限来源 --cc-cap-pin / --cc-pin-width-cap（两个滑杆各管各的）',
  /\[data-cc-pin="1"\]\[data-cc-pin-top="1"\] \[class\*="_userStack"\]\{max-width:var\(--cc-cap-pin, calc\(var\(--cc-col-w, var\(--dsh-chat-content-width,748px\)\) \* var\(--cc-pin-width-cap/.test(SRC)
  && /setProperty\('--cc-pin-width-cap', clampPinWidthPct\(s\.pinWidthPct\)/.test(grabFn('applyAppearance')));
ok('钉顶上限只压在栈上（不压在钉顶元素/行上，避免重演"父盒被夹窄 ⇒ auto 边距失效"）',
  !/\[data-cc-pin="1"\]\{[^}]*max-width:calc\(var\(--cc-col-w/.test(SRC));
// v1.16.13/1.16.15（用户第九、十一轮）：那条"最近提问"被钉住 ⇒ 命中两条规则，两个滑杆都写它一个。
// **不能用 `:not(后代选择器)` 排除**：那是 Selectors L4，DSH 内嵌的 Electron 解析不了、整条规则被丢弃
// （线上指纹：row w25 + stack w1169 + marginL:0）。现在靠"钉顶规则更靠后 + 特异性更高 + 属性写全"覆盖。
ok('通用规则**不含** :not(带后代组合器)（Electron 会整条丢弃，1.16.15 踩过）',
  // 注释里会写"曾经用过这个写法"（那是给人看的线索），所以只查**去掉注释后的 CSS/代码**。
  !/:not\([^)]*[\s>+~][^)]*\)/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')));
// v1.16.17：两条规则都带 !important，谁是生效的那份由**特异性**决定
// （钉顶选择器多一个 [data-cc-pin] ⇒ 更高，不用再靠"后写一条覆盖前一条"）。
// v1.16.19：钉顶口径再收一道 —— 只有 [data-cc-pin-top="1"]（真的顶在上沿）才吃钉顶宽度。
ok('钉顶宽度规则带 !important、特异性高于通用规则，且只认"已贴顶"那条',
  /html\[data-cc-pin-last-user="1"\] \[data-cc-pin="1"\]\[data-cc-pin-top="1"\] \[class\*="_userStack"\]\{max-width:var\(--cc-cap-pin[^}]*!important\}/.test(SRC));
// v1.16.17（用户第十三轮）：滑杆只改 CSS 变量，而各条上限是 JS 量完写下去的 ——
// startFitWatch() 在观察器已挂时是空操作（`if (!domReady() || fitObserver) return`），
// 所以拖滑杆必须显式排一次贴合，否则"变量变了、DOM 上的上限没变 ⇒ 界面纹丝不动"。
ok('滑杆改动会显式重排贴合与钉顶重算（不然拖了没反应）',
  /requestFit\(\); if \(s\.pinLastUser\) requestApplyPin\(\)/.test(grabFn('applyAppearance')));
// 行/栈被「提问气泡最高」夹住时，里面气泡的「钉顶气泡最高」拉过它也看不出变化。
ok('钉顶那条不吃「提问气泡最高」（高度由钉顶滑杆单独管，且只限已贴顶那条）',
  /html\[data-cc-user-cap="1"\] \[data-cc-pin="1"\]\[data-cc-pin-top="1"\] \[class\*="_userRow"\],html\[data-cc-user-cap="1"\] \[data-cc-pin="1"\]\[data-cc-pin-top="1"\] \[class\*="_userStack"\]\{max-height:none;overflow:visible\}/.test(SRC));
// v1.16.19（用户第十五轮）：① 兜底钉住的那条（最新一条但没贴顶）不许吃钉顶口径；
// ② 滚动手势期间不换钉（换钉会改宽高 ⇒ 会话重排 ⇒ "慢慢划时闪烁、划不动"），静默后补一次。
ok('只有"真的顶在上沿"才打 [data-cc-pin-top]（兜底钉住的那条要摘掉它）',
  /var atTop = !!pick/.test(grabFn('applyPin'))
  && /if \(atTop\) pick\.setAttribute\(APPEAR_ATTRS\.top, APPEAR_ATTRS\.on\)/.test(grabFn('applyPin'))
  && /else pick\.removeAttribute\(APPEAR_ATTRS\.top\)/.test(grabFn('applyPin'))
  && /removeAttribute\(APPEAR_ATTRS\.top\)/.test(grabFn('stopPinWatch')));
ok('滚动手势进行中维持现有那条、不换钉（静默后再补一次重选）',
  /if \(isScrolling\) \{/.test(grabFn('applyPin'))
  && /var held = document\.querySelector\('\[\' \+ APPEAR_ATTRS\.pin/.test(grabFn('applyPin'))
  && /pinLane\(held\)/.test(grabFn('applyPin'))
  && /if \(STORE\.state\.pinLastUser\) requestApplyPin\(\)/.test(grabFn('noteScrolling')));
// v1.16.19（用户第十五轮："图片不够透明，想淡化图片露出底下的壁纸/文字"）。
ok('钉顶气泡里的图片按 --cc-img-fade 淡出（只动 opacity，不动尺寸）',
  /\[data-cc-pin="1"\] \[class\*="_bubble"\] img/.test(SRC)
  && /\[class\*="_bubble"\] video\{opacity:var\(--cc-img-fade,1\) !important\}/.test(SRC));
ok('设置页有「钉顶图片不透明度」滑杆，且写变量、落盘（0 是合法档位，不能被当成缺键）',
  /'钉顶图片不透明度'/.test(SRC) && /setImgFade\(Number\(e\.target\.value\)\)/.test(SRC)
  && /setProperty\('--cc-img-fade', clampImgFade\(s\.imgFade\) \/ 100/.test(grabFn('applyAppearance'))
  && /if \(!Number\.isFinite\(v\)\) v = 100/.test(grabFn('clampImgFade')));
// v1.16.18（用户第十四轮："两个都拉满了提问/钉顶气泡左右都不宽"）：fitUserBubbles 里那个
// **给自然宽缓存当键用的**包含块宽原来也叫 colW，而 var 是函数级作用域 ⇒ 第一圈迭代跑完就把
// "整轮量一次的会话列宽"覆盖成"某一行包含块宽 / 栈自身宽"，第 2..N 圈的 applyStackCap 拿到的
// 就是这个被压扁的值。线上读数：列宽 1476、两条滑杆都 100%，栈上限却是 **167px**。
ok('宽度上限的基数恒为会话列宽：循环里不许再有第二个 colW（缓存键改用 baseW）',
  (grabFn('fitUserBubbles').match(/var colW/g) || []).length === 1
  && /applyStackCap\(stack, colW\)/.test(grabFn('fitUserBubbles'))
  && /var baseW = 0/.test(grabFn('fitUserBubbles'))
  && /natRec\.colW !== baseW/.test(grabFn('fitUserBubbles')));
ok('host 默认 58 + 区间 30–100 + 缺键钳到 58',
  /userWidthPct: 58/.test(HOST) && /USER_WIDTH_PCT_MIN = 30/.test(HOST) && /USER_WIDTH_PCT_MAX = 100/.test(HOST)
  && /userWidthPct = Math\.min\(USER_WIDTH_PCT_MAX/.test(HOST));
ok('client 默认 58 + 钳制 30–100 + 滑杆 setter 落盘',
  /userWidthPct: 58/.test(SRC) && /if \(!Number\.isFinite\(v\) \|\| v <= 0\) v = 58/.test(grabFn('clampUserWidthPct'))
  && /scheduleSave\(\{ userWidthPct:/.test(grabFn('setUserWidthPct')));
ok('设置页有「提问气泡宽度」滑杆', /'提问气泡宽度'/.test(SRC) && /setUserWidthPct\(Number\(e\.target\.value\)\)/.test(SRC));
ok('几何自检多打宽度实测（上限/内容宽/栈内联宽）',
  /宽度: 提问气泡上限=/.test(SRC) && /栈内联宽=/.test(SRC));
ok('几何自检多打"钉顶车道"（w/列宽/maxW/minW，v1.16.8 的真凶就在这层）',
  /钉顶车道: w=/.test(SRC) && /maxW=' \+ pcs\.maxWidth/.test(SRC));

console.log('\n— ⑩ v1.16.9：模糊滑杆幂分布 + 宽度基数改成会话区 + 钉顶气泡也磨砂 —');
const posPx = grabFn('blurPosToPx');
const pxPos = grabFn('blurPxToPos');
ok('blurPosToPx 是幂曲线 24×(pos/100)^2.5（不是线性）',
  /24 \* Math\.pow\(p \/ 100, 2\.5\)/.test(posPx) && /if \(p <= 0\) return 0/.test(posPx));
ok('blurPxToPos 是反函数 100×(px/24)^0.4', /100 \* Math\.pow\(b \/ 24, 0\.4\)/.test(pxPos) && /if \(b <= 0\) return 0/.test(pxPos));
// 分布数值：小值灵敏、大值钝。跑真函数（不是抄公式）。
const clampBlurForTest = (v) => { v = Math.round(Number(v) * 10) / 10; if (!Number.isFinite(v)) v = 10; return Math.min(24, Math.max(0, v)) }
const mkFn = (name) => new Function('clampBlur', 'with (this) { ' + grabFn(name) + '; return ' + name + ' }').call({ clampBlur: clampBlurForTest })
const p2x = mkFn('blurPosToPx'), x2p = mkFn('blurPxToPos')
const stepAvg = (from, to) => {
  let s = 0
  for (let p = from; p < to; p++) s += p2x(p + 1) - p2x(p)
  return s / (to - from)
}
const loStep = stepAvg(0, 10), midStep = stepAvg(45, 55), hiStep = stepAvg(90, 100)
ok('每格步进：小值区 < 中段 < 大值区（且大值区 ≈0.5px/格）',
  loStep < midStep && midStep < hiStep && Math.abs(hiStep - 0.51) < 0.12,
  [loStep, midStep, hiStep].map((x) => x.toFixed(3)).join(' / '))
ok('端点与单调性：p0=0、p100=24、全程递增',
  p2x(0) === 0 && p2x(100) === 24 && (() => { for (let p = 1; p <= 100; p++) if (!(p2x(p) > p2x(p - 1) - 1e-9)) return false; return true })(),
  'p10=' + p2x(10) + ' p50=' + p2x(50) + ' p90=' + p2x(90))
ok('位置↔像素来回换算不漂（旧盘上的 px 值能显示到滑杆上）',
  [0, 0.5, 1, 3, 10, 24].every((b) => Math.abs(p2x(x2p(b)) - b) <= 0.6),
  [0, 1, 10, 24].map((b) => b + '→pos' + x2p(b) + '→' + p2x(x2p(b))).join(' '))
ok('滑杆改成位置 0–100（不再是 0–24 的线性档）',
  /type: 'range', min: '0', max: '100', step: '1'/.test(SRC) && /setPinBlur\(blurPosToPx\(Number\(e\.target\.value\)\)\)/.test(SRC));
ok('新增 measureWidthVars：量会话区与**消息列**宽，写 --cc-area-w / --cc-col-w',
  /function measureWidthVars\(\)/.test(SRC) && /querySelector\('\[data-conversation-scroll\]'\)/.test(grabFn('measureWidthVars'))
  && /querySelector\('\[class\*="_column"\]'\)/.test(grabFn('measureWidthVars'))
  && /setVar\('--cc-col-w', colW\)/.test(grabFn('measureWidthVars'))
  && /setVar\('--cc-area-w', areaW\)/.test(grabFn('measureWidthVars')));
ok('气泡宽度基数是 --cc-col-w（**消息列**：列宽已含「对话页宽度」%，两个设置于是相乘）',
  /var\(--cc-cap-pin, calc\(var\(--cc-col-w, var\(--dsh-chat-content-width,748px\)\)/.test(SRC));
ok('底衬兜底宽度也用 --cc-col-w', /--cc-col-w, var\(--dsh-chat-content-width,748px\)\) \* \.55 \+ \.8em\)/.test(SRC));
ok('v1.16.10：41em 那条第二上限彻底删掉（它让 100% 也只到 645px）',
  !/cc-user-bubble-max|USER_BUBBLE_MAX_EM/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')));
ok('applyAppearance 与 resize 都重新量宽度基数',
  /measureWidthVars\(\)/.test(grabFn('applyAppearance')) && /measureWidthVars\(\)/.test(grabFn('fitResizeHandler')));
ok('「对话页宽度」变更后也量一次（列宽变了 ⇒ 气泡基数跟着变 = 两个设置相乘）',
  /measureWidthVars\(\)/.test(grabFn('pinChatWidth')));
ok('设置页读数写成「% 会话列」（不是会话区，避免再误读基数）',
  /'% 会话列'/.test(SRC) && !/'% 会话区'/.test(SRC));
// v1.16.14（用户第十轮"交接时闪烁、滚轮划不动"）：滚动每帧重采两层毛玻璃代价极高，
// 所以钉顶气泡那层**不再叠第二个 backdrop-filter**，只用半透明底色（糊字交给底衬那层）。
ok('钉顶气泡只有半透明底色，不再叠第二层 backdrop-filter（滚动开销减半）',
  /\[data-cc-pin="1"\] \[class\*="_bubble"\]\{'/.test(SRC)
  && /background:var\(--cc-pin-bubble-bg/.test(SRC)
  && !/backdrop-filter:blur\(calc\(var\(--cc-pin-blur,10px\) \* \.7\)\)/.test(SRC));
// v1.16.14：钉顶范围要"可迁移 + 适配桌面上下高度" ⇒ 两件事取小，且默认从 38vh 提到 45vh
ok('钉顶高度上限 = min(用户 vh, 视口高 − 输入卡 − 24px)（比例/实测，无写死像素）',
  /max-height:min\(var\(--cc-pin-max-vh,45vh\), calc\(100vh - var\(--dsh-composer-height,152px\) - 24px\)\)/.test(SRC));
ok('默认 45vh（旧盘缺键 / 非法值都落到 45）',
  /pinMaxVh: 45/.test(SRC) && /if \(!Number\.isFinite\(v\)\) v = 45/.test(grabFn('clampPinMaxVh'))
  && /pinMaxVh: 45/.test(HOST));
ok('底衬透明度从 58% 降到 46%（用户要看到壁纸）',
  /color-mix\(in srgb,var\(--dsw-alias-bg-layer-1,#202024\) 46%,transparent\)/.test(SRC));
ok('「气泡透明」开关开着时钉顶气泡的磨砂底让路（否则盖掉露壁纸）',
  /\[data-cc-clear-bubble="1"\] \[data-cc-pin="1"\] \[class\*="_bubble"\]\{--cc-pin-bubble-bg:transparent\}/.test(SRC));
ok('轨道宽变量改名 --cc-tail-room-px（修 calc 里 em 单位拼接的隐患）',
  /--cc-tail-room-px/.test(SRC) && !/setProperty\('--cc-tail-room',/.test(SRC));

console.log('\n— ⑥ peerDependencies 覆盖 0.2.x —');
const range = PKG.peerDependencies && PKG.peerDependencies['@deepseek-ai/dsh-host-webserver'];
ok('范围 >=0.1.2-alpha.1 <0.3.0', range === '>=0.1.2-alpha.1 <0.3.0', String(range));

console.log('\n— ⑦ 行为：合并器在无 rAF 环境必须同步兜底 —');
const rafSrc = grabFn('requestApplyPin');
const applied = [];
new Function('s', 'with (s) { ' + rafSrc + '; return requestApplyPin }')({
  pinFrame: 0, applyPin: () => applied.push(1), warnOnce: () => {}, requestAnimationFrame: undefined,
})();
ok('无 requestAnimationFrame 时同步执行', applied.length === 1, 'called=' + applied.length);
const pushed = [];
const sb = { pinFrame: 0, applyPin: () => pushed.push(1), warnOnce: () => {}, requestAnimationFrame: (fn) => { sb.__fn = fn; return 7 } };
const req = new Function('s', 'with (s) { ' + rafSrc + '; return requestApplyPin }')(sb);
req(); req(); req();
ok('同帧三次调用只排一次', sb.pinFrame === 7 && pushed.length === 0);
sb.pinFrame = 0; sb.__fn();
ok('帧回调执行一次并清句柄', pushed.length === 1 && sb.pinFrame === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exitCode = fail === 0 ? 0 : 1;
