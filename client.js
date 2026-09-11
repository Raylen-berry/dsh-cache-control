// ============================================================================
// dsh-cache-control · Client half
//
// 设置页四块互相独立的开关（名称都压到 2–4 字，细节写在卡片正文里）：
//   * 省缓存 —— 改写 standard preset 的 compaction 参数
//     （保存后作用于"之后新建的会话"）。
//   * 会话守则 —— 把 session-gate.md 常驻注入 system prompt
//     （每个 model step 重新组装，故对已打开的会话下一步即生效，且不被压缩稀释）。
//   * 气泡置顶 —— 最近一条「我的提问」钉顶（圆角矩形毛玻璃底衬随这条提问的实际长度
//     伸缩，长文限高 38vh、滚轮在气泡内滚，模糊度可调）、我的气泡透明。
//   * 对话页 —— 固定会话宽度（原 bg-atelier「底图工坊 · 对话页」区，2026-09-07 移入）。
// 各块互不隶属：面板里各自一条开关，各说各的生效语义。
//
// 仿 dsh-bg-atelier 的 __ModuleLoader__ 封装；状态经 host HTTP 接口读写。
// ============================================================================

window.__ModuleLoader__.load({
  id: 'dsh-cache-control',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var h = React.createElement
    // react-dom 是平台 seed 词（seed 表：react / react/jsx-runtime / react-dom /
    // react-dom/client / cordis / dsh-client-store / dsh-client-ui-slots /
    // dsh-client-ui-primitives）。取不到只是没有 portal，不影响开关本身，故软失败。
    var ReactDOM = null
    try { ReactDOM = require('react-dom') } catch (e) { ReactDOM = null }
    var PANEL_WIDTH = 302
    /**
     * 我的提问气泡宽度上限，单位 **em**（相对会话字号）：文字不到就一直贴文字，到此为止。
     * 41em ≈ 15px 字号下的 615px；字号或页面缩放变了上限跟着变，不是钉死的像素数。
     */
    var USER_BUBBLE_MAX_EM = 41
    // 离线夹具用：让 chip 首帧就是展开态（React.useState 的初始值），
    // 省掉按 hook 调用次序猜哪个是 open —— 那种断言一改代码就假失败。
    var FORCE_OPEN = false
    // ▾ 双击/重复点击防抖: 两次 click 会"开→立刻关", 表现就是"点不开"。
    var caretLastAt = 0
    // 设置页各卡「说明」抽屉默认收起; 测试缝 (internals.setFoldsOpen) 可让默认展开。
    var FOLD_DEFAULT_OPEN = false

    var styles = {
      insert: function (css) {
        var el = document.createElement('style')
        el.type = 'text/css'
        el.setAttribute('data-cache-control-styles', '1')
        el.textContent = css
        document.head.appendChild(el)
        return function () { if (el.parentNode) el.parentNode.removeChild(el) }
      },
    }

    // ------------------------------------------------------------ 页面样式 --
    var CSS = [
      '.cc-page{display:flex;flex-direction:column;gap:18px;max-width:680px}',
      '.cc-h{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);margin:0 0 4px}',
      '.cc-sub{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0 0 10px;line-height:1.7}',
      '.cc-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:12px}',
      '.cc-row{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.cc-row input[type=range]{flex:1;min-width:120px;accent-color:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.cc-val{min-width:118px;text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:pre}',
      '.cc-note{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.7;border-left:2px solid var(--dsw-alias-brand-primary,#4d6bfe);padding-left:10px}',
      '.cc-err{font-size:12px;color:var(--dsw-alias-label-danger,#e5534b)}',
      '.cc-ok{font-size:12px;color:var(--dsw-alias-label-success,#2da44e)}',
      '.cc-muted{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.cc-path{font-size:11px;color:var(--dsw-alias-label-tertiary);word-break:break-all;line-height:1.6}',
      '.cc-tag{display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.cc-tag.warn{border-color:var(--dsw-alias-label-warning,#b8860b);color:var(--dsw-alias-label-warning,#b8860b)}',
      '.cc-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);height:26px;padding:0 10px;border-radius:7px;font-size:12px;cursor:pointer}',
      '.cc-btn:hover{border-color:var(--dsw-alias-border-l3)}',
      '.cc-btn:disabled{opacity:.55;cursor:default}',
      // 常用宽度快捷按钮（④ 对话页）：与 cc-btn 同族但更矮更轻，选中态用品牌色描边
      '.cc-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}',
      '.cc-mini{border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));background:transparent;color:var(--dsw-alias-label-secondary);height:22px;padding:0 8px;border-radius:6px;font-size:11.5px;line-height:1;cursor:pointer;transition:border-color .12s,color .12s}',
      '.cc-mini:hover{border-color:var(--dsw-alias-border-l3)}',
      '.cc-mini.on{border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.cc-textarea{width:100%;box-sizing:border-box;min-height:220px;resize:vertical;font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:12px;line-height:1.65;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px}',
      // ---- 设置页「说明」抽屉: 默认收起, 点按钮才展开正文 (样式参照 ②门禁「编辑规则」的点开式) ----
      '.cc-fold{margin-top:6px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-l1,rgba(127,127,127,.25))}',
      '.cc-foldBtn{display:inline-flex;align-items:center;gap:4px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.5;cursor:pointer;padding:0;border-radius:4px}',
      '.cc-foldBtn:hover{color:var(--dsw-alias-label-primary)}',
      '.cc-foldBody{margin-top:8px;display:flex;flex-direction:column;gap:10px}',
      // ---- 输入工具条 chip（容器）+ 弹出面板（一个框，两个独立开关）----
      '.cc-chip{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));background:transparent;height:22px;color:var(--dsw-alias-label-primary);white-space:nowrap;border-radius:999px;align-items:center;gap:2px;padding:0 2px 0 4px;font-size:11.5px;line-height:1;display:inline-flex;transition:border-color .12s,color .12s,background-color .12s;position:relative;top:1.2px}',
      '.cc-chip.on{border-color:var(--dsw-alias-border-l3,rgba(127,127,127,.4))}',
      '.cc-chip .cc-dot{width:6px;height:6px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-tertiary);flex:none}',
      '.cc-chip .cc-dot.on{background:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.cc-chip .cc-chipState{opacity:.85}',
      // ---- chip 内每个可点段：点「省缓存」切压缩、点「提问」切门禁、点 ▾ 弹滑杆面板 ----
      '.cc-seg{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;border:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;line-height:1;height:20px;padding:0 5px;border-radius:999px;cursor:pointer;transition:background-color .12s}',
      '.cc-seg:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '.cc-seg:disabled{cursor:default;opacity:.55}',
      '.cc-seg .cc-segLabel{color:var(--dsw-alias-label-secondary)}',
      '.cc-seg.on .cc-segLabel{color:var(--dsw-alias-label-primary)}',
      '.cc-caret{display:inline-flex;align-items:center;justify-content:center;width:24px;height:22px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:1;border-radius:999px;cursor:pointer;transition:background-color .12s,color .12s}',
      '.cc-caret:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary)}',
      '.cc-caret:disabled{cursor:default;opacity:.55}',
      '.cc-div{width:1px;height:12px;background:var(--dsw-alias-border-l2,rgba(127,127,127,.3));flex:none}',
      '.cc-badge{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:15px;padding:0 5px;border-radius:4px;font-size:10.5px;line-height:1;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.08));color:var(--dsw-alias-label-tertiary)}',
      '.cc-badge.on{border-color:var(--dsw-alias-brand-primary,#4d6bfe);background:rgba(77,107,254,.14);color:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.cc-badge.dim{border-color:var(--dsw-alias-label-warning,#b8860b);background:rgba(184,134,11,.14);color:var(--dsw-alias-label-warning,#b8860b)}',
      // ---- 输入条右下角那枚 chip 里的「开 / 关」：不吃任何背景（用户 2026-09-07 要求）----
      // 面板里的同名徽标仍带底（那里有底色对比的需要），只有 chip 内这三条改纯透明；
      // 状态改由文字颜色区分：开=品牌蓝、关=三级灰、未装载=警示黄。
      '.cc-chip .cc-badge{background:transparent;border-color:transparent;padding:0 3px}',
      '.cc-chip .cc-badge.on{background:transparent;border-color:transparent;color:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.cc-chip .cc-badge.dim{background:transparent;border-color:transparent;color:var(--dsw-alias-label-warning,#b8860b)}',
      // ---- 2026 微调: 「省缓存/提问」与旁边的「开/关」不在同一水平线 ⇒ 标签下移、徽标做小、
      //      间距收紧。一律用 em（相对 chip 自己的字号），chip 字号变化/DPI 缩放时同步跟着走，
      //      而不是钉死 0.2px / 13px 这种一次性数值（面板、分区头里的同名徽标不受影响）。
      '.cc-chip .cc-seg{gap:.35em}',
      '.cc-chip .cc-segLabel{position:relative;top:.017em}',
      '.cc-chip .cc-badge{height:1.13em;min-width:.78em;font-size:.87em;border-radius:.26em}',
      '.cc-panel{z-index:2147483000;position:fixed;width:302px;box-sizing:border-box;max-height:calc(100vh - 24px);overflow:auto;overscroll-behavior:contain;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff)));color:var(--dsw-alias-label-primary);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.32);display:flex;flex-direction:column;gap:9px;padding:11px 12px;font-size:12px}',
      '.cc-panelHead{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:600}',
      '.cc-close{border:none;background:transparent;color:inherit;font-size:14px;line-height:1;cursor:pointer;padding:2px 5px;border-radius:4px}',
      '.cc-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}',
      '.cc-prow{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-primary)}',
      '.cc-prow label{min-width:64px;flex:none}',
      '.cc-prow input[type=range]{flex:1;min-width:0;accent-color:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.cc-prow .cc-val{min-width:56px;text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);font-size:11px;white-space:pre}',
      '.cc-sect{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-top:2px;padding-top:9px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.cc-sectTitle{font-weight:600;font-size:12px}',
      '.cc-sectHint{font-size:10.5px;color:var(--dsw-alias-label-tertiary)}',
      '.cc-gateMeta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.cc-gateBody{max-height:190px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 9px;font-size:11px;line-height:1.65;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;font-family:var(--dsw-font-mono,ui-monospace,monospace)}',
      // ---- 会话区外观（钉住最近提问 / 气泡透明）：由 <html> 上的 data-* 驱动 ----
      // 选择器按 CSS Module 的**后缀**匹配（前缀 uSmzmW_ 是构建哈希，会变）。
      'html[data-cc-clear-bubble="1"] [class*="_userRow"] [class*="_bubble"]{background:transparent !important;border-color:rgba(127,127,127,.26) !important;box-shadow:none !important}',
      // ---- 我的提问气泡（用户 2026）----
      // 块盒 + JS 量一次排版（inline 盒会让背景逐行着色、行内 padding 只落首末片段 ⇒ 框"超"到
      // 文字之外且不居中，已弃用）：
      //   ① stack.width = 最宽那一行 + 左右内边距 ⇒ 框贴住文字，硬上限 min(列宽×.55, --cc-user-bubble-max)；
      //   ② userRow 右缘预留一条 --cc-tail-room 宽的**轨道**，时间/复制行 absolute 落在轨道里
      //      （right:2px，不参与排版）⇒ 键在**气泡右侧**，纵向 --cc-tail-y 对齐到最后一行；
      //   ③ 上下 padding 对称(7px) ⇒ 文字在框内垂直居中；行距/字号沿用宿主不动。
      // 时间戳平时 opacity:0 仍占位 ⇒ 折成 0 宽，hover 才展开。
      // 宿主 CSS 可能后于插件注入, 同等特异性下会盖回来 ⇒ 一律抬 specificity 到 html 前缀
      // 并 !important。
      // 尺寸一律 em / 宿主自己的字号变量（跟随会话字号与页面缩放自适应）；只有"轨道宽"这种
      // 需要精确让位的量由 JS 量完写 --cc-tail-room，纵向对齐写 --cc-tail-y。
      'html [class*="_userRow"]{display:block !important;position:relative !important;box-sizing:border-box !important;width:-moz-fit-content !important;width:fit-content !important;max-width:min(calc(var(--dsh-chat-content-width,748px) * .55), var(--cc-user-bubble-max,41em)) !important;margin-left:auto !important;margin-right:0 !important;padding-right:var(--cc-tail-room,2.4em) !important}',
      'html [class*="_userRow"] [class*="_userStack"]{display:block !important;min-width:0 !important;max-width:100% !important}',
      // 上下 padding 对称(.47em)：单行/多行都垂直居中；圆角随字号走
      'html [class*="_userRow"] [class*="_bubble"]{display:block !important;padding:.47em .8em !important;border-radius:1.45em !important}',
      'html [class*="_userRow"] [class*="_actions"]{position:absolute !important;right:.13em !important;left:auto !important;top:var(--cc-tail-y, auto) !important;display:inline-flex !important;align-items:center !important;white-space:nowrap !important;margin:0 !important;gap:.13em !important}',
      // 图标尺寸用宿主的"字号 + 字号增量"变量算，而不是写死 22px
      'html [class*="_userRow"] [class*="_actions"] [class*="_action"]{width:calc(1.5em + var(--dsh-content-font-delta,0px)) !important;height:calc(1.5em + var(--dsh-content-font-delta,0px)) !important;border-radius:1.5em !important}',
      'html [class*="_userRow"] [class*="_actions"] [class*="_action"] svg{width:.95em !important;height:.95em !important}',
      // 宿主 Tooltip 的气泡是 JS 量位置后再绝对定位的；图标行被我们改成 absolute 之后参照系
      // 错位 ⇒ "复制" 会飘到远处。按用户要求：在**提问气泡的图标区**里直接不渲染它。
      // 只限这一处（别处消息/工具条的 tooltip 不受影响），按钮的 aria-label 保持可访问性。
      'html [class*="_userRow"] [class*="_actions"] [role="tooltip"]{display:none !important}',
      // 时间戳：不 hover 时零占位（否则它把复制键从气泡右侧挤开）；hover 展开的宽度也按字号
      'html [class*="_userRow"] [class*="_actions"] [class*="_timeStart"],html [class*="_userRow"] [class*="_actions"] [class*="_timeEnd"]{max-width:0 !important;padding:0 !important;overflow:hidden !important;white-space:nowrap !important}',
      'html [class*="_userRow"]:hover [class*="_actions"] [class*="_timeStart"],html [class*="_userRow"]:hover [class*="_actions"] [class*="_timeEnd"]{max-width:none !important;padding-left:.4em !important}',
      // ---- 钉住的那条：底衬改画在 ::before 上（用户 2026-09-07 改）----
      // 原先把"半透明 + backdrop-filter"直接铺在被钉住的整行上，而行宽 = 整个会话列宽，
      // 于是气泡左边那一大片空白也在模糊 —— 用户不要：左侧保持干净，只要**一段**
      // 的模糊，并且要是**圆角矩形**、模糊度可调。
      // 长度（用户 2026-09-08 第二次反馈改）：不再"定长"。JS 在钉住/重排时量出这条提问
      // 气泡（含图标轨道）的实际宽度写成 --cc-pin-w（再放 .8em 呼吸位），短句底衬就短；
      // 读不到几何时退回旧上限 min(会话内容宽 × .55, --cc-user-bubble-max) 兜底。
      // 高度（同次反馈）：长文本钉住时不再无限撑高——气泡本体 max-height 38vh，超出
      // 滚轮在气泡内滚（overscroll-behavior:contain，滚到底才交还给会话流）。
      // 行本身只留 sticky；::before 用 z-index:-1 —— 行自成堆叠上下文，
      // 负层因此落在"正文之上、气泡之下"，backdrop-filter 采到的正是身后滚过去的正文。
      //
      // z-index 6 → 500（2026-09-10，用户报"代码块顶栏【js…复制】压住置顶气泡第一行"，
      // 机制用真浏览器逐档扫描确认，见 out/report-zscan3.json）：
      //   · 代码块顶栏自己 position:sticky;top:0，吸附在**会话滚动容器**上 ⇒ 滚过高代码块时
      //     顶栏浮在视口顶端，正好落进顶部钉住区；
      //   · 顶栏与被钉提问分属不同 flow item、同处一个堆叠上下文 ⇒ 比 z-index，
      //     且 **z 相等时 DOM 靠后者（顶栏）赢**；
      //   · 扫 0/2/6/7/10/20/30/100 八档：z=6 时顶栏 z≥6 就压住气泡（= 用户看到的现象）；
      //     中途试过 20，仍被 z≥20 压住 ⇒ 只挪阈值不解决，必须显著高于一切正文 chrome。
      // 500 高于宿主正文里的全部层级（slot 6 / composer 7 / 回到底部 8 / 代码块与工具卡 chrome ≤100），
      // 且仍在会话子树内部，不会盖过 body 级 portal 出去的菜单、弹窗那类浮层。
      'html[data-cc-pin-last-user="1"] [data-cc-pin="1"]{position:sticky;top:0;z-index:500;will-change:transform}',
      'html[data-cc-pin-last-user="1"] [data-cc-pin="1"]::before{content:"";position:absolute;z-index:-1;'
        + 'top:-.13em;bottom:-.13em;right:-.4em;'
        + 'width:var(--cc-pin-w, calc(min(calc(var(--dsh-chat-content-width,748px) * .55), var(--cc-user-bubble-max,41em)) + .8em));'
        + 'max-width:calc(100% + .8em);'
        + 'border-radius:1.07em;'
        + 'background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#202024) 58%,transparent);'
        + '-webkit-backdrop-filter:blur(var(--cc-pin-blur,10px)) saturate(1.2);'
        + 'backdrop-filter:blur(var(--cc-pin-blur,10px)) saturate(1.2)}',
      // ---- 长提问的显示上限 + 气泡内滚轮 ----
      //   上限值不再是写死的 38vh：由 --cc-pin-max-vh 决定（设置页"钉顶气泡最高"滑杆），
      //   上限调高 = 钉住时能直接看到更多原文，代价是它挡住的身后内容也更多。
      //   槽宽（2026-09-10 用户反馈"右侧滑块极度不敏感"实测后改）：
      //   原来写 scrollbar-width:thin，Chromium 里这一属性只要不是 auto 就会**忽略**
      //   ::-webkit-scrollbar 的 width —— 宿主 dsh-client-ui-theme 那套 width:8px 的定制
      //   会一起失效，实得槽宽钉死在 ~10px 且槽底全透明，可抓的滑块极细。
      //   改成 auto + 自定 16px：外观仍是细条（4px 透明描边把"条"从 16px 视觉上收成 8px），
      //   但可抓范围翻倍。实测：thin=10px、auto+自定16px=16px。
      //   再加 scrollbar-gutter:stable（2026-09-10 同批）：长提问一超过 38vh 就出现滚动条、
      //   占掉内容宽 ⇒ 最后一行重折行，而折行又改签名触发下一轮量宽，来回抖动；reserve 提前
      //   把这条槽留出来，长度变化时排版不再跳。**代价**：这条槽无条件占 16px，所以下面
      //   fitUserBubbles() 量宽时必须补回来（否则短提问也会被凭空挤窄一行）。
      'html[data-cc-pin-last-user="1"] [data-cc-pin="1"] [class*="_bubble"]{max-height:min(var(--cc-pin-max-vh,38vh), calc(100vh - var(--dsh-composer-height,152px) - 24px));overflow-y:auto;overscroll-behavior:contain;scrollbar-width:auto;scrollbar-gutter:stable}',
      //   ↑ 高度封顶（2026-09-10 同批）：钉条现在 z-index:500 高于输入卡，若把「钉顶气泡最高」
      //   拉到很大就会压住底部输入卡。所以取"用户设的 vh"与"视口高 − 输入卡高 − 24px 呼吸位"
      //   的较小值：滑杆随便拉，钉条**永远够不到**输入卡。--dsh-composer-height 是宿主自己
      //   发布的输入卡高度变量，读不到时按 152px 兜底。
      'html[data-cc-pin-last-user="1"] [data-cc-pin="1"] [class*="_bubble"]::-webkit-scrollbar{width:16px}',
      'html[data-cc-pin-last-user="1"] [data-cc-pin="1"] [class*="_bubble"]::-webkit-scrollbar-thumb{border:4px solid transparent;background-clip:content-box;border-radius:8px}',
      // color-mix 不支持时退到固定半透明（Electron Chromium 都支持，这条只是保险）。
      '@supports not (color: color-mix(in srgb, white 50%, transparent)){'
        + 'html[data-cc-pin-last-user="1"] [data-cc-pin="1"]::before{background:rgba(32,32,36,.6)}}',
    ].join('\n')

    // ---------------------------------------------------------------- 状态 --
    var STORE = {
      state: {
        // 省缓存（压缩策略）
        enabled: false,
        triggerPct: 25,
        retainPct: 5,
        auto: true,
        loading: true,
        loaded: false,   // 是否成功从 host 读到过设置；未读到前禁止保存（否则会把默认值盖到用户的真实值上）
        saving: false,
        applied: null,
        error: '',
        triggerTokens: 0,
        retainTokens: 0,
        windowTokens: 1000000,
        // 会话门禁（长期规则）
        gateEnabled: false,
        gateSource: 'builtin',
        gateBuiltinPath: '',
        gateOverridePath: '',
        gateBytes: 0,
        gateMaxBytes: 6144,
        gateLines: 0,
        gateTruncated: false,
        gateText: '',
        gateOpen: false,
        gateDraft: null,
        gateSaving: false,
        gateError: '',
        // host 半没有 /cc/gate.json 时（旧版未重启）为 false：界面提示，不假装可用
        gateReady: true,
        // 会话区外观
        pinLastUser: false,
        clearBubble: false,
        pinBlur: 10,        // 钉顶底衬（圆角矩形毛玻璃）的模糊半径 px，0–24
        pinMaxVh: 38,       // 被钉气泡自身的最高高度（vh），12–80；超出部分在气泡内滚
        pinMarked: '',
        fitTick: 0,        // 「重读」按钮用的自增计数：只为触发一次重渲染去重新读实测值
        appearanceReady: true,
        // 对话页固定宽度（原 bg-atelier「底图工坊 · 对话页」区，移入本插件）
        chatWidth: 860,
        chatWidthEnabled: false,
      },
      listeners: [],
      set: function (patch) {
        var next = {}
        for (var k in this.state) next[k] = this.state[k]
        for (var p in patch) next[p] = patch[p]
        this.state = next
        for (var i = 0; i < this.listeners.length; i++) this.listeners[i]()
      },
      subscribe: function (fn) {
        this.listeners.push(fn)
        return function () {
          var i = this.listeners.indexOf(fn)
          if (i >= 0) this.listeners.splice(i, 1)
        }.bind(this)
      },
    }

    function useCache() {
      var pair = React.useState(0)
      var force = pair[1]
      React.useEffect(function () {
        return STORE.subscribe(function () { force(function (x) { return x + 1 }) })
      }, [])
      return STORE.state
    }

    function fmt(n) {
      n = Number(n) || 0
      return n >= 1000000 ? (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
        : n >= 1000 ? (n / 1000).toFixed(0) + 'k'
        : String(n)
    }

    function kb(n) {
      n = Number(n) || 0
      return n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B'
    }

    /** 钉顶底衬模糊半径：0–24px，保留 1 位小数（与 host 侧 sanitize 同口径，两端都钳一次）。 */
    function clampBlur(v) {
      v = Math.round(Number(v) * 10) / 10
      if (!Number.isFinite(v)) v = 10
      return Math.min(24, Math.max(0, v))
    }

    /** 被钉气泡最高高度：12–80 vh，取整（与 host 侧 sanitize 同口径，两端都钳一次）。 */
    function clampPinMaxVh(v) {
      v = Math.round(Number(v))
      if (!Number.isFinite(v)) v = 38
      return Math.min(80, Math.max(12, v))
    }

    function applyGate(g) {
      if (!g || (g.bytes === undefined && g.text === undefined)) return {}
      return {
        gateReady: true,
        gateSource: g.source || 'builtin',
        gateBuiltinPath: g.builtinPath || '',
        gateOverridePath: g.overridePath || '',
        gateBytes: Number(g.bytes) || 0,
        gateMaxBytes: Number(g.maxBytes) || 6144,
        gateLines: Number(g.lines) || 0,
        gateTruncated: !!g.truncated,
        gateText: typeof g.text === 'string' ? g.text : '',
        gateEnabled: g.enabled === undefined ? STORE.state.gateEnabled : !!g.enabled,
      }
    }

    /** settings.json 的响应可同时带 gate 元数据；res.settings 为空时只更新 gate。 */
    function pull(res) {
      var patch = applyGate(res && res.gate)
      var s = res && res.settings
      if (s) {
        patch.enabled = !!s.enabled
        patch.triggerPct = Number(s.triggerPct) || 25
        patch.retainPct = Number(s.retainPct) || 5
        patch.auto = s.auto !== false
        patch.gateEnabled = s.gateEnabled === true
        patch.pinLastUser = s.pinLastUser === true
        patch.clearBubble = s.clearBubble === true
        patch.pinBlur = clampBlur(s.pinBlur)
        patch.pinMaxVh = clampPinMaxVh(s.pinMaxVh)
        // 对话页固定宽度（bg-atelier 移入）：host 侧 sanitize 负责区间钳制
        patch.chatWidth = Number(s.chatWidth) > 0 ? Math.round(Number(s.chatWidth)) : 860
        patch.chatWidthEnabled = s.chatWidthEnabled === true
        // 旧 host 的 sanitize 不认识这些字段，任何一次写盘都会把它们抹掉 ⇒
        // 只有响应里真的带回来才算能力就绪，否则界面禁用这几项并说明原因。
        patch.appearanceReady = s.pinLastUser !== undefined && s.clearBubble !== undefined
          && s.pinBlur !== undefined && s.pinMaxVh !== undefined
          && s.chatWidth !== undefined && s.chatWidthEnabled !== undefined
        patch.loading = false
        patch.loaded = true
        patch.error = ''
        patch.applied = res.applied === undefined ? null : !!res.applied
        patch.triggerTokens = res.triggerTokens || 0
        patch.retainTokens = res.retainTokens || 0
        patch.windowTokens = res.windowTokens || 1000000
        // 旧版 host 的响应里没有 gate 字段 ⇒ 门禁能力未装载
        if (res.gate === undefined) patch.gateReady = false
      }
      STORE.set(patch)
      applyAppearance(STORE.state)
    }

    function load() {
      fetch('/cc/settings.json', { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json() })
        .then(pull)
        .catch(function (e) {
          STORE.set({ loading: false, error: '加载失败: ' + String(e) })
        })
    }

    var saveTimer = null
    function scheduleSave() {
      if (STORE.state.loading) return
      // 没成功读到过设置就不写盘：此刻 STORE 里是默认值，PUT 会把用户的真实参数盖掉。
      if (!STORE.state.loaded) {
        STORE.set({ error: '还没从宿主读到设置，已阻止保存（否则会用默认值盖掉你现在的配置）。刷新页面或重启桌面应用后重试。' })
        return
      }
      if (saveTimer) clearTimeout(saveTimer)
      STORE.set({ saving: true, error: '' })
      saveTimer = setTimeout(saveNow, 250)
    }
    function saveNow() {
      var s = STORE.state
      fetch('/cc/settings.json', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: s.enabled,
          triggerPct: s.triggerPct,
          retainPct: s.retainPct,
          auto: s.auto,
          gateEnabled: s.gateEnabled,
          pinLastUser: s.pinLastUser,
          clearBubble: s.clearBubble,
          pinBlur: s.pinBlur,
          pinMaxVh: s.pinMaxVh,
          chatWidth: s.chatWidth,
          chatWidthEnabled: s.chatWidthEnabled,
        }),
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j } }) })
        .then(function (res) {
          if (!res.ok || !res.j || res.j.ok !== true) {
            throw new Error((res.j && res.j.error) || ('http ' + (res.j && res.j.status)))
          }
          STORE.set({ saving: false, error: '', triggerTokens: res.j.triggerTokens, retainTokens: res.j.retainTokens })
          return fetch('/cc/settings.json', { cache: 'no-store' })
        })
        .then(function (r) { return r.json() })
        .then(function (res) {
          // 只回读同步状态，不动 gateDraft（可能正在编辑）。
          STORE.set({
            applied: res && res.applied === undefined ? null : !!res.applied,
            gateEnabled: res && res.gate ? res.gate.enabled === true : STORE.state.gateEnabled,
          })
        })
        .catch(function (e) {
          STORE.set({ saving: false, error: '保存失败: ' + String(e) })
        })
    }

    /** 写规则文本；text 为 '' 表示删除 override、回到插件内置。 */
    function saveGateText(text) {
      STORE.set({ gateSaving: true, gateError: '' })
      fetch('/cc/gate.json', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: text }),
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j } }) })
        .then(function (res) {
          if (!res.ok || !res.j || res.j.ok !== true) {
            throw new Error((res.j && res.j.error) || ('http ' + (res.j && res.j.status)))
          }
          STORE.set({ gateSaving: false, gateError: '', gateDraft: null })
          return fetch('/cc/gate.json', { cache: 'no-store' })
        })
        .then(function (r) { return r.json() })
        .then(function (res) { if (res && res.gate) pull({ settings: res.settings || null, gate: res.gate }) })
        .catch(function (e) {
          STORE.set({ gateSaving: false, gateError: '规则保存失败: ' + String(e) })
        })
    }

    function reloadGate() {
      fetch('/cc/gate.json', { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json() })
        .then(function (res) {
          if (!res || !res.gate) throw new Error('no gate payload')
          var g = res.gate
          STORE.set({
            gateSource: g.source, gateBuiltinPath: g.builtinPath || '', gateOverridePath: g.overridePath || '',
            gateBytes: Number(g.bytes) || 0, gateLines: Number(g.lines) || 0, gateText: g.text || '',
            gateTruncated: !!g.truncated, gateEnabled: g.enabled === true, gateDraft: null, gateError: '',
            gateReady: true,
          })
        })
        .catch(function (e) {
          var missing = /404|no gate payload|not found/i.test(String(e))
          STORE.set({
            gateReady: !missing,
            gateError: missing ? '会话守则接口不可用：需重启桌面应用装载新版 host 半（页面本身可能已刷新到新 client）' : '规则读取失败: ' + String(e),
          })
        })
    }

    // ------------------------------------------------------ 会话区外观引擎 --
    // 钉住"最近一条我的提问"：position:sticky 的移动量受**包含块（父级）**限制，
    // 若给内层 .userRow 上 sticky，它外层每条消息各自的包裹层没有剩余高度可走，
    // 就完全不动。所以运行时从气泡往上找，标记"滚动内容直接子元素"那一层。
    // CSS 侧只认 [data-cc-pin="1"]，且按 CSS Module 类名后缀匹配
    // （uSmzmW_ 这类前缀是构建哈希，不能硬编码）。
    var APPEAR_ATTRS = { pin: 'data-cc-pin', on: '1' }
    var pinObserver = null
    var pinFrame = 0
    /** 判定"这条提问已经越过会话区上沿"的容差 px（亚像素/缩放余量）。 */
    var PIN_TOP_EPS = 2
    /** 动态贴合时给图标行预留的高度 px（与 CSS 里 .cc-actions 按钮 22px 对齐）。 */
    var FIT_ICON_H = 22
    var fitScrollHandler = null
    var fitResizeHandler = null

    function domReady() {
      return typeof document !== 'undefined' && !!document.documentElement
        && typeof document.querySelector === 'function' && typeof MutationObserver !== 'undefined'
        && typeof requestAnimationFrame === 'function'
    }

    function scrollerFor(el) {
      if (el && el.closest) {
        var host = el.closest('[data-conversation-scroll]')
        if (host) return host
      }
      return document.querySelector('[data-conversation-scroll]')
    }

    /**
     * 从气泡往上找该上 sticky 的那一层。真实结构（读自 dsh-client-ui-chat 的产物，
     * 不是猜的）是：
     *   [data-conversation-scroll] > … > [data-chat-flow] > [data-chat-flow-key]
     *     > .userRow > .userStack > .bubble
     * sticky 的移动量 = 父级高度 − 自身高度，所以终点是"[data-chat-flow] 的直接子元素"
     * （每条消息一层）；给更内的 .userRow 上 sticky 会因为父级等高而完全不动。
     * 宿主不在（类名/属性改了）时退回"按剩余高度爬升"的通用判据。
     */
    function pinTarget(row) {
      var scroller = scrollerFor(row)
      var flow = row.closest ? row.closest('[data-chat-flow]') : null
      if (flow) {
        var node = row
        var hop = 0
        while (node.parentElement && hop++ < 8) {
          if (node.parentElement === flow) return node
          node = node.parentElement
        }
        return row
      }
      node = row
      var guard = 0
      while (node && node.parentElement && guard++ < 8) {
        var parent = node.parentElement
        if (parent === scroller || parent === document.body || parent === document.documentElement) return node
        var own = typeof node.offsetHeight === 'number' ? node.offsetHeight : 0
        var room = (typeof parent.offsetHeight === 'number' ? parent.offsetHeight : 0) - own
        if (room > 8) return node
        node = parent
      }
      return node && node !== scroller ? node : row
    }

    /**
     * 钉住条目的底衬宽度：量被钉行（含右侧图标轨道）的实际像素宽 + .8em 呼吸位，
     * 写进 --cc-pin-w（短句 ⇒ 短底衬）。量不到就清掉变量，退回 CSS 里的旧上限。
     */
    function updatePinPlate(pickEl) {
      try {
        if (!domReady()) return
        var pick = pickEl || document.querySelector('[' + APPEAR_ATTRS.pin + ']')
        if (!pick || !pick.style || !pick.style.setProperty) return
        var row = pick.querySelector ? pick.querySelector('[class*="_userRow"]') : pick
        var w = row && row.getBoundingClientRect ? row.getBoundingClientRect().width : 0
        if (!(w > 0)) { pick.style.removeProperty('--cc-pin-w'); return }
        var rootFont = 14
        try { rootFont = parseFloat(getComputedStyle(document.documentElement).fontSize) || 14 } catch (e) {}
        pick.style.setProperty('--cc-pin-w', Math.ceil(w + rootFont * 0.8) + 'px')
      } catch (e) { warnOnce('updatePinPlate', e) }
    }

    /**
     * 钉住哪一条 = "分节标题"语义，跟随滚动：取**顶边已越过会话区上沿**的最后一条提问。
     * 有 5 条提问时：滚到 4/5 之间（5 的顶边还在视口内）⇒ 钉 4；滚到底 ⇒ 钉 5；
     * 回到 3/4 之间 ⇒ 钉 3；刚进会话、没有任何提问越过上沿 ⇒ 不钉。
     * 拿不到几何（手搓 DOM / 老引擎）时退化为"最后一条"，与旧行为一致。
     */
    function applyPin() {
      if (!domReady()) return
      var rows
      try { rows = document.querySelectorAll('[class*="_userRow"]') } catch (e) { return }
      var prev = document.querySelectorAll('[' + APPEAR_ATTRS.pin + ']')
      for (var i = 0; i < prev.length; i++) prev[i].removeAttribute(APPEAR_ATTRS.pin)
      if (!rows.length) { if (STORE.state.pinMarked !== '') STORE.set({ pinMarked: '' }); return }
      var scroller = scrollerFor(rows[rows.length - 1])
      var limit = (scroller && scroller.getBoundingClientRect)
        ? scroller.getBoundingClientRect().top + PIN_TOP_EPS : null
      var pick = null
      if (limit !== null) {
        for (var j = 0; j < rows.length; j++) {
          var t = pinTarget(rows[j])
          if (!t || !t.setAttribute || !t.getBoundingClientRect) continue
          var r = t.getBoundingClientRect()
          if (!r) continue
          // 文档顺序遍历：最后一条"顶边已越过上沿"的就是要钉的
          if (r.top <= limit) pick = t
        }
      }
      // 一条都没越过上沿（会话很短 / 刚发完还没有长回答）时退回"钉最后一条"：
      // 底衬于是始终存在，模糊度滑杆看得见也调得动；滚出篇幅后自动回到分节标题语义。
      if (!pick) pick = pinTarget(rows[rows.length - 1])
      if (!pick || !pick.setAttribute) {
        if (STORE.state.pinMarked !== '') STORE.set({ pinMarked: '' })
        return
      }
      pick.setAttribute(APPEAR_ATTRS.pin, APPEAR_ATTRS.on)
      updatePinPlate(pick)
      // 自检文案用完整 class 串：真出问题时这是唯一能对着看的线索。
      var label = String(pick.className || pick.tagName).trim().replace(/\s+/g, ' ')
        + ' · 共 ' + rows.length + ' 条提问'
      if (STORE.state.pinMarked !== label) STORE.set({ pinMarked: label })
    }

    function startPinWatch() {
      if (!domReady() || pinObserver) return
      pinObserver = new MutationObserver(function () {
        if (pinFrame) return
        pinFrame = requestAnimationFrame(function () { pinFrame = 0; applyPin() })
      })
      pinObserver.observe(document.body, { childList: true, subtree: true })
      applyPin()
    }
    function stopPinWatch() {
      if (pinObserver) { pinObserver.disconnect(); pinObserver = null }
      if (pinFrame) { cancelAnimationFrame(pinFrame); pinFrame = 0 }
      if (!domReady()) return
      var prev = document.querySelectorAll('[' + APPEAR_ATTRS.pin + ']')
      for (var i = 0; i < prev.length; i++) prev[i].removeAttribute(APPEAR_ATTRS.pin)
      STORE.set({ pinMarked: '' })
    }

    /** 内联文本的逐行矩形（Range 客户端矩形，滤掉空矩形）。 */
    function lineBoxes(el) {
      var out = []
      try {
        var r = document.createRange()
        r.selectNodeContents(el)
        var rects = r.getClientRects()
        for (var i = 0; i < rects.length; i++) {
          var b = rects[i]
          if (b && b.width > 0 && b.height > 0) out.push({ left: b.left, right: b.right, top: b.top, bottom: b.bottom })
        }
      } catch (e) { /* 不支持就不做动态贴合, 走 CSS 上限兜底 */ }
      return out
    }

    /**
     * 气泡"贴文字"的唯一办法：CSS 里块盒的宽度与文字末端无关（块宽=可用宽），
     * 所以这里量一次真实排版再写回：
     *   ① stack.width = min(100%, 最宽行 + 左右内边距)  ⇒ 框贴住文字，列宽变窄自动夹回；
     *   ② 重写宽度后再量最后一行，把 --cc-tail-x/--cc-tail-y 指到**最后一个字之后**
     *      ⇒ 绝对定位的时间/复制行跟着字尾走。
     * 只处理纯文字气泡（含图片/JSON 块的原样不动）；用 data-cc-fit 记签名，避免流式输出时
     * 每帧重复排。返回本次处理条数（离线探针用来断言真的跑了）。
     */
    function fitUserBubbles() {
      if (typeof document === 'undefined' || !document.querySelectorAll || !document.createRange) return 0
      var rows
      try { rows = document.querySelectorAll('[class*="_userRow"]') } catch (e) { return 0 }
      var done = 0
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i]
        var stack = row.querySelector ? row.querySelector('[class*="_userStack"]') : null
        if (!stack || !stack.getBoundingClientRect || !stack.style) continue
        var bubble = stack.querySelector ? stack.querySelector('[class*="_bubble"]') : null
        if (!bubble || !bubble.getBoundingClientRect) continue
        // 只跳过"含图片/内嵌块"的气泡（那种量不准）。文字里带 @路径 渲染出的 <span> 子节点
        // 照常量 —— 上一版按 children.length>0 整条跳过，把带文件引用的提问全漏掉了，
        // 框宽就退回"块宽 = 上限"的固定观感（用户反馈的"完全不动态"正是这个）。
        if (bubble.querySelector && bubble.querySelector('img,video,canvas,svg:not([class*="_action"])')) continue
        var probe = lineBoxes(bubble)
        if (!probe.length) continue
        var baseLineH = probe[0].bottom - probe[0].top
        var hasBlock = false
        for (var pb = 1; pb < probe.length; pb++) {
          if ((probe[pb].bottom - probe[pb].top) > baseLineH * 1.8) { hasBlock = true; break }
        }
        if (hasBlock) continue
        var text = String(bubble.textContent || '')
        if (!text) continue
        var sr = stack.getBoundingClientRect()
        if (!sr || !sr.width) continue
        var applied = stack.style.width || ''
        var sig = text.length + '|' + Math.round(sr.width) + '|' + applied
        if (bubble.getAttribute && bubble.getAttribute('data-cc-fit') === sig) { done++; continue }
        var lines = probe
        if (!lines.length) continue
        var left = lines[0].left, right = lines[0].right
        for (var k = 1; k < lines.length; k++) {
          if (lines[k].left < left) left = lines[k].left
          if (lines[k].right > right) right = lines[k].right
        }
        var cs = typeof getComputedStyle === 'function' ? getComputedStyle(bubble) : null
        var padL = cs ? (parseFloat(cs.paddingLeft) || 0) : 12
        var padR = cs ? (parseFloat(cs.paddingRight) || 0) : 12
        // 被钉气泡开了 scrollbar-gutter:stable ⇒ 无论当前有没有滚动条，那条 16px 槽都已经
        // 从内容宽里扣掉了。量宽必须补回来，否则短提问也会被挤出多余的一行。
        // 只在真的开了 reserve 时补（其它气泡的滚动条不在排版内，量到多少就是多少）。
        var fitGutter = 0
        if (cs && /stable/.test(cs.scrollbarGutter || '')) {
          fitGutter = (bubble.offsetWidth || 0) - (bubble.clientWidth || 0)
          if (!(fitGutter > 0)) fitGutter = 0
        }
        var target = Math.ceil(right - left + padL + padR + fitGutter)
        if (target <= 0) continue
        // 用普通 px（不用百分比：shrink-to-fit 容器里百分比会绕回父宽）。
        // CSS 那边给了 _userStack{max-width:100%}，列宽变窄时自然夹回，签名变化后下一轮重算。
        stack.style.width = target + 'px'
        // 图标行：实测它的宽高 ⇒ 轨道宽 = 图标行宽 + 一点余量（跟着字号/DPI 走，不写死 34px），
        // 纵向 top 对齐到**最后一行**的中心（变量必须写在 row 上：图标是 row 的子节点，
        // 挂在 stack 上继承不到 —— 这是上一版复制键跑偏的直接原因）。
        lines = lineBoxes(bubble)
        if (!lines.length) continue
        var last = lines[lines.length - 1]
        var rr = row.getBoundingClientRect ? row.getBoundingClientRect() : stack.getBoundingClientRect()
        var acts = row.querySelector ? row.querySelector('[class*="_actions"]') : null
        var ar = acts && acts.getBoundingClientRect ? acts.getBoundingClientRect() : null
        var iconH = (ar && ar.height) ? ar.height : FIT_ICON_H
        var iconW = (ar && ar.width) ? ar.width : FIT_ICON_H
        if (row.style && row.style.setProperty) {
          row.style.removeProperty('--cc-tail-x')            // 横向改用 right 定位，旧变量不再需要
          row.style.setProperty('--cc-tail-room', Math.ceil(iconW + iconH * 0.45) + 'px')
          var tailY = Math.round(last.top - rr.top + (last.bottom - last.top - iconH) / 2)
          if (tailY < 0) tailY = 0
          var rowH = rr.height || 0
          if (rowH && tailY + iconH > rowH) tailY = Math.max(0, Math.round(rowH - iconH))
          row.style.setProperty('--cc-tail-y', tailY + 'px')
        }
        var sr3 = stack.getBoundingClientRect()
        if (bubble.setAttribute) {
          bubble.setAttribute('data-cc-fit', text.length + '|' + Math.round(sr3.width) + '|' + (stack.style.width || ''))
        }
        done++
      }
      updatePinPlate()   // 量完宽度顺手刷新底衬长度（短句贴短句）
      return done
    }

    /** 撤掉自家写的一切内联痕迹（停用/卸载时必须回到宿主原样）。 */
    function clearFit() {
      if (typeof document === 'undefined' || !document.querySelectorAll) return
      var rows
      try { rows = document.querySelectorAll('[class*="_userRow"]') } catch (e) { return }
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i]
        if (row.style && row.style.removeProperty) {
          row.style.removeProperty('--cc-tail-x')
          row.style.removeProperty('--cc-tail-y')
          row.style.removeProperty('--cc-tail-room')
        }
        var stack = row.querySelector ? row.querySelector('[class*="_userStack"]') : null
        if (!stack || !stack.style) continue
        stack.style.width = ''
        if (stack.style.removeProperty) {
          stack.style.removeProperty('--cc-tail-x')
          stack.style.removeProperty('--cc-tail-y')
        }
        var bubble = stack.querySelector ? stack.querySelector('[class*="_bubble"]') : null
        if (bubble && bubble.removeAttribute) bubble.removeAttribute('data-cc-fit')
      }
    }

    var fitObserver = null
    var fitTimer = 0
    // 同一类失败只提示一次：静默吞异常会让人完全看不出"框为什么不贴文字/底衬为什么不出来"。
    var warnedKeys = {}
    function warnOnce(tag, e) {
      if (warnedKeys[tag]) return
      warnedKeys[tag] = true
      try { console.warn('[dsh-cache-control] ' + tag + ' 失败: ' + String((e && e.message) || e)) } catch (e2) { /* ignore */ }
    }
    function fitSafe() {
      try { fitUserBubbles() } catch (e) { warnOnce('fitUserBubbles', e) }
    }
    function requestFit() {
      if (fitTimer) return
      fitTimer = setTimeout(function () { fitTimer = 0; fitSafe() }, 90)
    }
    /**
     * 滚轮到边后把滚动"还给"会话（2026-09-10 用户反馈"滚轮会把对话框划上去"实测后加）。
     *
     * 背景：被钉住的长提问本体是 overflow-y:auto + overscroll-behavior:contain。
     * contain 是**故意**的（气泡内滚到底不该顺手把会话也带走），但它同时挡住了浏览器
     * 本该做的串联 —— 实测：气泡到顶后继续向上滚，外层会话一动不动、气泡也不动，
     * 滚轮在这条提问上等于彻底失灵（成了死区）；只有把光标挪到气泡左右那 3px 缝里
     * 才能滚会话。而"钉住最近一条提问"这个交互的预期是：滚轮压在钉住的提问上，
     * 会话照常翻（像 Discord 的置顶消息）。
     *
     * 所以这里只补一件事：**气泡自己滚不动了（到边或压根没得滚）**时，把这次 deltaY
     * 转交给会话滚动区并 preventDefault（否则会被 contain 吃掉）。气泡内还有余量时
     * 一律不插手，维持原有"在气泡内滚"的语义。
     *
     * 必须挂捕获阶段 + passive:false（默认 passive 的 wheel 监听里 preventDefault 无效）。
     */
    function pinWheelHandler(e) {
      try {
        var el = e.target
        var b = el && el.closest ? el.closest('[class*="_bubble"]') : null
        if (!b || !b.closest || !b.closest('[data-cc-pin="1"]')) return   // 只管被钉住的那条
        var sc = scrollerFor(b)
        if (!sc) return
        var max = b.scrollHeight - b.clientHeight
        if (max <= 1) {                     // 气泡不够高、没得滚 ⇒ 直接转给会话
          sc.scrollTop += e.deltaY
          if (e.cancelable) e.preventDefault()
          return
        }
        var atTop = b.scrollTop <= 0 && e.deltaY < 0
        var atBottom = b.scrollTop >= max - 1 && e.deltaY > 0
        if (!atTop && !atBottom) return     // 气泡内还能滚 ⇒ 维持原样（内层滚）
        sc.scrollTop += e.deltaY            // 到边 ⇒ 手动补上被 contain 挡住的串联
        if (e.cancelable) e.preventDefault()
      } catch (err) { warnOnce('pinWheelHandler', err) }
    }
    /**
     * 观察器只挂在会话流容器上（比 body 便宜得多）：新消息/流式改字 ⇒ 重贴合；
     * scroll ⇒ 重选"钉哪一条" + 重定位字尾；resize ⇒ 清签名重算。
     * 另外补两件事：① 首屏延迟再量一次（挂载时机早于消息渲染时第一轮会空跑）；
     * ② 等 webfont 就绪再清签名重算一次（字体切换会改行宽，一次量错的值会被签名锁住）。
     */
    function startFitWatch() {
      if (!domReady() || fitObserver) return
      var flow = null
      try { flow = document.querySelector('[data-chat-flow]') } catch (e) { flow = null }
      fitObserver = new MutationObserver(function () { requestFit() })
      fitObserver.observe(flow || document.body, { childList: true, subtree: true })
      fitScrollHandler = function () {
        requestFit()
        if (STORE.state.pinLastUser) { try { applyPin() } catch (e) { /* 忽略 */ } }
      }
      fitResizeHandler = function () {
        clearFit()
        requestFit()
        if (STORE.state.pinLastUser) { try { applyPin() } catch (e) { /* 忽略 */ } }
      }
      // 手搓 DOM / 老引擎可能没有事件 API ⇒ 逐个判类型再挂，缺了什么就少一份能力，不抛错。
      if (typeof document.addEventListener === 'function') document.addEventListener('scroll', fitScrollHandler, true)
      else { fitScrollHandler = null }
      // 滚轮到边转发给会话：捕获阶段 + passive:false（preventDefault 才有效）。
      // 没被钉住时 handler 第一句就 return，开销可忽略。
      if (typeof document.addEventListener === 'function') {
        document.addEventListener('wheel', pinWheelHandler, { capture: true, passive: false })
      }
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('resize', fitResizeHandler)
      else { fitResizeHandler = null }
      setTimeout(fitSafe, 0)
      setTimeout(fitSafe, 400)
      try {
        if (document.fonts && typeof document.fonts.ready && typeof document.fonts.ready.then === 'function') {
          document.fonts.ready.then(function () { clearFit(); fitSafe() }, function () { /* 忽略 */ })
        }
      } catch (e) { /* 老引擎没有 fonts.ready */ }
      requestFit()
    }
    function stopFitWatch() {
      if (fitObserver) { fitObserver.disconnect(); fitObserver = null }
      if (fitTimer) { clearTimeout(fitTimer); fitTimer = 0 }
      if (typeof document !== 'undefined' && fitScrollHandler && document.removeEventListener) {
        document.removeEventListener('scroll', fitScrollHandler, true)
      }
      if (typeof document !== 'undefined' && document.removeEventListener) {
        document.removeEventListener('wheel', pinWheelHandler, { capture: true })
      }
      if (typeof window !== 'undefined' && fitResizeHandler && window.removeEventListener) {
        window.removeEventListener('resize', fitResizeHandler)
      }
      fitScrollHandler = null
      fitResizeHandler = null
      clearFit()
    }

    /**
     * 把外观开关映射到 <html> 上：data-* 决定"生不生效"，CSS 变量决定"长什么样"
     * （--cc-pin-blur = 钉顶底衬的模糊半径；--cc-user-bubble-max = 提问气泡宽度上限，
     *   单位 em，改 USER_BUBBLE_MAX_EM 一处即可，随会话字号一起缩放）。
     * 每一步各自 try/catch：以前一处抛错（例如常量改名）会连带把后面的观察器全跳过，
     * 表现就是"底衬根本不出现 ⇒ 模糊度像失效了一样"。
     */
    function applyAppearance(s) {
      if (!domReady()) return
      var el = document.documentElement
      try {
        if (s.pinLastUser) el.setAttribute('data-cc-pin-last-user', '1'); else el.removeAttribute('data-cc-pin-last-user')
        if (s.clearBubble) el.setAttribute('data-cc-clear-bubble', '1'); else el.removeAttribute('data-cc-clear-bubble')
      } catch (e) { warnOnce('applyAppearance attrs', e) }
      // 取值 0 也要写（"完全不模糊、只留半透明底"是合法档位），所以不做真值判断。
      try {
        if (el.style && el.style.setProperty) {
          el.style.setProperty('--cc-pin-blur', clampBlur(s.pinBlur) + 'px')
          el.style.setProperty('--cc-pin-max-vh', clampPinMaxVh(s.pinMaxVh) + 'vh')
          el.style.setProperty('--cc-user-bubble-max', USER_BUBBLE_MAX_EM + 'em')
        }
      } catch (e) { warnOnce('applyAppearance vars', e) }
      try { if (s.pinLastUser) startPinWatch(); else stopPinWatch() } catch (e) { warnOnce('pinWatch', e) }
      // 气泡贴文字/字尾定位与"钉哪一条"要跟着滚动与消息变化重算 ⇒ 观察器常驻（只挂会话流容器）；
      // 停用插件时 stopFitWatch() 会把内联 width / --cc-tail-* / data-cc-fit 全部撤干净。
      try { startFitWatch() } catch (e) { warnOnce('fitWatch', e) }
      // 宽度观察器只在开关开着时才挂：关着没必要为一条不存在的钉法盯整棵 body。
      try {
        if (s.chatWidthEnabled && s.appearanceReady) startWidthWatch(); else stopWidthWatch()
        applyChatWidth()
      } catch (e) { warnOnce('widthWatch', e) }
    }

    function setPinLastUser(v) {
      if (!STORE.state.appearanceReady) return
      STORE.set({ pinLastUser: v })
      applyAppearance(STORE.state)
      scheduleSave()
    }
    function setClearBubble(v) {
      if (!STORE.state.appearanceReady) return
      STORE.set({ clearBubble: v })
      applyAppearance(STORE.state)
      scheduleSave()
    }
    /** 钉顶底衬的模糊度（px）：只写 CSS 变量，0 = 只留半透明底、不模糊。 */
    function setPinBlur(v) {
      if (!STORE.state.appearanceReady) return
      STORE.set({ pinBlur: clampBlur(v) })
      applyAppearance(STORE.state)
      scheduleSave()
    }
    /**
     * 被钉气泡的最高高度（vh）：决定"钉住时能直接看到多少提问原文"，
     * 超出部分在气泡内滚（滚轮到边会转交给会话）。调高挡住的正文也更多，是纯手感取舍。
     */
    function setPinMaxVh(v) {
      if (!STORE.state.appearanceReady) return
      STORE.set({ pinMaxVh: clampPinMaxVh(v) })
      applyAppearance(STORE.state)
      scheduleSave()
    }

    // ------------------------------------------------------ 对话页固定宽度 --
    // 原 dsh-bg-atelier「底图工坊 · 对话页」整块移到这里（用户 2026-09-07）：
    // 会话外观类的开关归会话策略一处管，底图工坊只管底图与卡面特效。
    //
    // 找到会话根节点：DSH 的会话根就是声明 --dsh-chat-content-width 的那个元素，
    // 它通过 publishWidths 在自身内联设置 --dsh-conversation-column-width 标定列宽。
    // 从输入卡往上找到带该内联属性的祖先，直接钉住宽度变量即可覆盖 DSH 的响应式 clamp。
    function findChatRoot() {
      var card = document.querySelector('[data-composer-card]')
      var el = card
      while (el && el !== document.documentElement) {
        if (el.style && el.style.getPropertyValue && el.style.getPropertyValue('--dsh-conversation-column-width')) return el
        el = el.parentElement
      }
      return null
    }

    // --dsh-chat-content-width = 消息列宽; --dsh-composer-card-max-width = 输入卡宽;
    // --dsh-chat-user-width = 提问列宽。关闭时逐个 removeProperty，交回 DSH 自适应。
    // pinChatWidth 供滑杆"即时预览但不写状态"用，松手/失焦才 STORE.set 提交，
    // 免得每拖一格就把整页（含上百张图卡的底图工坊）重渲染一遍。
    function pinChatWidth(enabled, rawW) {
      var w = enabled && Number(rawW) > 0 ? Math.round(Number(rawW)) : null
      var root = findChatRoot()
      syncWidthStyle(w)   // :root 兜底与根节点钉法并行：composer 还没挂上时也能生效
      if (!root) return false
      if (w) {
        root.style.setProperty('--dsh-chat-content-width', w + 'px', 'important')
        root.style.setProperty('--dsh-composer-card-max-width', (w + 32) + 'px', 'important')
        root.style.setProperty('--dsh-chat-user-width', w + 'px', 'important')
      } else {
        root.style.removeProperty('--dsh-chat-content-width')
        root.style.removeProperty('--dsh-composer-card-max-width')
        root.style.removeProperty('--dsh-chat-user-width')
      }
      return true
    }

    // :root 兜底：宿主把 --dsh-chat-content-width 写成 var(--dsh-chat-user-width, clamp(…))
    // 声明在会话根自己身上，所以在 <html> 上给 --dsh-chat-user-width 赋值就能顺着继承链
    // 生效 —— 覆盖 findChatRoot() 暂时找不到根节点的窗口（首屏 / 换会话 / composer 未挂）。
    var widthStyleEl = null
    function syncWidthStyle(w) {
      if (!domReady()) return
      var css = w > 0 ? ':root{--dsh-chat-user-width:' + w + 'px !important}' : ''
      if (!css) {
        if (widthStyleEl && widthStyleEl.parentNode) widthStyleEl.parentNode.removeChild(widthStyleEl)
        widthStyleEl = null
        return
      }
      if (!widthStyleEl) {
        widthStyleEl = document.createElement('style')
        widthStyleEl.type = 'text/css'
        widthStyleEl.setAttribute('data-cc-chat-width', '1')
        document.head.appendChild(widthStyleEl)
      }
      if (widthStyleEl.textContent !== css) widthStyleEl.textContent = css
    }

    function applyChatWidth() {
      if (!domReady()) return false
      var s = STORE.state
      return pinChatWidth(!!s.chatWidthEnabled, Number(s.chatWidth) || 0)
    }

    // 会话根随切换会话 / 导航会重建，钉上去的内联变量跟着没了 ⇒ 观察 DOM 变动补回去。
    // 与 pin 观察器分开的理由：两者各自的开关决定挂不挂，关着的那条不该为 body 变动买单。
    var widthObserver = null
    var widthTimer = 0
    function startWidthWatch() {
      if (!domReady() || widthObserver) return
      widthObserver = new MutationObserver(function () {
        if (widthTimer) return
        widthTimer = setTimeout(function () { widthTimer = 0; applyChatWidth() }, 300)
      })
      widthObserver.observe(document.body, { childList: true, subtree: true })
      applyChatWidth()
    }
    function stopWidthWatch() {
      if (widthObserver) { widthObserver.disconnect(); widthObserver = null }
      if (widthTimer) { clearTimeout(widthTimer); widthTimer = 0 }
      pinChatWidth(false, 0)   // 撤销痕迹：把三个变量从会话根上摘掉
    }

    /** 开关：启用 / 停用固定宽度（走 applyAppearance，顺带挂/拆 DOM 观察器）。 */
    function setChatWidthEnabled(v) {
      if (!STORE.state.appearanceReady) return
      STORE.set({ chatWidthEnabled: !!v })
      applyAppearance(STORE.state)
      scheduleSave()
    }
    /** 滑杆提交值（拖动途中由 WidthField 直接走 pinChatWidth 预览，不经过这里）。 */
    function commitChatWidth(v) {
      if (!STORE.state.appearanceReady) return
      v = Math.min(3840, Math.max(640, Math.round(Number(v) || 860)))
      STORE.set({ chatWidth: v })
      pinChatWidth(STORE.state.chatWidthEnabled, v)
      scheduleSave()
    }

    // ---------------------------------------------------------------- 控件 --
    /**
     * 开/关徽标：chip 的两段与面板里两个分区头共用这一类元件。
     * dim=true 表示能力未装载（旧 host 还在跑），按“关”显示并标警。
     */
    function OnOff(on, dim) {
      var cls = 'cc-badge' + (dim ? ' dim' : (on ? ' on' : ''))
      return h('span', { className: cls }, on && !dim ? '开' : '关')
    }

    function Switch(label, checked, onChange, disabled) {
      return h('label', { className: 'cc-row', style: { cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 } },
        h('input', {
          type: 'checkbox', checked: !!checked, disabled: !!disabled,
          onChange: function (e) { onChange(e.target.checked) },
        }),
        h('span', null, label))
    }

    function SliderRow(label, value, min, max, unit, onChange) {
      return h('label', { className: 'cc-row' },
        h('span', { style: { minWidth: '108px' } }, label),
        h('input', {
          type: 'range', min: String(min), max: String(max), step: '1',
          value: String(value),
          onChange: function (e) { onChange(Number(e.target.value)) },
        }),
        h('span', { className: 'cc-val' }, value + (unit || '%')))
    }

    function setTrigger(v) {
      v = Math.min(95, Math.max(5, Math.round(v)))
      var retain = STORE.state.retainPct
      if (retain >= v) retain = v - 1
      STORE.set({ triggerPct: v, retainPct: retain })
      scheduleSave()
    }
    function setRetain(v) {
      var max = STORE.state.triggerPct - 1
      v = Math.min(max, Math.max(1, Math.round(v)))
      STORE.set({ retainPct: v })
      scheduleSave()
    }
    /** 省缓存总开关：与门禁互不影响。 */
    function setEnabled(v) {
      STORE.set({ enabled: v })
      scheduleSave()
    }
    function setAuto(v) {
      STORE.set({ auto: v })
      scheduleSave()
    }
    /** 门禁总开关：与省缓存互不影响。 */
    function setGateEnabled(v) {
      STORE.set({ gateEnabled: v, gateError: '' })
      scheduleSave()
    }
    /**
     * chip 两段的点击处理（提到模块作用域，便于离线断言"点哪段切哪个"）。
     * 读 STORE.state 而非闭包快照，避免连点用旧值。
     */
    function flipCache() {
      if (STORE.state.loading || !STORE.state.loaded) return
      setEnabled(!STORE.state.enabled)
    }
    function flipGate() {
      if (STORE.state.loading || !STORE.state.loaded || !STORE.state.gateReady) return
      setGateEnabled(!STORE.state.gateEnabled)
    }

    function GateSummary(s) {
      var tags = []
      tags.push(h('span', { className: 'cc-tag', key: 'src' }, s.gateSource === 'override' ? '自定义规则' : '内置规则'))
      tags.push(h('span', { className: 'cc-tag', key: 'size' }, kb(s.gateBytes) + ' · ' + s.gateLines + ' 行'))
      if (s.gateTruncated) tags.push(h('span', { className: 'cc-tag warn', key: 'tr' }, '超出上限已截断'))
      return h('div', { className: 'cc-gateMeta' }, tags)
    }

    /** 说明抽屉: 默认收起 (测试可经 internals.setFoldsOpen 让其默认展开)。 */
    function Fold(props) {
      var pair = React.useState(FOLD_DEFAULT_OPEN === true)
      var open = pair[0]
      var setOpen = pair[1]
      return h('div', { className: 'cc-fold' },
        h('button', {
          type: 'button', className: 'cc-foldBtn',
          'aria-expanded': open ? 'true' : 'false',
          onClick: function () { setOpen(!open) },
        }, (open ? '▾ ' : '▸ ') + (props.label || '说明')),
        open ? h('div', { className: 'cc-foldBody' }, props.children) : null)
    }

    // ---------------------------------------------------- 设置页：省缓存卡 --
    function CacheCard() {
      var s = useCache()
      var windowText = fmt(s.windowTokens)
      var hint = s.enabled
        ? '开启：之后新建的“标准模式”会话在上下文压力达到 ~' + fmt(s.triggerTokens) +
          ' tokens（窗口 ' + s.triggerPct + '%）时自动压缩，逐字保留最近 ~' + fmt(s.retainTokens) +
          ' tokens（窗口 ' + s.retainPct + '%），更早内容整理成一条摘要。'
        : '关闭：使用 DSH 出厂默认（压力达窗口 80% 压缩，逐字保留 16%）。'
      return h('div', { className: 'cc-card' },
        Switch('启用压缩策略（作用于之后新建的标准模式会话）', s.enabled, setEnabled),
        h('div', null,
          SliderRow('压缩触发点', s.triggerPct, 5, 95, '%（窗口 ' + windowText + '）', setTrigger),
          h('div', { className: 'cc-row' },
            h('span', { style: { minWidth: '108px' } }, '保留原文尾部'),
            h('input', { type: 'range', min: '1', max: String(Math.max(1, s.triggerPct - 1)), step: '1',
              value: String(Math.min(s.retainPct, Math.max(1, s.triggerPct - 1))),
              onChange: function (e) { setRetain(Number(e.target.value)) } }),
            h('span', { className: 'cc-val' }, Math.min(s.retainPct, Math.max(1, s.triggerPct - 1)) + '%（窗口 ' + windowText + '）')),
          Switch('自动压缩（关闭 = 仅保留手动 /compact）', s.auto, setAuto)),
        h(Fold, { label: '说明' },
          h('div', { className: 'cc-note' }, hint)),
        s.error ? h('p', { className: 'cc-err' }, s.error)
          : h('p', { className: 'cc-ok' }, s.saving ? '正在保存…' : (s.enabled === s.applied ? '压缩参数已与磁盘一致（下一个新建会话生效）' : '压缩参数待同步…')))
    }

    // ---------------------------------------------------- 设置页：门禁卡 --
    function GateCard() {
      var s = useCache()
      var editing = s.gateDraft !== null
      var draft = editing ? s.gateDraft : s.gateText
      var draftBytes = new Blob([draft || '']).size
      return h('div', { className: 'cc-card' },
        Switch('启用会话守则（下一个请求即生效，含已打开的会话）', s.gateEnabled, setGateEnabled, !s.gateReady),
        s.gateReady ? GateSummary(s)
          : h('div', { className: 'cc-err' }, '会话守则未装载：旧版 host 半仍在运行，请重启桌面应用后再操作（重启前请不要再动本面板的压缩开关，否则新字段会被旧版写盘逻辑抹掉）。'),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          h('button', {
            className: 'cc-btn', type: 'button', disabled: !s.gateReady,
            onClick: function () { STORE.set({ gateDraft: editing ? null : s.gateText }) },
          }, editing ? '取消编辑' : '编辑规则'),
          editing ? h('button', {
            className: 'cc-btn', type: 'button', disabled: s.gateSaving,
            onClick: function () { saveGateText(s.gateDraft) },
          }, s.gateSaving ? '保存中…' : '保存并生效') : null,
          editing && s.gateSource === 'override' ? h('button', {
            className: 'cc-btn', type: 'button', disabled: s.gateSaving,
            onClick: function () { saveGateText('') },
          }, '清除自定义，回到内置') : null,
          h('button', {
            className: 'cc-btn', type: 'button', onClick: reloadGate,
          }, '重新读取')),
        editing ? h('div', null,
          h('textarea', {
            className: 'cc-textarea', value: draft, spellCheck: false,
            onChange: function (e) { STORE.set({ gateDraft: e.target.value }) },
          }),
          h('div', { className: 'cc-muted', style: { marginTop: '6px' } },
            '编辑即写入 override 文件（不改动插件目录内的内置规则）；' + draftBytes + ' B / 上限 ' + kb(s.gateMaxBytes) +
            '。成对花括号会被替换为全角字形，以免破坏提示词变量插值。')) : null,
        s.gateError ? h('p', { className: 'cc-err' }, s.gateError) : null,
        h(Fold, { label: '规则说明' },
          h('div', { className: 'cc-note' },
            '规则三条：R1 独立研判（允许并要求反对你，不默认你正确）；R2 不确定就提问（只问查不到、且会改变结果的那些）；R3 分工固定（你定目标/补真实情况/判定可用性，我搜索·执行·制作·验证·交付）。'),
          h('div', { className: 'cc-path' }, '内置规则：' + (s.gateBuiltinPath || '（未就绪）')),
          h('div', { className: 'cc-path' }, '自定义副本：' + (s.gateOverridePath || '（未就绪）') +
            (s.gateSource === 'override' ? '（当前生效）' : '（尚未创建）')),
          h('div', { className: 'cc-note' },
            '生效范围：注入 system prompt 的一个段（排在 persona 之后、工具说明之前）。它随 system prompt 每请求重发，' +
            '不进对话历史，因此不受上面压缩策略的影响；代价是每次请求（含子代理、工作流子会话）都多这几 KB token。' +
            '会话守则是"必须遵守的规则"，不是"模型无法违反"——它约束行为，不产生技术硬拦截。')))
    }

    /**
     * 自检读数：底衬到底有没有被画出来、计算后的 backdrop-filter / 宽度是多少。
     * "模糊度像失效"可能有好几种成因（开关没生效、被钉元素没出现、变量没落上、
     * 被别的样式盖掉）——把实测值直接显示出来，一眼能分辨，不用靠猜。
     */
    function readPlateState() {
      var out = { pinned: false, blurVar: '', filter: '', plateW: '', font: '' }
      try {
        if (typeof document === 'undefined' || !document.querySelector) return out
        var el = document.querySelector('[' + APPEAR_ATTRS.pin + ']')
        out.pinned = !!el
        if (typeof getComputedStyle !== 'function') return out
        var root = getComputedStyle(document.documentElement)
        out.blurVar = root.getPropertyValue('--cc-pin-blur').trim()
        out.font = (root.getPropertyValue('--dsh-content-font-size').trim() || root.fontSize || '').trim()
        if (el) {
          var cs = getComputedStyle(el, '::before')
          out.filter = cs.backdropFilter || cs.webkitBackdropFilter || ''
          out.plateW = cs.width || ''
        }
      } catch (e) { out.filter = '读取失败' }
      return out
    }

    function AppearanceCard() {
      var s = useCache()
      var b = clampBlur(s.pinBlur)
      // 小数值细分：<3.5 按 0.1 步进（能选到 1.3/1.5/1.7 这类微调档），≥3.5 按 0.5 足够。
      var blurStep = b < 3.5 ? '0.1' : '0.5'
      var plate = readPlateState()
      return h('div', { className: 'cc-card' },
        Switch('把最近一条「我的提问」钉在会话区顶部', s.pinLastUser, setPinLastUser, !s.appearanceReady),
        Switch('我的气泡背景透明（露出壁纸）', s.clearBubble, setClearBubble, !s.appearanceReady),
        h('div', { className: 'cc-row' },
          h('span', { style: { minWidth: '108px' } }, '钉顶底衬模糊度'),
          h('input', { type: 'range', min: '0', max: '24', step: blurStep,
            value: String(b), disabled: !s.appearanceReady,
            onChange: function (e) { setPinBlur(Number(e.target.value)) } }),
          h('span', { className: 'cc-val' }, b + 'px')),
        // 钉顶气泡的最高高度：38vh 是"能看多少原文"与"挡多少正文"的折中，按需调。
        h('div', { className: 'cc-row' },
          h('span', { style: { minWidth: '108px' } }, '钉顶气泡最高'),
          h('input', { type: 'range', min: '12', max: '80', step: '1',
            value: String(s.pinMaxVh), disabled: !s.appearanceReady,
            onChange: function (e) { setPinMaxVh(Number(e.target.value)) } }),
          h('span', { className: 'cc-val' }, s.pinMaxVh + 'vh')),
        !s.appearanceReady ? h('div', { className: 'cc-err' },
          '气泡置顶等功能未装载：当前运行的 host 还不认识这几个字段，写盘会被旧版抹掉。请重启桌面应用。') : null,
        s.pinLastUser && s.appearanceReady ? h('div', { className: 'cc-muted' },
          '钉住位置自检：' + (s.pinMarked || '还没找到 [class*="_userRow"]（当前页面可能没有会话，或类名已变）')) : null,
        // 实测读数（拖滑杆时能立刻看到 blur(...) 有没有跟着变）
        h('div', { className: 'cc-row', style: { gap: '8px', flexWrap: 'wrap' } },
          h('span', { className: 'cc-muted' },
            '底衬实测：被钉元素 ' + (plate.pinned ? '有' : '无')
            + ' · --cc-pin-blur=' + (plate.blurVar || '(未设置)')
            + ' · backdrop-filter=' + (plate.filter || '(无)')
            + ' · 底衬宽=' + (plate.plateW || '(无)')
            + ' · 会话字号=' + (plate.font || '(未知)')),
          h('button', {
            className: 'cc-mini', type: 'button',
            onClick: function () { STORE.set({ fitTick: (STORE.state.fitTick || 0) + 1 }) },
          }, '重读')),
        h(Fold, { label: '说明' },
          h('div', { className: 'cc-note' },
            '三项都是纯界面开关：只往 <html> 上加 data-cc-* / --cc-pin-blur 并注入样式，不改消息数据、不改宿主代码。'
            + '「钉顶气泡最高」决定钉住时能直接看到多少提问原文（超出部分在气泡内滚，滚轮到边会转交给会话）；'
            + '调高看得全、但挡住的身后正文也更多，38vh 是原默认折中值。'
            + '选择器按 CSS Module 的**后缀**匹配（userRow / bubble），因为前缀是构建哈希。'
            + '钉顶用 position:sticky，钉的是"顶边已越过会话区上沿的最后一条提问"——所以往上翻时'
            + '置顶条会跟着换成 4、3……滚到底才钉最近那条；直接给内层行加 sticky 会因父级没有'
            + '剩余高度而不生效。气泡框宽是量出来的（Range.getClientRects 取最宽一行 + 内边距后'
            + '写内联 width），复制/时间行再绝对定位到最后一行的字尾，所以框贴文字、键贴文末。')))
    }

    // ------------------------------------------------ 设置页：对话页卡（④） --
    // 常用宽度快捷键（bg-atelier 原样搬来）
    var WIDTH_PRESETS = [1280, 1600, 1920, 2560, 3840]

    /**
     * 宽度滑杆：拖动过程中只改本组件的局部状态 + 直接钉 CSS 变量做即时预览，
     * 松手 / 失焦 / 方向键才 STORE.set → scheduleSave。否则每拖一格都会把
     * 整页（含这条设置页）重渲染一遍，手感明显发涩。
     */
    function WidthField() {
      var s = useCache()
      var pair = React.useState(s.chatWidth > 0 ? s.chatWidth : 860)
      var val = pair[0]
      var setVal = pair[1]
      React.useEffect(function () {
        setVal(s.chatWidth > 0 ? s.chatWidth : 860)
      }, [s.chatWidth])

      function onInput(v) {
        setVal(v)
        pinChatWidth(true, v)          // 即时预览：不写状态、不触发重渲染
      }
      var chips = []
      for (var i = 0; i < WIDTH_PRESETS.length; i++) {
        ;(function (w) {
          chips.push(h('button', {
            key: w, type: 'button',
            className: 'cc-mini' + (val === w ? ' on' : ''),
            title: '宽度 ' + w + 'px',
            onClick: function () { setVal(w); pinChatWidth(true, w); commitChatWidth(w) },
          }, String(w)))
        })(WIDTH_PRESETS[i])
      }
      return h('div', null,
        h('div', { className: 'cc-row', style: { marginTop: '10px' } },
          h('span', { style: { minWidth: '108px' } }, '对话页宽度'),
          h('input', {
            type: 'range', min: '640', max: '3840', step: '10', value: String(val),
            onChange: function (e) { onInput(Number(e.target.value)) },
            onPointerUp: function () { commitChatWidth(val) },
            onKeyUp: function () { commitChatWidth(val) },
            onBlur: function () { commitChatWidth(val) },
          }),
          h('span', { className: 'cc-val' }, Math.round(val) + 'px')),
        h('div', { className: 'cc-chips' }, chips))
    }

    function ChatPageCard() {
      var s = useCache()
      return h('div', { className: 'cc-card' },
        Switch('启用固定对话页宽度（关闭 = 跟随 DSH 自适应）', s.chatWidthEnabled,
          setChatWidthEnabled, !s.appearanceReady),
        s.chatWidthEnabled ? h(WidthField) : null,
        h(Fold, { label: '说明' },
          h('div', { className: 'cc-note' },
            s.chatWidthEnabled
              ? '现在把会话列宽钉在 ' + (s.chatWidth || 860) + 'px：直接往会话根元素上写 --dsh-chat-content-width /'
                + ' --dsh-composer-card-max-width / --dsh-chat-user-width（!important，绕过 DSH 的响应式 clamp）。'
                + '拖动即时预览、松手才存盘；切换会话会让根节点重建，故另有一条 DOM 观察器补写回去。'
              : '未启用：宽度跟随 DSH 自己的响应式 clamp。开关与数值都存进本插件的 settings.json（原来存在底图工坊里，已随本功能一并迁出）。')))
    }

    function CacheControlPage() {
      var s = useCache()
      // 名称一律压到 2–4 字（用户 2026-09-07）：目录里一眼能读完，细节写在每卡正文。
      return h('div', { className: 'cc-page' },
        h('section', null,
          h('h3', { className: 'cc-h' }, '会话策略'),
          h(Fold, { label: '总述' },
            h('p', { className: 'cc-sub' }, '四块互相独立的开关：① 压缩策略改写 standard preset 的 compaction 参数（只对之后新建的会话生效）；② 会话守则把长期规则常驻注入 system prompt（对所有会话的下一个请求生效）；③ 气泡置顶只管会话区样式（钉住最近一条提问 · 毛玻璃底衬随这条提问的长度伸缩 · 长文限高 38vh 可在气泡内滚轮 · 气泡透明）；④ 对话页只管会话列宽（原底图工坊里的同名区块）。'))),
        h('section', null,
          h('h3', { className: 'cc-h' }, '① 省缓存'),
          CacheCard()),
        h('section', null,
          h('h3', { className: 'cc-h' }, '② 会话守则'),
          GateCard()),
        h('section', null,
          h('h3', { className: 'cc-h' }, '③ 气泡置顶'),
          AppearanceCard()),
        h('section', null,
          h('h3', { className: 'cc-h' }, '④ 对话页'),
          ChatPageCard()),
        h('section', null,
          h(Fold, { label: '关于本页' },
            h('p', { className: 'cc-muted' }, '该页面由 dsh-cache-control 插件提供。开关写入 $DSH_HOME/dsh-cache-control/settings.json：压缩开关同步改写 standard preset 组装文件中 @deepseek-ai/dsh-compaction-basic 行的 config（关闭即移除 config 恢复出厂默认）；会话守则开关只决定规则段是否为空（空段在提示词渲染时被丢弃）；③④ 两项纯界面，只改样式与 CSS 变量。规则文本见上列路径。'))))
    }

    // ------------------------------------------ 输入工具条 chip + 弹出面板 --
    function SliderC(label, value, min, max, onChange) {
      return h('div', { className: 'cc-prow' },
        h('label', null, label),
        h('input', {
          type: 'range', min: String(min), max: String(max), step: '1',
          value: String(value),
          onChange: function (e) { onChange(Number(e.target.value)) },
        }),
        h('span', { className: 'cc-val' }, value + '%'))
    }

    function CacheControlComposerChip() {
      var s = useCache()
      var openPair = React.useState(FORCE_OPEN === true)
      var open = openPair[0]
      var setOpen = openPair[1]
      var posPair = React.useState({ left: 8, bottom: 8, top: null, maxHeight: 420 })
      var pos = posPair[0]
      var setPos = posPair[1]
      var btnRef = React.useRef(null)
      var panelRef = React.useRef(null)

      // 面板往 chip 上方展开：输入条贴在视口底部，往下开等于开到屏幕外面去。
      // 上方空间也不够时（窗口很矮）反过来往下开，并把 max-height 锁在可用空间里，
      // 让面板自己滚动 —— 不锁高度就没法保证 top 不飞出视口。
      function place() {
        var el = btnRef.current
        if (!el || !el.getBoundingClientRect) return
        var r = el.getBoundingClientRect()
        var vw = window.innerWidth || 1200
        var vh = window.innerHeight || 800
        var gap = 6
        var left = Math.max(8, Math.min(r.left, vw - PANEL_WIDTH - 8))
        var above = r.top - 8 - gap
        var below = vh - r.bottom - 8 - gap
        var flip = above < 180 && below > above
        if (flip) setPos({ left: left, top: r.bottom + gap, bottom: null, maxHeight: Math.max(120, below) })
        else setPos({ left: left, top: null, bottom: vh - r.top + gap, maxHeight: Math.max(120, above) })
      }

      // 一次性校正：祖先带 scale/transform 时，getBoundingClientRect 给的是变换后的视口坐标，
      // 而布局用的是变换前坐标，两者会差一截 —— 用"实测 vs 期望"的差补一次。
      // （用 useEffect 而不是 useLayoutEffect：SSR 下后者会告警，且这帧校正不是首屏前置条件。）
      React.useEffect(function () {
        var p = panelRef.current
        if (!open || !p || !p.getBoundingClientRect || !btnRef.current) return undefined
        var r = p.getBoundingClientRect()
        var c = btnRef.current.getBoundingClientRect()
        var vh = window.innerHeight || 800
        var wantBottom = vh - c.top + 6
        var patch = null
        if (pos.bottom != null) {
          var dy = wantBottom - r.bottom
          if (Math.abs(dy) > 1) patch = { bottom: (vh - r.bottom) + dy }
        } else {
          var wantTop = c.top - 6 - r.height
          var dy2 = wantTop - r.top
          if (Math.abs(dy2) > 1) patch = { top: r.top + dy2 }
        }
        if (patch) setPos(function (cur) { return Object.assign({}, cur, patch) })
        return undefined
      }, [open, pos.left, pos.bottom, pos.top])

      function togglePanel() {
        var now = Date.now()
        if (now - caretLastAt < 250) return   // 双击会"开→关", 防抖后第二次被吃掉
        caretLastAt = now
        var next = !open
        if (next) place()
        setOpen(next)
      }

      React.useEffect(function () {
        if (!open) return undefined
        function onKey(e) { if (e.key === 'Escape') setOpen(false) }
        function onDown(e) {
          var t = e.target
          var inPanel = panelRef.current && panelRef.current.contains && panelRef.current.contains(t)
          var inChip = btnRef.current && btnRef.current.contains && btnRef.current.contains(t)
          if (!inPanel && !inChip) setOpen(false)
        }
        function onResize() { place() }
        document.addEventListener('keydown', onKey)
        document.addEventListener('mousedown', onDown, true)
        window.addEventListener('resize', onResize)
        return function () {
          document.removeEventListener('keydown', onKey)
          document.removeEventListener('mousedown', onDown, true)
          window.removeEventListener('resize', onResize)
        }
      }, [open])

      var header = h('div', { className: 'cc-panelHead' },
        h('span', null, '会话策略'),
        h('button', { className: 'cc-close', 'aria-label': '关闭', onClick: function () { setOpen(false) } }, '✕'))

      // ① 省缓存
      var cacheSection = [
        h('div', { className: 'cc-sect', key: 'h', style: { borderTop: 'none', paddingTop: '0' } },
          h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
            h('span', { className: 'cc-sectTitle' }, '① 省缓存'), OnOff(s.enabled)),
          h('span', { className: 'cc-sectHint' }, '新会话生效')),
        h(React.Fragment, { key: 'on' }, Switch('启用（之后新建的会话）', s.enabled, setEnabled)),
        h(React.Fragment, { key: 'tr' }, SliderC('压缩触发点', s.triggerPct, 5, 95, setTrigger)),
        h(React.Fragment, { key: 'rt' }, SliderC('保留原文尾部', Math.min(s.retainPct, Math.max(1, s.triggerPct - 1)), 1, Math.max(1, s.triggerPct - 1), setRetain)),
        h(React.Fragment, { key: 'au' }, Switch('自动压缩（关 = 仅手动 /compact）', s.auto, setAuto)),
      ]

      // ② 会话守则 —— 同一个框内，独立开关
      var gateSection = [
        h('div', { className: 'cc-sect', key: 'h' },
          h('span', { className: 'cc-sectTitle' }, '② 会话守则'),
          h('span', { className: 'cc-sectHint' }, '下一步即生效')),
        h(React.Fragment, { key: 'on' }, Switch('启用（规则 R1 研判 / R2 提问 / R3 分工）', s.gateEnabled, setGateEnabled, !s.gateReady)),
        s.gateReady ? h('div', { key: 'meta' }, GateSummary(s))
          : h('div', { className: 'cc-err', key: 'meta' }, '未装载：需重启桌面应用'),
        s.gateOpen ? h('div', { className: 'cc-gateBody', key: 'body' }, s.gateText || '（空）') : null,
        h('div', { key: 'btns', style: { display: 'flex', gap: '6px', alignItems: 'center' } },
          h('button', {
            className: 'cc-btn', type: 'button',
            onClick: function () {
              var next = !STORE.state.gateOpen
              STORE.set({ gateOpen: next })
              if (next && !STORE.state.gateText) reloadGate()
            },
          }, s.gateOpen ? '收起规则' : '查看规则'),
          h('button', {
            className: 'cc-btn', type: 'button', onClick: reloadGate,
          }, '重读'),
          s.gateSaving ? h('span', { className: 'cc-muted', key: 'hint' }, '规则处理中…') : null),
      ]

      var note = h('div', { className: 'cc-note' },
        '压缩：' + (s.enabled
          ? '触发 ~' + fmt(s.triggerTokens) + ' / 保留 ~' + fmt(s.retainTokens) + '（窗口 ' + fmt(s.windowTokens) + '），仅影响之后新建的会话。'
          : '出厂默认（窗口 80% 压缩 / 保留 16%），仅影响之后新建的会话。')
        + ' 守则：' + (!s.gateReady ? '未装载，需重启桌面应用。'
          : s.gateEnabled
            ? kb(s.gateBytes) + ' 规则已常驻 system prompt，对所有会话的下一个请求生效，不被压缩稀释。'
            : '未注入，模型不会看到 R1/R2/R3。'))
      var status = s.error || s.gateError
        ? h('div', { className: 'cc-err' }, s.error || s.gateError)
        : h('div', { className: 'cc-ok' }, s.saving ? '正在保存…' : (s.enabled === s.applied ? '已与磁盘一致' : '待同步…'))

      var panel = open ? h('div', {
        className: 'cc-panel',
        ref: panelRef,
        'data-cache-control-panel': '1',
        style: {
          left: pos.left + 'px',
          bottom: pos.bottom == null ? undefined : pos.bottom + 'px',
          top: pos.top == null ? undefined : pos.top + 'px',
          maxHeight: (pos.maxHeight || 420) + 'px',
        },
      },
        header,
        h(React.Fragment, null, cacheSection),
        h(React.Fragment, null, gateSection),
        note,
        status) : null

      // portal 到 body：这是加固，不是主因（主因见上面 place() 的朝向）。实测夹具
      // （cc-fixture.mjs，A/B/C 三 variant）表明：面板留在插槽里但朝向正确时同样完整
      // 可见 —— 因为 fixed 的包含块一旦被带 transform 的祖先接管，就跳出了输入卡片的
      // overflow:hidden。portal 消除的是另一类组合：祖先 contain:paint / 卡片自身既是
      // 包含块又是裁剪盒。宿主自己也是这么做的（dsh-client-ui-attachment 注释：
      // "body portal for the same transformed-ancestor reason"）。react-dom 是平台
      // seed 词，插件可直接 require。
      var portaled = panel && ReactDOM && ReactDOM.createPortal && typeof document !== 'undefined' && document.body
        ? ReactDOM.createPortal(panel, document.body)
        : panel

      // ---- chip：两段各自可点（点哪段切哪个），竖线分隔，右侧 ▾ 才弹滑杆面板 ----
      var cacheTitle = '省缓存 · 会话压缩策略：' + (s.enabled
        ? '开（触发 ~' + fmt(s.triggerTokens) + ' / 保留 ~' + fmt(s.retainTokens) + '，窗口 ' + fmt(s.windowTokens) + '）'
        : '关（出厂默认 80% / 16%）')
        + '\n生效范围：只影响之后新建的"标准模式"会话。\n点这一段 = 直接开/关；要拖滑杆点右侧 ▾。'
      var gateTitle = '会话守则 · 长期规则：' + (!s.gateReady ? '未装载，需重启桌面应用。'
        : (s.gateEnabled ? '开（' : '关（') + kb(s.gateBytes) + ' · ' + s.gateLines + ' 行 · '
          + (s.gateSource === 'override' ? '自定义' : '内置') + '）'
          + '\nR1 独立研判 / R2 必要提问 / R3 分工固定，常驻 system prompt。'
          + '\n生效范围：所有会话（含子代理）的下一个请求，不被压缩稀释。'
          + '\n点这一段 = 直接开/关；要看或改规则点右侧 ▾。')
      var caretTitle = '滑杆与规则面板：压缩触发点 / 保留尾部 / 自动压缩 / 查看·重读规则（气泡置顶与对话页宽度在设置页）'

      return h(React.Fragment, null,
        h('span', {
          className: 'cc-chip' + ((s.enabled || s.gateEnabled) ? ' on' : ''),
          ref: btnRef,
          'data-cache-control-toggle': '1',
        },
          h('button', {
            type: 'button',
            className: 'cc-seg' + (s.enabled ? ' on' : ''),
            disabled: s.loading,
            'aria-pressed': s.enabled === true,
            title: cacheTitle,
            onClick: flipCache,
          },
            h('span', { className: 'cc-segLabel' }, '省缓存'),
            OnOff(s.enabled)),
          h('span', { className: 'cc-div' }),
          h('button', {
            type: 'button',
            className: 'cc-seg' + (s.gateEnabled && s.gateReady ? ' on' : ''),
            disabled: s.loading || !s.gateReady,
            'aria-pressed': s.gateEnabled === true && s.gateReady === true,
            title: gateTitle,
            onClick: flipGate,
          },
            h('span', { className: 'cc-segLabel' }, '提问'),
            OnOff(s.gateEnabled, !s.gateReady)),
          h('button', {
            type: 'button',
            className: 'cc-caret',
            'aria-haspopup': 'dialog',
            'aria-expanded': open === true,
            title: caretTitle,
            onClick: togglePanel,
          }, '▾')),
        portaled)
    }

    // ---------------------------------------------------------------- 入口 --
    function apply(ctx) {
      var slots = ctx.get('slots')
      ctx.effect(function () { return styles.insert(CSS) }, 'cache-control-styles')
      // 卸载时把外观痕迹清干净：属性、CSS 变量、标记元素、三条观察器都不该留下。
      ctx.effect(function () {
        return function () {
          stopPinWatch()
          stopFitWatch()
          stopWidthWatch()
          if (domReady()) {
            document.documentElement.removeAttribute('data-cc-pin-last-user')
            document.documentElement.removeAttribute('data-cc-clear-bubble')
            document.documentElement.style.removeProperty('--cc-pin-blur')
            document.documentElement.style.removeProperty('--cc-user-bubble-max')
          }
        }
      }, 'cache-control-appearance')
      var errors = []
      if (slots !== undefined) {
        try {
          slots.inject('settings.section', function () {
            return slots.register(
              { name: 'settings.section', id: 'cache-control', order: 58, label: '会话策略' },
              function () { return h(CacheControlPage) })
          })
        } catch (e) { errors.push('settings.section: ' + String((e && e.message) || e)) }
      }
      // ---- 错误边界：chip 渲染若抛错，显示占位（不再被槽静默丢弃）----
      class ChipBoundary extends React.Component {
        constructor(props) { super(props); this.state = { err: null } }
        static getDerivedStateFromError(e) { return { err: String((e && e.message) || e) } }
        render() {
          if (this.state.err) return h('span', { 'data-cc-err': '1', style: { fontSize: '11px', color: '#c0392b' } }, '会话策略(错误)')
          return this.props.children
        }
      }

      // ---- 主入口：conversation.input.right —— 输入区右侧（模型选择器旁） ----
      var rightEntry = {
        name: 'conversation.input.right',
        id: 'cache-control',
        order: 200,
        label: '会话策略',
        inject: function () { return { modelAware: true } },
      }
      if (slots !== undefined) {
        slots.inject('conversation.input.right', function () {
          return slots.register(rightEntry, function () {
            return React.createElement(ChipBoundary, null, h(CacheControlComposerChip))
          })
        })
      }
      load()
      if (errors.length) console.warn('[dsh-cache-control] slot issues: ' + errors.join(' | '))
      console.log('[dsh-cache-control] client up')
    }

    exports.apply = apply
    exports.inject = ['slots']
    // 离线回归用的测试缝（浏览器端不读）：chip 点击是否"点哪段切哪个"、外观开关
    // 是否真的落到 <html> 与钉住标记上，只能靠直接调用这些函数来断言。
    exports.internals = {
      STORE: STORE,
      flipCache: flipCache,
      flipGate: flipGate,
      applyAppearance: applyAppearance,
      applyPin: applyPin,
      pinTarget: pinTarget,
      fitUserBubbles: fitUserBubbles,
      clearFit: clearFit,
      pinWheelHandler: pinWheelHandler,
      lineBoxes: lineBoxes,
      startFitWatch: startFitWatch,
      stopFitWatch: stopFitWatch,
      domReady: domReady,
      setPinLastUser: setPinLastUser,
      setClearBubble: setClearBubble,
      setPinBlur: setPinBlur,
      setPinMaxVh: setPinMaxVh,
      clampPinMaxVh: clampPinMaxVh,
      clampBlur: clampBlur,
      bubbleMaxEm: function () { return USER_BUBBLE_MAX_EM },
      setBubbleMaxEm: function (v) {
        USER_BUBBLE_MAX_EM = Math.min(120, Math.max(8, Math.round(Number(v) * 10) / 10 || 41))
        applyAppearance(STORE.state)
      },
      // 兼容旧测试缝：给 px 就按当前会话字号折算成 em。
      setBubbleMaxPx: function (v) {
        var fs = 15
        try {
          if (typeof getComputedStyle === 'function' && document.documentElement) {
            fs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-content-font-size')) || 15
          }
        } catch (e) { /* 用默认字号 */ }
        USER_BUBBLE_MAX_EM = Math.min(120, Math.max(8, Math.round((Number(v) || 620) / fs * 10) / 10))
        applyAppearance(STORE.state)
      },
      applyChatWidth: applyChatWidth,
      pinChatWidth: pinChatWidth,
      findChatRoot: findChatRoot,
      setChatWidthEnabled: setChatWidthEnabled,
      commitChatWidth: commitChatWidth,
      setForceOpen: function (v) { FORCE_OPEN = !!v },
      setFoldsOpen: function (v) { FOLD_DEFAULT_OPEN = !!v },
      chipText: function () {
        return { enabled: STORE.state.enabled, gateEnabled: STORE.state.gateEnabled, gateReady: STORE.state.gateReady }
      },
    }
    return module.exports
  },
})
