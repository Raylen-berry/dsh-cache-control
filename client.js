// ============================================================================
// dsh-cache-control · Client half
//
// 设置页七块互相独立的开关（名称都压到 2–4 字，细节写在卡片正文里；**标题不带序号**）：
//   * 会话守则 —— 把 session-gate.md 常驻注入 system prompt
//     （每个 model step 重新组装，故对已打开的会话下一步即生效，且不被压缩稀释）。
//   * ponytail —— 第二段常驻规则（编码纪律），与守则互不影响。
//   * 输出形状 —— 第三段常驻规则（v1.12.0，并入自 dsh-output-shape），与上面两段同构、独立开关，
//     但**默认开**（并入前它就是这套规则的真源）。它也是 i-have-adhd / ponytail 两条按需技能的注册者。
//   * 自动审查 —— 注册**按需技能** auto-code-review：一个字都不进 system prompt；
//     审什么文件、按哪条规则，每次现向外部 ocr（open-code-review）的 delegate 模式取。
//   * 气泡置顶 —— 最近一条「我的提问」钉顶（圆角矩形毛玻璃底衬随这条提问的实际长度
//     伸缩，长文限高 38vh、滚轮在气泡内滚，模糊度可调）、我的气泡透明。
//   * 对话页 —— 固定会话列宽（原 bg-atelier「底图工坊 · 对话页」区，2026-09-07 移入）。
//   * 存储 —— 各用途占盘统计与清理。
// 为什么 v1.11.1 起去掉圈符编号：编号是"位置属性"，插一张卡就得把全部下游引用重排一遍 ——
// v1.10.2（ponytail 曾写作 "②b" ⇒ 页面上出现两个 ②）与 v1.11.0（插入自动审查令后面全部顺延）
// 已经为此返工两次。指代某块请直接说名字。
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
    // v1.9.3：设置页与面板的开关/按钮改用宿主官方原子（Switch/Button），随主题与明暗。
    // 与 react-dom 同款软失败：拿不到（旧宿主/HMR 未预热）就退回本文件自带的 cc-* 控件，
    // 功能一律不受影响 —— 仿 dsh-note-changes 的 `P = require(...) || null` + 逐点守卫。
    var P = null
    try { P = require('@deepseek-ai/dsh-client-ui-primitives') } catch (e) { P = null }
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
      '.cc-analysis-area{margin-bottom:20px}.cc-policy-tools{margin-bottom:22px}.cc-policy-stack{display:flex;flex-direction:column;gap:12px;min-width:0}.cc-policy-toolbar{display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:14px}.cc-policy-tool{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;padding:8px 14px;font:inherit;cursor:pointer}.cc-policy-tool[aria-pressed=true]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.cc-policy-fields{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap}.cc-policy-field{display:flex;flex-direction:column;gap:8px;min-width:0;flex:1;font-size:12px}.cc-select{max-width:100%;min-width:0;padding:9px 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);font:inherit}.cc-policy-preview,.cc-feedback{padding:15px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);line-height:1.7}.cc-global-caption{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.8;margin:0 0 20px}.cc-diff-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;min-width:0}.cc-diff-grid>div{min-width:0}.cc-diff{white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto;font:inherit;font-size:12px;line-height:1.7;padding:12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1)}.cc-diff.removed{border-left:3px solid #b45a64}.cc-diff.added{border-left:3px solid #418961}.cc-diagnostic-row{display:grid;grid-template-columns:100px 1fr;gap:15px;padding:14px 0;border-bottom:1px solid var(--dsw-alias-border-l1);line-height:1.7}.cc-wrap{flex-wrap:wrap}@media(max-width:760px){.cc-diff-grid{grid-template-columns:1fr}.cc-policy-fields{align-items:stretch;flex-direction:column}.cc-diagnostic-row{grid-template-columns:1fr;gap:7px}}',
      '.cc-scope-label{font-size:10px;color:var(--dsw-alias-label-secondary);padding:0 5px;white-space:nowrap}',
      '.cc-page{display:flex;flex-direction:column;gap:18px;max-width:680px}',
      '.cc-page.cc-workbench{max-width:1040px;width:100%;min-width:0;gap:24px;color:var(--dsw-alias-label-primary);font-size:13px}',
      '.cc-workbench *{box-sizing:border-box}.cc-workbench button:focus-visible,.cc-workbench textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:3px}',
      '.cc-workbench-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.cc-workbench-title{font-size:26px;letter-spacing:-.7px;line-height:1.25;font-weight:650;margin:0 0 10px}.cc-eyebrow{font-size:11px;letter-spacing:2px;color:var(--dsw-alias-label-secondary);margin-bottom:12px}.cc-head-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}',
      '.cc-save-state{display:inline-flex;align-items:center;gap:7px;font-size:12px;white-space:nowrap;color:var(--dsw-alias-label-secondary)}.cc-save-state:before{content:"";width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-success,#2da44e)}.cc-save-state.pending:before{background:var(--dsw-alias-label-warning,#c58d35)}',
      '.cc-workbench-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--dsw-alias-border-l1);border-radius:14px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}.cc-workbench-summary>div{padding:17px 20px;min-width:0}.cc-workbench-summary>div+div{border-left:1px solid var(--dsw-alias-border-l1)}.cc-workbench-summary strong{display:block;font-size:18px;font-weight:600;margin:5px 0}.cc-workbench-summary small{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.cc-workbench-tabs{display:flex;gap:6px;padding:5px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}.cc-workbench-tab{flex:1;min-width:0;display:flex;gap:8px;align-items:center;justify-content:center;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:11px 12px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;transition:background .15s,color .15s}.cc-workbench-tab:hover{background:var(--dsw-alias-bg-hover,rgba(128,128,128,.1))}.cc-workbench-tab[aria-selected=true]{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary);font-weight:600}.cc-tab-dot{height:5px;width:5px;border-radius:50%;background:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.cc-tab-intro{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:20px}.cc-tab-intro h2{font-size:17px;font-weight:600;margin:0 0 6px}.cc-tab-intro p{margin:0;color:var(--dsw-alias-label-secondary);line-height:1.7}.cc-rule-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.cc-rule-grid>section{display:flex;flex-direction:column;min-width:0}.cc-rule-grid>section.is-editing{grid-column:1/-1}.cc-rule-grid .cc-card{flex:1}.cc-section-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}.cc-section-head .cc-h{margin:0}.cc-section-caption{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0 0 13px;line-height:1.6}.cc-section-kind{font-size:10px;padding:3px 7px;border-radius:5px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.12));color:var(--dsw-alias-label-secondary)}',
      '.cc-workbench .cc-card{padding:20px;border-radius:14px;gap:15px;min-width:0}.cc-workbench .cc-swRow{line-height:1.7}.cc-workbench .cc-note,.cc-workbench .cc-path{overflow-wrap:anywhere}.cc-rule-preview{white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto;font-family:inherit;font-size:12px;line-height:1.8;margin:0}.cc-workbench .cc-textarea{min-height:240px;resize:vertical;line-height:1.8}.cc-workbench .cc-appearance-grid{display:grid;gap:22px}.cc-workbench-footer{display:flex;justify-content:space-between;gap:16px;padding-top:4px;color:var(--dsw-alias-label-secondary);font-size:11px}.cc-inline-alert{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px}.cc-storage-row{display:grid;grid-template-columns:minmax(0,1fr) 96px;gap:7px 16px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.cc-storage-row small{grid-column:1/-1;color:var(--dsw-alias-label-secondary);line-height:1.6}.cc-storage-meter{height:4px;background:var(--dsw-alias-border-l1);border-radius:4px;grid-column:1/-1;overflow:hidden}.cc-storage-meter>span{display:block;height:100%;border-radius:4px;background:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '@media(max-width:760px){.cc-rule-grid{grid-template-columns:1fr}.cc-workbench-head{flex-direction:column;gap:8px}.cc-workbench-summary>div{padding:14px 12px}.cc-workbench-summary strong{font-size:16px}.cc-workbench .cc-card{padding:16px}.cc-head-actions{align-self:stretch;justify-content:space-between}.cc-workbench-tab{padding:10px 6px;font-size:12px}.cc-tab-intro{flex-direction:column;gap:8px}.cc-workbench .cc-row{flex-wrap:wrap}.cc-workbench-footer{flex-wrap:wrap}}',
      '.cc-h{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);margin:0 0 4px}',
      '.cc-sub{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0 0 10px;line-height:1.7}',
      '.cc-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:12px}',
      '.cc-workbench label.cc-row{flex-wrap:nowrap;align-items:flex-start;line-height:1.7}.cc-workbench label.cc-row input{flex-shrink:0;margin-top:5px}.cc-workbench .cc-storage-row .cc-val{min-width:0}.cc-workbench .cc-storage-row>.cc-btn{justify-self:start}.cc-review-details{overflow-wrap:anywhere}',
      '.cc-row{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--dsw-alias-label-primary)}',
      // 开/关行（v1.9.3）：说明文字在左、宿主 Switch 在右，两端对齐。
      '.cc-swRow{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.cc-swLabel{flex:1;min-width:0}',
      '.cc-row input[type=range]{flex:1;min-width:120px;accent-color:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.cc-val{min-width:118px;text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:pre}',
      '.cc-note{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.7;border-left:2px solid var(--dsw-alias-brand-primary,#4d6bfe);padding-left:10px}',
      '.cc-err{font-size:12px;color:var(--dsw-alias-label-danger,#e5534b)}',
      '.cc-warn{font-size:12px;color:var(--dsw-alias-label-warning,#b8860b)}',
      '.cc-ok{font-size:12px;color:var(--dsw-alias-label-success,#2da44e)}',
      '.cc-muted{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      // ---- 省 token 卡（v1.13.0）的 KPI 小格与字节条（其余页面元素全复用上面已有的类）----
      '.cc-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,128px),1fr));gap:10px}',
      '.cc-kpi{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;min-width:0;display:flex;flex-direction:column;gap:3px}',
      '.cc-kpiV{font-size:19px;font-weight:650;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.cc-kpiS{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.35}',
      '.cc-barTrack{flex:1;height:8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.15));overflow:hidden}',
      '.cc-barFill{height:100%;background:var(--dsw-alias-brand-primary,#4d6bfe);opacity:.85}',
      '.cc-path{font-size:11px;color:var(--dsw-alias-label-tertiary);word-break:break-all;line-height:1.6}',
      '.cc-tag{display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.cc-tag.warn{border-color:var(--dsw-alias-label-warning,#b8860b);color:var(--dsw-alias-label-warning,#b8860b)}',
      '.cc-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);height:26px;padding:0 10px;border-radius:7px;font-size:12px;cursor:pointer}',
      '.cc-btn:hover{border-color:var(--dsw-alias-border-l3)}',
      '.cc-btn:disabled{opacity:.55;cursor:default}',
      // 常用宽度快捷按钮（对话页卡）：与 cc-btn 同族但更矮更轻，选中态用品牌色描边
      '.cc-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}',
      '.cc-mini{border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));background:transparent;color:var(--dsw-alias-label-secondary);height:22px;padding:0 8px;border-radius:6px;font-size:11.5px;line-height:1;cursor:pointer;transition:border-color .12s,color .12s}',
      '.cc-mini:hover{border-color:var(--dsw-alias-border-l3)}',
      '.cc-mini.on{border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.cc-textarea{width:100%;box-sizing:border-box;min-height:220px;resize:vertical;font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:12px;line-height:1.65;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px}',
      // ---- 设置页「说明」抽屉: 默认收起, 点按钮才展开正文 (样式参照会话守则卡「编辑规则」的点开式) ----
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
      // ---- chip 内每个可点段：点「提问」切门禁、点 ponytail / 形状切各自规则，点 ▾ 弹面板 ----
      '.cc-seg{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;border:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;line-height:1;height:20px;padding:0 5px;border-radius:999px;cursor:pointer;transition:background-color .12s}',
      '.cc-seg:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '.cc-seg:disabled{cursor:default;opacity:.55}',
      '.cc-seg .cc-segLabel{color:var(--dsw-alias-label-secondary)}',
      '.cc-seg.on .cc-segLabel{color:var(--dsw-alias-label-primary)}',
      '.cc-caret{display:inline-flex;align-items:center;justify-content:center;width:24px;height:22px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:1;border-radius:999px;cursor:pointer;transition:background-color .12s,color .12s}',
      '.cc-caret:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary)}',
      '.cc-caret:disabled{cursor:default;opacity:.55}',
      // 隐藏 DSH 原生拖拽把手（可选开关，用户 2026-09-14）：按语义打标记，见 markResizers()。
      // 用属性选择器而不是类名 —— 宿主的类名是 CSS-module 哈希（实测 _1tdjgG_handle），一升级就变。
      // v1.7.0 起两个开关两套标记：resizer = 会话区两竖杠（宽度把手），divider = 侧栏/详情栏分隔条。
      '[data-cc-hide-resizer]{display:none!important}',
      '[data-cc-hide-divider]{display:none!important}',
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
      // ---- 2026 微调: chip 段标签与旁边的「开/关」不在同一水平线 ⇒ 标签下移、徽标做小、
      //      间距收紧。一律用 em（相对 chip 自己的字号），chip 字号变化/DPI 缩放时同步跟着走，
      //      而不是钉死 0.2px / 13px 这种一次性数值（面板、分区头里的同名徽标不受影响）。
      '.cc-chip .cc-seg{gap:.35em}',
      '.cc-chip .cc-segLabel{position:relative;top:.017em}',
      '.cc-chip .cc-badge{height:1.13em;min-width:.78em;font-size:.87em;border-radius:.26em}',
      '.cc-panel{z-index:2147483400;position:fixed;width:302px;box-sizing:border-box;max-height:calc(100vh - 24px);overflow:auto;overscroll-behavior:contain;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff)));color:var(--dsw-alias-label-primary);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.32);display:flex;flex-direction:column;gap:9px;padding:11px 12px;font-size:12px}',
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
      // ---- 空会话「工作区行」左边缘对齐输入卡（2026-09-28 实测复现）----
      //   宿主自己就跟自己对不齐：.heroWorkspaceRow 是 padding:0 16px 0 20px，而 heroModeClusterCss
      //   又把右内边距改成 20px —— 输入卡所在容器只有 16px 内边距，所以本来就差 4px。
      //   本插件的「对话页宽度」再把 --dsh-composer-card-max-width 换成 P% 之后，卡还要在容器**内容区**
      //   里居中一次，偏移变成 (1−P%)×内容宽/2，4px 变几十像素。
      //   本机 hero 页实测（列宽 1144、P=90%）：卡 left=387.73、行里 chip left=340.70 ⇒ **差 47.03px**。
      //   所以别去凑那 20px：行左右内边距都用宿主发布的 --dsh-composer-side-clearance（16px），
      //   再让第一个子元素按**卡自己的居中公式**左移。
      //   关键：卡的宽度是 `width:100%` 被 max-width 夹住的（.uV2eYG_card），所以 max(0px, …) 不能省 ——
      //   窄窗（列宽 <~754px）下宿主默认的 px 卡宽被 width:100% 夹住、富余量是 0，
      //   公式却会算出负值，chip 会反而左移 22px。夹到 0 之后两种情况都严格对齐。
      'html [class*="_heroWorkspaceRow"]{padding-left:var(--dsh-composer-side-clearance,16px) !important;padding-right:var(--dsh-composer-side-clearance,16px) !important;box-sizing:border-box}',
      'html [class*="_heroWorkspaceRow"]>:first-child{margin-left:max(0px, calc((100% - var(--dsh-composer-card-max-width,100%)) / 2)) !important}',
    ].join('\n')

    // ---------------------------------------------------------------- 状态 --
    var STORE = {
      state: {
        loading: true,
        loaded: false,   // 是否成功从 host 读到过设置；未读到前禁止保存（否则会把默认值盖到用户的真实值上）
        saving: false,
        error: '',
        // 会话门禁（长期规则）
        gateEnabled: false,
        gateSource: 'builtin',
        gateBuiltinPath: '',
        gateOverridePath: '',
        gateBytes: 0,
        gateMaxBytes: 6144,
        gateLines: 0,
        gateTruncated: false,
        // 截断明细（v1.6.2）：原文字节数与实际注入字节数。旧 host 不带这两个字段时
        // 由 applyGate 退化成 gateBytes（见那里的兜底），界面照样有数可显示。
        gateOriginalBytes: 0,
        gateKeptBytes: 0,
        gateText: '',
        gateOpen: false,
        gateDraft: null,
        gateSaving: false,
        gateError: '',
        // host 半没有 /cc/gate.json 时（旧版未重启）为 false：界面提示，不假装可用
        gateReady: true,
        // ponytail 编码纪律（v1.10.0）：与门禁同构的第二段常驻规则，独立开关
        ponytailEnabled: false,
        ponytailSource: 'builtin',
        ponytailBuiltinPath: '',
        ponytailOverridePath: '',
        ponytailBytes: 0,
        ponytailMaxBytes: 6144,
        ponytailLines: 0,
        ponytailTruncated: false,
        ponytailOriginalBytes: 0,
        ponytailKeptBytes: 0,
        ponytailText: '',
        ponytailOpen: false,
        ponytailDraft: null,
        ponytailSaving: false,
        ponytailError: '',
        ponytailReady: true,
        // 输出形状（v1.12.0，并入自 dsh-output-shape）：第三段常驻规则。与上面两段同构，
        // 但**默认开**（并入前那插件是这套规则的真源），故初值就是 true。
        shapeEnabled: true,
        shapeSource: 'builtin',
        shapeBuiltinPath: '',
        shapeOverridePath: '',
        shapeBytes: 0,
        shapeMaxBytes: 6144,
        shapeLines: 0,
        shapeTruncated: false,
        shapeOriginalBytes: 0,
        shapeKeptBytes: 0,
        shapeText: '',
        shapeDraft: null,
        shapeSaving: false,
        shapeError: '',
        shapeReady: true,
        // 逃生开关 DSH_OUTPUT_SHAPE_DISABLE=1 压过设置：界面要能说出"开关开着但没注入"。
        shapeDisabledByEnv: false,
        // 自动代码审查（v1.11.0）：**按需技能**，不注入常驻段 ⇒ residentBytes 恒 0。
        reviewEnabled: true,
        reviewRegistered: false,
        reviewSkillPath: '',
        reviewSkillBytes: 0,
        reviewOcrFound: false,
        reviewOcrVersion: '',
        reviewOcrCommand: '',
        reviewSaving: false,
        reviewError: '',
        reviewReady: true,   // false = 当前运行的 host 还没有 /cc/review.json
        reviewOcrBusy: false,
        // 会话区外观
        pinLastUser: false,
        clearBubble: false,
        pinBlur: 10,        // 钉顶底衬（圆角矩形毛玻璃）的模糊半径 px，0–24
        pinMaxVh: 38,       // 被钉气泡自身的最高高度（vh），12–80；超出部分在气泡内滚
        pinMarked: '',
        fitTick: 0,        // 「重读」按钮用的自增计数：只为触发一次重渲染去重新读实测值
        appearanceReady: true,
        // 对话页固定宽度（原 bg-atelier「底图工坊 · 对话页」区，移入本插件）
        chatWidth: 80,      // v1.5.0 起是**百分比**（30–100），不再是 px
        chatWidthEnabled: false,
      },
      listeners: [],
      set: function (patch) {
        if (!Object.keys(patch).some(function (key) { return STORE.state[key] !== patch[key] })) return
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

    /**
     * 对话页宽度：**百分比**（v1.5.0 起，原来是 640–3840px）。30–100 取整，与 host 侧同口径。
     * 迁移：盘上存的 px 值（>100，例如 900）一律当旧值，落到默认 80% —— 900px 在本机
     * 1139px 的会话区里正好≈79%，所以 80% 是等价的观感；转换需要知道当时的区域宽度，
     * 与其瞎猜一个像素反而更不协调，不如明确落到 80% 由用户自己加减。
     */
    var CHAT_PCT_MIN = 30
    var CHAT_PCT_MAX = 100
    var CHAT_PCT_DEFAULT = 80
    function clampChatWidth(v) {
      var n = Math.round(Number(v))
      if (!Number.isFinite(n) || n <= 0 || n > CHAT_PCT_MAX) return CHAT_PCT_DEFAULT
      return Math.min(CHAT_PCT_MAX, Math.max(CHAT_PCT_MIN, n))
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
        // 旧 host（v1.6.1 及以前）只给 bytes/maxBytes，且它的 truncated 是"长度到没到上限"猜的
        // —— 缺 originalBytes/keptBytes 时退化成 bytes，界面不至于显示 NaN。
        gateOriginalBytes: Number(g.originalBytes) || Number(g.bytes) || 0,
        gateKeptBytes: Number(g.keptBytes) || Number(g.bytes) || 0,
        gateText: typeof g.text === 'string' ? g.text : '',
        gateEnabled: g.enabled === undefined ? STORE.state.gateEnabled : !!g.enabled,
      }
    }

    /** ponytail 元数据 → STORE 补丁：与 applyGate 同构，键前缀换成 ponytail。 */
    function applyPonytail(p) {
      if (!p || (p.bytes === undefined && p.text === undefined)) return {}
      return {
        ponytailReady: true,
        ponytailSource: p.source || 'builtin',
        ponytailBuiltinPath: p.builtinPath || '',
        ponytailOverridePath: p.overridePath || '',
        ponytailBytes: Number(p.bytes) || 0,
        ponytailMaxBytes: Number(p.maxBytes) || 6144,
        ponytailLines: Number(p.lines) || 0,
        ponytailTruncated: !!p.truncated,
        ponytailOriginalBytes: Number(p.originalBytes) || Number(p.bytes) || 0,
        ponytailKeptBytes: Number(p.keptBytes) || Number(p.bytes) || 0,
        ponytailText: typeof p.text === 'string' ? p.text : '',
        ponytailEnabled: p.enabled === undefined ? STORE.state.ponytailEnabled : !!p.enabled,
      }
    }

    /** 输出形状元数据 → STORE 补丁：与 applyPonytail 同构，键前缀换成 shape（v1.12.0）。 */
    function applyShape(p) {
      if (!p || (p.bytes === undefined && p.text === undefined)) return {}
      return {
        shapeReady: true,
        shapeSource: p.source || 'builtin',
        shapeBuiltinPath: p.builtinPath || '',
        shapeOverridePath: p.overridePath || '',
        shapeBytes: Number(p.bytes) || 0,
        shapeMaxBytes: Number(p.maxBytes) || 6144,
        shapeLines: Number(p.lines) || 0,
        shapeTruncated: !!p.truncated,
        shapeOriginalBytes: Number(p.originalBytes) || Number(p.bytes) || 0,
        shapeKeptBytes: Number(p.keptBytes) || Number(p.bytes) || 0,
        shapeText: typeof p.text === 'string' ? p.text : '',
        shapeEnabled: p.enabled === undefined ? STORE.state.shapeEnabled : !!p.enabled,
        shapeDisabledByEnv: p.disabledByEnv === true,
      }
    }

    /** settings.json 的响应可同时带 gate / ponytail / shape 元数据；res.settings 为空时只更新元数据。 */
    function pull(res) {
      var patch = applyGate(res && res.gate)
      var ponyPatch = applyPonytail(res && res.ponytail)
      for (var pk in ponyPatch) patch[pk] = ponyPatch[pk]
      var shapePatch = applyShape(res && res.shape)
      for (var sk in shapePatch) patch[sk] = shapePatch[sk]
      var s = res && res.settings
      if (s) {
        patch.gateEnabled = s.gateEnabled === true
        // 旧 host 的 sanitize 不认识 ponytailEnabled ⇒ undefined。这里**不能**照抄
        // gateEnabled 的 `=== true` 写法：那会把 applyPonytail 从 /cc/ponytail.json
        // 读到的真值覆盖成 false（v1.10.0 首版就栽在"只改 gate 不改 settings"这类串扰上）。
        // 只有字段真的存在才表态，否则保留元数据里的生效值。
        if (s.ponytailEnabled !== undefined) patch.ponytailEnabled = s.ponytailEnabled === true
        // v1.12.0：输出形状默认**开**，所以这里既不能写 `=== true`（旧盘没这个键会被判成关），
        // 也不能无条件覆盖（会把 /cc/shape.json 读到的真值冲掉）。字段存在才表态。
        if (s.shapeEnabled !== undefined) patch.shapeEnabled = s.shapeEnabled !== false
        patch.pinLastUser = s.pinLastUser === true
        patch.clearBubble = s.clearBubble === true
        patch.pinBlur = clampBlur(s.pinBlur)
        patch.pinMaxVh = clampPinMaxVh(s.pinMaxVh)
        // 对话页固定宽度（bg-atelier 移入）：host 侧 sanitize 负责区间钳制。
        // v1.5.0 起是百分比；盘上的旧 px 值（>100）会被 clampChatWidth 落到默认 80%。
        patch.chatWidth = clampChatWidth(s.chatWidth)
        patch.chatWidthEnabled = s.chatWidthEnabled === true
        // 隐藏原生拖拽条（v1.6.0，v1.7.0 拆成两个开关）：**每个键单独一个能力位**，
        // 不并进上面的 appearanceReady —— 旧 host 不认识某个键时，只该禁用对应那一个开关，
        // 不能连带把其它开关一起禁用。
        patch.hideResizer = s.hideResizer === true
        patch.resizerReady = s.hideResizer !== undefined
        // v1.7.0：hideResizer 收窄为"只管会话区两竖杠（宽度把手）"；侧栏/详情栏分隔条
        // 另起 hideDivider（默认关 —— 那条拖了是有反应的，不该被顺手藏掉）。
        patch.hideDivider = s.hideDivider === true
        patch.dividerReady = s.hideDivider !== undefined
        // 旧 host 的 sanitize 不认识这些字段，任何一次写盘都会把它们抹掉 ⇒
        // 只有响应里真的带回来才算能力就绪，否则界面禁用这几项并说明原因。
        patch.appearanceReady = s.pinLastUser !== undefined && s.clearBubble !== undefined
          && s.pinBlur !== undefined && s.pinMaxVh !== undefined
          && s.chatWidth !== undefined && s.chatWidthEnabled !== undefined
        patch.loading = false
        patch.loaded = true
        patch.error = ''
        // 旧版 host 的响应里没有 gate 字段 ⇒ 门禁能力未装载
        if (res.gate === undefined) patch.gateReady = false
        // 同理：ponytail 字段缺失 = host 半还是 v1.9.x，界面禁用并提示重启
        if (res.ponytail === undefined) patch.ponytailReady = false
        // v1.12.0：shape 字段缺失 = host 半还是 v1.11.x（还没并入输出形状），卡片禁用并提示重启。
        // 这条尤其重要：旧 host 的 sanitize 不认识 shapeEnabled，任何一次保存都会把它抹掉，
        // 而 shapeEnabled 默认开 ⇒ 用户会在"刷新过页面但没重启"的窗口里静默丢掉形状规则。
        if (res.shape === undefined) patch.shapeReady = false
        // v1.11.0：review 字段缺失 = host 半还没有 /cc/review.json，卡片禁用并提示重启
        if (res.review !== undefined) {
          patch.reviewReady = true
          var rv = res.review
          patch.reviewEnabled = rv.enabled !== false
          patch.reviewRegistered = !!rv.registered
          patch.reviewSkillPath = rv.skillPath || ''
          patch.reviewSkillBytes = Number(rv.skillBytes) || 0
          patch.reviewOcrFound = !!rv.ocrFound
          patch.reviewOcrVersion = rv.ocrVersion || ''
          patch.reviewOcrCommand = rv.ocrCommand || ''
        }
      }
      STORE.set(patch)
      applyAppearance(STORE.state)
    }

    var settingsReadRevision = 0
    function load() {
      if (settingsWrite || Object.keys(pendingSettings).length || ['gate','ponytail','shape'].some(function(pre){return STORE.state[pre+'Saving']})) return
      var revision = ++settingsReadRevision
      STORE.set({ loading: true })
      jsonFetch('/cc/settings.json')
        .then(function(res){if(revision === settingsReadRevision)pull(res)})
        .catch(function (e) {
          if(revision === settingsReadRevision)STORE.set({ loading: false, error: '加载失败: ' + String(e) })
        })
      // 审查卡的状态（ocr 装没装、技能注册了没）在另一条路由上：settings.json 里没有它，
      // 所以单独拉一次。旧 host 返回 404 ⇒ reviewReady=false，卡片自己会提示重启。
      reloadReview()
    }

    /** v1.11.0：拉审查卡状态。enabled 与 registered 都以 host 为准，前端不自己判。 */
    var reviewRevision = 0
    function reloadReview() {
      if (STORE.state.reviewSaving) return
      var revision = ++reviewRevision
      return jsonFetch('/cc/review.json')
        .then(function (res) {
          if (revision !== reviewRevision) return
          var rv = res && res.review
          if (!rv) return
          STORE.set({
            reviewReady: true,
            reviewEnabled: rv.enabled !== false,
            reviewRegistered: !!rv.registered,
            reviewSkillPath: rv.skillPath || '',
            reviewSkillBytes: Number(rv.skillBytes) || 0,
            reviewOcrFound: !!rv.ocrFound,
            reviewOcrVersion: rv.ocrVersion || '',
            reviewOcrCommand: rv.ocrCommand || '',
            reviewError: '',
          })
        })
        .catch(function (e) { if (revision === reviewRevision) STORE.set({ reviewReady: false, reviewError: '读取失败：' + String(e.message || e) }) })
    }

    /**
     * 宿主路由的两种调用形状，全插件只此一份实现：
     * - putJson：PUT 一段 JSON，resolve 出响应体（HTTP 层不管，交给调用方判 ok）
     * - jsonFetch：GET 并回读，404/非 2xx 直接抛（调用方靠错误文本判"接口不存在"）
     * 合并前这两条链在 9 处逐字重复。
     */
    function putJson(url, body) {
      return requestJson(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    }

    function jsonFetch(url) {
      return requestJson(url, { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.j })
    }

    function requestJson(url, options) {
      var controller = new AbortController(), timer
      var external = options && options.signal
      function abort() { controller.abort() }
      if (external) { if (external.aborted) abort(); else external.addEventListener('abort', abort, { once: true }) }
      var request = fetch(url, Object.assign({}, options, { signal: controller.signal }))
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j } }) })
      var deadline = new Promise(function (_, reject) {
        timer = setTimeout(function () { controller.abort(); reject(new Error('请求超时，请重试')) }, 10000)
      })
      return Promise.race([request, deadline]).finally(function () { clearTimeout(timer); if (external) external.removeEventListener('abort', abort) })
    }

    /** 切审查技能开关：走 /cc/review.json，host 侧负责注册/注销，不等主设置那条防抖保存。 */
    function setReviewEnabled(v) {
      if (STORE.state.reviewSaving || !STORE.state.reviewReady) return
      ++reviewRevision
      STORE.set({ reviewSaving: true, reviewError: '', reviewEnabled: v })
      putJson('/cc/review.json', { enabled: v === true })
        .then(function (res) {
          if (!res.ok || !res.j || res.j.ok !== true) throw new Error((res.j && res.j.error) || ('http ' + res.status))
          var rv = res.j.review || {}
          STORE.set({
            reviewSaving: false, reviewError: '',
            reviewRegistered: !!rv.registered,
            reviewEnabled: rv.enabled !== false,
          })
        })
        .catch(function (e) { STORE.set({ reviewSaving: false, reviewError: '保存失败: ' + String(e) }) })
    }

    var saveTimer = null
    var pendingSettings = {}, settingsWrite = null
    function scheduleSave(patch) {
      // 没成功读到过设置就不写盘：此刻 STORE 里是默认值，PUT 会把用户的真实参数盖掉。
      if (!STORE.state.loaded) {
        STORE.set({ error: '还没从宿主读到设置，已阻止保存（否则会用默认值盖掉你现在的配置）。刷新页面或重启桌面应用后重试。' })
        return
      }
      settingsReadRevision++
      STORE.set({ loading: false })
      Object.assign(pendingSettings, patch)
      if (saveTimer) clearTimeout(saveTimer)
      STORE.set({ saving: true, error: '' })
      saveTimer = setTimeout(saveNow, 250)
    }
    function saveNow() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
      if (settingsWrite || !Object.keys(pendingSettings).length) return settingsWrite || Promise.resolve()
      // 单个写入在途；下一轮只带用户改动的字段，避免抹掉其它窗口/独立接口的新值。
      var payload = pendingSettings, succeeded = false
      pendingSettings = {}
      STORE.set({ saving: true, error: '' })
      settingsWrite = putJson('/cc/settings.json', payload)
        .then(function (res) {
          if (!res.ok || !res.j || res.j.ok !== true) {
            throw new Error((res.j && res.j.error) || ('http ' + res.status))
          }
          succeeded = true
        })
        .catch(function (e) {
          pendingSettings = Object.assign({}, payload, pendingSettings)
          STORE.set({ saving: false, error: '改动尚未保存：' + String(e.message || e) })
        })
        .then(function () {
          settingsWrite = null
          if (succeeded && Object.keys(pendingSettings).length) return saveNow()
          if (succeeded) STORE.set({ saving: false, error: '', savedAt: Date.now() })
        })
      return settingsWrite
    }

    var ruleRevision = { gate: 0, ponytail: 0, shape: 0 }
    function acceptRule(pre, data) {
      var patch = (pre === 'gate' ? applyGate : pre === 'ponytail' ? applyPonytail : applyShape)(data)
      // 文本响应不能回滚另一路正在保存的规则开关。
      delete patch[pre + 'Enabled']
      STORE.set(patch)
    }
    function writeRule(pre, text) {
      if (STORE.state[pre + 'Saving']) return Promise.resolve()
      settingsReadRevision++
      STORE.set({ loading: false })
      var revision = ++ruleRevision[pre], draft = STORE.state[pre + 'Draft'], patch = {}
      patch[pre + 'Saving'] = true; patch[pre + 'Error'] = ''; STORE.set(patch)
      return putJson('/cc/' + pre + '.json', { text: text }).then(function (res) {
        if (!res.ok || !res.j || res.j.ok !== true) throw new Error((res.j && res.j.error) || ('http ' + res.status))
        return res.j[pre] ? res.j : jsonFetch('/cc/' + pre + '.json')
      }).then(function (res) {
        if (revision !== ruleRevision[pre]) return
        if (!res || !res[pre]) throw new Error('规则接口未返回保存结果，请重新读取')
        acceptRule(pre, res[pre])
        var done = {}; done[pre + 'Saving'] = false; done[pre + 'Error'] = ''
        if (STORE.state[pre + 'Draft'] === draft) done[pre + 'Draft'] = null
        STORE.set(done)
        policyChanged()
      }).catch(function (e) {
        if (revision !== ruleRevision[pre]) return
        var failed = {}; failed[pre + 'Saving'] = false; failed[pre + 'Error'] = '规则尚未保存：' + String(e.message || e); STORE.set(failed)
      })
    }
    function readRule(pre) {
      var draft = STORE.state[pre + 'Draft']
      if (STORE.state[pre + 'Saving'] || (draft !== null && draft !== STORE.state[pre + 'Text'])) return Promise.resolve()
      var revision = ++ruleRevision[pre]
      return jsonFetch('/cc/' + pre + '.json').then(function (res) {
        if (revision !== ruleRevision[pre]) return
        if (!res || !res[pre]) throw new Error('规则接口未就绪，请重启桌面应用')
        acceptRule(pre, res[pre])
        var patch = {}; patch[pre + 'Error'] = ''; STORE.set(patch)
      }).catch(function (e) {
        if (revision !== ruleRevision[pre]) return
        var patch = {}; patch[pre + 'Error'] = '规则读取失败：' + String(e.message || e); STORE.set(patch)
      })
    }

    /** 写规则文本；text 为 '' 表示删除 override、回到插件内置。 */
    function saveGateText(text) { return writeRule('gate', text) }

    function reloadGate() { return readRule('gate') }

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
      // 90ms → **两帧**（2026-09-15，与宽度那个"切会话闪一下"同一类排查）：
      // fitUserBubbles() 要量元素几何，而换会话瞬间新消息还没排版，**同步量到的是空/旧值**
      // —— 这正是它当初要延迟的原因，所以不能像宽度那样改同步。
      // 但 90ms 明显长于"排版完成"所需：两帧（rAF→rAF）足够等到布局稳定，
      // 又把可见的"晚一拍重排"压到最小。第一帧等样式/布局，第二帧量。
      fitTimer = requestAnimationFrame(function () {
        fitTimer = requestAnimationFrame(function () {
          fitTimer = 0
          fitSafe()
        })
      })
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
      if (fitTimer) { cancelAnimationFrame(fitTimer); fitTimer = 0 }   // fitTimer 现在是 rAF 句柄，不是定时器
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
      // 原生拖拽条的隐藏同样是"开关决定挂不挂"：关掉时必须把标记撤干净，别留一个不可见的把手。
      try { applyResizerHiding() } catch (e) { warnOnce('resizerWatch', e) }
    }

    function setPinLastUser(v) {
      if (!STORE.state.appearanceReady) return
      STORE.set({ pinLastUser: v })
      applyAppearance(STORE.state)
      scheduleSave({ pinLastUser: STORE.state.pinLastUser })
    }
    function setClearBubble(v) {
      if (!STORE.state.appearanceReady) return
      STORE.set({ clearBubble: v })
      applyAppearance(STORE.state)
      scheduleSave({ clearBubble: STORE.state.clearBubble })
    }
    /** 钉顶底衬的模糊度（px）：只写 CSS 变量，0 = 只留半透明底、不模糊。 */
    function setPinBlur(v) {
      if (!STORE.state.appearanceReady) return
      STORE.set({ pinBlur: clampBlur(v) })
      applyAppearance(STORE.state)
      scheduleSave({ pinBlur: STORE.state.pinBlur })
    }
    /**
     * 被钉气泡的最高高度（vh）：决定"钉住时能直接看到多少提问原文"，
     * 超出部分在气泡内滚（滚轮到边会转交给会话）。调高挡住的正文也更多，是纯手感取舍。
     */
    function setPinMaxVh(v) {
      if (!STORE.state.appearanceReady) return
      STORE.set({ pinMaxVh: clampPinMaxVh(v) })
      applyAppearance(STORE.state)
      scheduleSave({ pinMaxVh: STORE.state.pinMaxVh })
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
    //
    // **v1.5.0：单位从 px 改成百分比**（用户 2026-09-12 原话："改成百分比，具体的数值不仅会
    // 随着全屏或是缩小有变动，还会因为显示器的比例出现不协调"）。三个变量都写同一个 P%。
    // 真浏览器实测（本机会话区 clientWidth 1139）：
    //   80% ⇒ 消息列 860px、输入卡 886px ；60% ⇒ 645 / 664 ；100% ⇒ 1075（满宽）/ 1107。
    // 结论：三个变量都是"**可用内容区的 P%**"（100% 时 1075 = 1139 − 两侧 32px 内边距），
    // 而卡片恰好 = P% ×(内容区 + 32) ⇒ **卡片永远比列宽宽 32×P 像素**——
    // 与 px 时代"+32px 出挑"的关系完全一致，只是整体按比例缩放，全屏/缩窗都跟着走。
    function pinChatWidth(enabled, rawPct) {
      var pct = enabled && Number(rawPct) > 0 ? Math.round(Number(rawPct)) : null
      var root = findChatRoot()
      syncWidthStyle(pct)   // :root 兜底与根节点钉法并行：composer 还没挂上时也能生效
      if (!root) return false
      if (pct) {
        root.style.setProperty('--dsh-chat-content-width', pct + '%', 'important')
        root.style.setProperty('--dsh-composer-card-max-width', pct + '%', 'important')
        root.style.setProperty('--dsh-chat-user-width', pct + '%', 'important')
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
    // 2026-09-15：三个变量**全写**（原来只有 --dsh-chat-user-width）。这样即便宿主某个版本
    // 的根声明不引用 user-width，换会话重建根的那几帧也不会掉回自适应 —— 与 30ms 去抖双保险。
    var widthStyleEl = null
    function syncWidthStyle(pct) {
      if (!domReady()) return
      var css = pct > 0
        ? ':root{--dsh-chat-user-width:' + pct + '% !important;'
          + '--dsh-chat-content-width:' + pct + '% !important;'
          + '--dsh-composer-card-max-width:' + pct + '% !important}'
        : ''
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
    //
    // **不再用定时器去抖**（2026-09-15 用户报"切会话时宽度先从默认跳到固定值、每次都出现、
    // <0.3 秒、切标签不出现"）。300ms 那版一眼可见；降到 30ms 后用户仍说"微微能看出来"——
    // 因为只要经过一次绘制，肉眼看的就是"默认宽度的一帧"。
    // 现在改成**按需同步**：观察器回调里先做一个 O(1) 判断 —— 缓存的会话根还连着吗？
    //   连着（绝大多数变动：流式输出、消息追加）⇒ 什么都不做，连 querySelector 都不跑；
    //   断了（换会话/导航重建根）⇒ 立刻重钉。回调是微任务，**早于本次绘制**，
    //   所以新根第一次上屏时就已经带着钉好的宽度 —— 没有"默认宽度的那一帧"。
    var widthObserver = null
    var widthRoot = null
    function startWidthWatch() {
      if (!domReady() || widthObserver) return
      widthObserver = new MutationObserver(function () {
        // 旧根还在（含"从未找到过"）⇒ 无事发生，直接返回（热路径上只有一次属性读取）
        if (widthRoot !== null && widthRoot.isConnected) return
        var next = findChatRoot()
        if (next === null) return
        widthRoot = next
        applyChatWidth()   // 同步重钉：赶在绘制之前
      })
      widthObserver.observe(document.body, { childList: true, subtree: true })
      widthRoot = findChatRoot()
      applyChatWidth()
    }
    function stopWidthWatch() {
      if (widthObserver) { widthObserver.disconnect(); widthObserver = null }
      widthRoot = null
      pinChatWidth(false, 0)   // 撤销痕迹：把三个变量从会话根上摘掉
    }

    // ---------------------------------------------- 隐藏原生拖拽条（两个开关）--
    // DSH 的框架里有两类 `cursor:*-resize` 的把手，v1.7.0 起**各归一个开关**：
    //   ① 会话区两竖杠（宽度把手，实测 ._8JRpoa_widthHandle，左右各一条，hover 才亮发光条）
    //      —— 本插件把会话列宽钉成固定百分比之后（对话页卡），拖它不再改变列宽，
    //      只剩"鼠标扫过去冒出两竖杠、拖了却什么都不动"的体验（用户 2026-09-14 反馈）。
    //      键名沿用 v1.6.0 的 hideResizer（盘上已有 true 的存量，语义收窄为只管这两条）。
    //   ② 侧栏/详情栏分隔条（实测 ._1tdjgG_handle，8px 宽，挂在 AppFrame 的 grid 列缝上）
    //      —— 拖它**仍然有效**（改侧栏宽度），所以另起 hideDivider 键、默认关；
    //      想一并藏干净的用户自己拨开。
    //
    // **按语义找而不是按类名找**：类名是 CSS-module 哈希，DSH 一升级就变；`cursor` 含
    // `resize` 才是"这是条把手"的功能特征。两类再用 `data-width-handle` 属性区分 ——
    // 它是宿主 React 代码直接写的数据属性（不是哈希），比类名耐升级。
    // 排除自己的面板（.cc-panel 里的 textarea 用的是 `resize:vertical` **属性**，不是 cursor，
    // 天然不会命中，但留一道 closest 保险）。
    var resizerObserver = null
    var resizerTimer = 0
    // 'col-resize' / 'ew-resize' / 'nwse-resize' … 都是把手；宿主将来换写法（比如 'grab'）也只影响
    // 这一条正则，不影响其它逻辑。
    var RESIZER_CURSOR_RE = /resize$/
    /** 宽度把手（两竖杠）自己的稳定数据属性；分隔条没有这个。 */
    var WIDTH_HANDLE_ATTR = 'data-width-handle'
    function isWidthHandle(el) {
      try { return !!(el.getAttribute && el.getAttribute(WIDTH_HANDLE_ATTR) !== null) } catch (e) { return false }
    }
    /** 两个开关各自的生效条件（能力位缺失 = 旧 host 不认识这个键 ⇒ 这个开关不生效）。 */
    function widthWanted() {
      return STORE.state.hideResizer === true && STORE.state.resizerReady === true
    }
    function dividerWanted() {
      return STORE.state.hideDivider === true && STORE.state.dividerReady === true
    }
    function markResizers() {
      if (!domReady()) return 0
      var n = 0
      var wantW = widthWanted()
      var wantD = dividerWanted()
      try {
        var all = document.querySelectorAll('*')
        for (var i = 0; i < all.length; i++) {
          var el = all[i]
          if (!el || el.offsetParent === null) continue
          var cur = ''
          try { cur = (window.getComputedStyle(el).cursor || '') } catch (e) { continue }
          if (!RESIZER_CURSOR_RE.test(cur)) continue
          if (el.closest && el.closest('.cc-panel')) continue
          var attr = isWidthHandle(el) ? (wantW ? 'data-cc-hide-resizer' : null)
            : (wantD ? 'data-cc-hide-divider' : null)
          if (attr) {
            if (el.getAttribute(attr) !== '1') el.setAttribute(attr, '1')
            // 宿主若把某元素从一类挪到另一类（升级后 data-width-handle 增减），别留旧标记。
            el.removeAttribute(attr === 'data-cc-hide-resizer' ? 'data-cc-hide-divider' : 'data-cc-hide-resizer')
            n++
          } else {
            // 该元素所属开关此刻是关的：顺手清掉可能残留的标记，
            // 保证"关掉一个开关"不会把另一类元素也留着藏。
            el.removeAttribute('data-cc-hide-resizer')
            el.removeAttribute('data-cc-hide-divider')
          }
        }
      } catch (e) { warnOnce('markResizers', e) }
      return n
    }
    function clearResizers() {
      if (!domReady()) return 0
      var n = 0
      try {
        var marked = document.querySelectorAll('[data-cc-hide-resizer],[data-cc-hide-divider]')
        for (var i = 0; i < marked.length; i++) {
          marked[i].removeAttribute('data-cc-hide-resizer')
          marked[i].removeAttribute('data-cc-hide-divider')
          n++
        }
      } catch (e) { warnOnce('clearResizers', e) }
      return n
    }
    /** 挂/拆：任一开关开着就盯 body（宿主重建框架会换掉把手，重建后要重新标记）。 */
    function applyResizerHiding() {
      if (!domReady()) return false
      if (widthWanted() || dividerWanted()) { startResizerWatch(); return true }
      stopResizerWatch()
      return false
    }
    function startResizerWatch() {
      if (!domReady()) return
      markResizers()
      if (resizerObserver) return
      resizerObserver = new MutationObserver(function () {
        if (resizerTimer) return
        resizerTimer = setTimeout(function () { resizerTimer = 0; markResizers() }, 300)
      })
      resizerObserver.observe(document.body, { childList: true, subtree: true })
    }
    function stopResizerWatch() {
      if (resizerObserver) { resizerObserver.disconnect(); resizerObserver = null }
      if (resizerTimer) { clearTimeout(resizerTimer); resizerTimer = 0 }
      clearResizers()
    }
    /** 开关①：隐藏 / 恢复会话区两竖杠（宽度把手）。 */
    function setHideResizer(v) {
      if (!STORE.state.resizerReady) return
      STORE.set({ hideResizer: !!v })
      applyResizerHiding()
      scheduleSave({ hideResizer: STORE.state.hideResizer })
    }
    /** 开关②：隐藏 / 恢复侧栏与详情栏的分隔条（拖它仍能改侧栏宽，默认保留）。 */
    function setHideDivider(v) {
      if (!STORE.state.dividerReady) return
      STORE.set({ hideDivider: !!v })
      applyResizerHiding()
      scheduleSave({ hideDivider: STORE.state.hideDivider })
    }

    /** 开关：启用 / 停用固定宽度（走 applyAppearance，顺带挂/拆 DOM 观察器）。 */
    function setChatWidthEnabled(v) {
      if (!STORE.state.appearanceReady) return
      STORE.set({ chatWidthEnabled: !!v })
      applyAppearance(STORE.state)
      scheduleSave({ chatWidthEnabled: STORE.state.chatWidthEnabled })
    }
    /** 滑杆提交值（拖动途中由 WidthField 直接走 pinChatWidth 预览，不经过这里）。 */
    function commitChatWidth(v) {
      if (!STORE.state.appearanceReady) return
      v = clampChatWidth(v)
      STORE.set({ chatWidth: v })
      pinChatWidth(STORE.state.chatWidthEnabled, v)
      scheduleSave({ chatWidth: STORE.state.chatWidth })
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

    /**
     * 开/关行（v1.9.3）：右侧放宿主官方 Switch；primitives 不可用时退回原生 checkbox，
     * 布局两种情况一致。aria-label/title 由 primitives Switch 自己带上。
     */
    function Switch(label, checked, onChange, disabled) {
      disabled = disabled || STORE.state.policyWriting
      if (P && typeof P.Switch === 'function') {
        return h('div', { className: 'cc-swRow', style: { opacity: disabled ? 0.6 : 1 } },
          h('span', { className: 'cc-swLabel' }, label),
          h(P.Switch, {
            checked: !!checked, disabled: !!disabled, label: label, title: label,
            // disabled 时宿主 Switch 自己不拦点击（真包里它带 disabled 属性，浏览器会拦；
            // 这里再兜一层，保证任何实现下禁用态都是 no-op）。
            onChange: function (v) { if (!disabled) onChange(v) },
          }))
      }
      return h('label', { className: 'cc-row', style: { cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 } },
        h('input', {
          type: 'checkbox', checked: !!checked, disabled: !!disabled,
          onChange: function (e) { onChange(e.target.checked) },
        }),
        h('span', null, label))
    }

    /** 按钮（v1.9.3）：优先宿主 Button（ghost/sm），退回 cc-btn。props 直接透传。 */
    function Btn(props) {
      var children = props.children
      var rest = {}
      for (var k in props) { if (k !== 'children') rest[k] = props[k] }
      if (P && typeof P.Button === 'function') {
        return h(P.Button, Object.assign({ variant: 'ghost', size: 'sm' }, rest), children)
      }
      return h('button', Object.assign({ type: 'button', className: 'cc-btn' }, rest), children)
    }

    /** 门禁总开关：与 ponytail、输出形状互不影响。 */
    function setGateEnabled(v) {
      STORE.set({ gateEnabled: v, gateError: '' })
      scheduleSave({ gateEnabled: STORE.state.gateEnabled })
    }
    /** ponytail 编码纪律总开关（v1.10.0）：独立于门禁与压缩。 */
    function setPonytailEnabled(v) {
      STORE.set({ ponytailEnabled: v, ponytailError: '' })
      scheduleSave({ ponytailEnabled: STORE.state.ponytailEnabled })
    }
    /** 输出形状总开关（v1.12.0）：独立于门禁、ponytail 与压缩。默认开。 */
    function setShapeEnabled(v) {
      STORE.set({ shapeEnabled: v, shapeError: '' })
      scheduleSave({ shapeEnabled: STORE.state.shapeEnabled })
    }
    /**
     * chip 两段的点击处理（提到模块作用域，便于离线断言"点哪段切哪个"）。
     * 读 STORE.state 而非闭包快照，避免连点用旧值。
     */
    function flipGate() {
      if (STORE.state.loading || !STORE.state.loaded || !STORE.state.gateReady) return
      setGateEnabled(!STORE.state.gateEnabled)
    }
    function flipPonytail() {
      if (STORE.state.loading || !STORE.state.loaded || !STORE.state.ponytailReady) return
      setPonytailEnabled(!STORE.state.ponytailEnabled)
    }
    function flipShape() {
      if (STORE.state.loading || !STORE.state.loaded || !STORE.state.shapeReady) return
      setShapeEnabled(!STORE.state.shapeEnabled)
    }
    /** chip 徽标要看**实际是否注入**：逃生开关压过设置时，开关是开的但一个 token 都没进提示词。 */
    function shapeInjected(state) {
      var s = state || STORE.state
      return s.shapeEnabled === true && s.shapeDisabledByEnv !== true
    }

    /** 写 ponytail 规则文本；text 为 '' 表示删除 override、回到插件内置。 */
    function savePonytailText(text) { return writeRule('ponytail', text) }

    function reloadPonytail() { return readRule('ponytail') }

    /** 写输出形状规则文本；text 为 '' 表示删除 override、回到插件内置（与 ponytail 逐字同构）。 */
    function saveShapeText(text) { return writeRule('shape', text) }

    function reloadShape() { return readRule('shape') }

    /** 规则卡共用的元信息行（门禁 / ponytail 同构，只差键前缀）。 */
    function RuleSummary(s, pre) {
      var tags = []
      tags.push(h('span', { className: 'cc-tag', key: 'src' }, s[pre + 'Source'] === 'override' ? '自定义规则' : '内置规则'))
      tags.push(h('span', { className: 'cc-tag', key: 'size' }, kb(s[pre + 'Bytes']) + ' · ' + s[pre + 'Lines'] + ' 行'))
      // 截断标记直接来自 host 的显式字段（不是"体积到了上限"推出来的），并把两头的
      // 字节数一起摆出来 —— 用户要能看出"被砍了多少"，而不是只知道"被砍了"。
      if (s[pre + 'Truncated']) {
        tags.push(h('span', { className: 'cc-tag warn', key: 'tr' },
          '已截断：原 ' + s[pre + 'OriginalBytes'] + ' B → 保留 ' + s[pre + 'KeptBytes'] + ' B'))
      }
      return h('div', { className: 'cc-gateMeta' }, tags)
    }

    function GateSummary(s) {
      return RuleSummary(s, 'gate')
    }

    /**
     * 编辑框下面那行提示：三段规则卡逐字相同，唯一变量是上限字节数。
     * 这里是**输入侧**的比长度（草稿自己 vs 上限），与"靠结果长度反推截断"是两回事：
     * 提前告诉用户"存下去会被砍"，而不是存完再猜砍没砍。
     */
    function ruleTextHint(draftBytes, maxBytes) {
      return '点击“保存并生效”后写入自定义副本；草稿 ' + draftBytes + ' B / 上限 ' + kb(maxBytes) +
        (draftBytes > maxBytes ? '（超出 ' + (draftBytes - maxBytes) + ' B，保存后会被截断）' : '') +
        '。成对花括号会被替换为全角字形，以免破坏提示词变量插值。'
    }

    /**
     * 三段常驻规则（会话守则 / ponytail / 输出形状）共用的卡：开关 → 摘要 → 警示行 →
     * 编辑按钮 → textarea → 说明抽屉。合并前三张卡是逐字复制的同一套骨架（各 ~45 行），
     * 唯一差异收敛进入参：文案、字段前缀、就绪兜底、以及各自特有的警示行与说明内容
     * （summary / notReadyText / closing 都是函数，因为要拿 host 回来的当前值）。
     */
    function RuleCard(f) {
      var s = useCache()
      var pre = f.key
      var editing = s[pre + 'Draft'] !== null
      var text = s[pre + 'Text']
      var draft = editing ? s[pre + 'Draft'] : text
      var maxBytes = s[pre + 'MaxBytes']
      var draftBytes = new Blob([draft || '']).size
      var saving = s[pre + 'Saving'] || s.loading || s.policyWriting
      var setDraft = f.setDraft
      return h('div', { className: 'cc-card' },
        Switch(f.title, s[pre + 'Enabled'], f.setEnabled, !s[pre + 'Ready']),
        s[pre + 'Ready'] ? RuleSummary(s, pre)
          : h('div', { className: 'cc-err' }, f.notReadyText(s, pre)),
        (f.warnings || []).map(function (w) {
          return s[pre + w.field] ? h('p', { className: 'cc-warn', key: w.field }, w.text(s, pre)) : null
        }),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          h(Btn, {
            disabled: !s[pre + 'Ready'] || saving,
            onClick: function () { STORE.set(setDraft(editing ? null : text)) },
          }, editing ? '取消编辑' : '编辑规则'),
          editing ? h(Btn, {
            disabled: saving,
            onClick: function () { f.save(s[pre + 'Draft']) },
          }, saving ? '保存中…' : '保存并生效') : null,
          editing && s[pre + 'Source'] === 'override' ? h(Btn, {
            disabled: saving,
            onClick: function () { f.save('') },
          }, '清除自定义，回到内置') : null,
          h(Btn, { disabled: saving || (editing && draft !== text), title: editing && draft !== text ? '请先保存或取消草稿' : '', onClick: f.reload }, '重新读取')),
        editing ? h('div', null,
          h('textarea', {
            className: 'cc-textarea', value: draft, spellCheck: false, disabled: saving, 'aria-label': f.title + '正文',
            onChange: function (e) { STORE.set(setDraft(e.target.value)) },
          }),
          h('div', { className: 'cc-muted', style: { marginTop: '6px' } }, ruleTextHint(draftBytes, maxBytes))) : null,
        editing && draft !== text ? h('span', { className: 'cc-muted' }, saving ? '正在保存草稿…' : '草稿未保存 · 切换分区会保留') : null,
        s[pre + 'Error'] ? h('p', { className: 'cc-err', role: 'alert' }, s[pre + 'Error']) : null,
        !editing ? h(Fold, { label: '查看规则' }, h('pre', { className: 'cc-rule-preview' }, text || '规则尚未读取')) : null,
        h(Fold, { label: '历史与恢复', open: s[pre + 'HistoryOpen'] === true, onToggle: function(value){var patch={};patch[pre+'HistoryOpen']=value;STORE.set(patch)} }, h(RuleHistory, { ruleKey: pre })),
        h(Fold, { label: '规则说明' },
          h('div', { className: 'cc-note' }, f.summary(s, pre)),
          h('div', { className: 'cc-path' }, '内置规则：' + (s[pre + 'BuiltinPath'] || '（未就绪）')),
          h('div', { className: 'cc-path' }, '自定义副本：' + (s[pre + 'OverridePath'] || '（未就绪）') +
            (s[pre + 'Source'] === 'override' ? '（当前生效）' : '（尚未创建）')),
          f.closing ? f.closing(s, pre) : null))
    }

    /** 说明抽屉: 默认收起 (测试可经 internals.setFoldsOpen 让其默认展开)。 */
    function Fold(props) {
      var pair = React.useState(FOLD_DEFAULT_OPEN === true)
      var open = typeof props.open === 'boolean' ? props.open : pair[0]
      var setOpen = pair[1]
      return h('div', { className: 'cc-fold' },
        h('button', {
          type: 'button', className: 'cc-foldBtn',
          'aria-expanded': open ? 'true' : 'false',
          onClick: function () { setOpen(!open); if(props.onToggle)props.onToggle(!open) },
        }, (open ? '▾ ' : '▸ ') + (props.label || '说明')),
        open ? h('div', { className: 'cc-foldBody' }, props.children) : null)
    }

    // ------------------------------------------------- 设置页：省 token 卡 --
    /**
     * v1.13.0：并入 dsh-plugin-save-token v2.4.1 的面板（上游客户端 347 行双语 React）。
     * 相对上游砍掉三样，理由与 host 侧同步：
     *   ① compaction assist 开关 + compaction 卡整块不要 —— host 那条分支已删（压缩契约
     *      只归「省缓存」），面板上留个拨了没反应的开关比没有更糟；
     *   ② 不装上游的 composer.dock 常驻小条 —— 那个槽位是 dsh-bill 的地盘（同一位置它
     *      已经在画每会话费用行），两个 2.5s 轮询器抢一个槽就是重复；
     *   ③ 双语 STR 表退成中文 —— 本页其余九块都是中文，唯独它跟 locale 走反而突兀。
     * 口径与 host 对齐：数字全来自 /cc/st/api/dashboard，只回计数与字节数，不含 prompt 文本。
     */
    var ST_KIND = {
      compress: ['压缩', 'var(--dsw-alias-brand-primary,#4d6bfe)'],
      lossless: ['无损', 'var(--dsw-alias-label-success,#2da44e)'],
      dedupe: ['去重', 'var(--dsw-alias-label-warning,#b8860b)'],
      request: ['请求', 'var(--dsw-alias-label-secondary)'],
      aux: ['辅助', 'var(--dsw-alias-label-secondary)'],
      skip: ['跳过', 'var(--dsw-alias-label-danger,#e5534b)'],
      config: ['配置', 'var(--dsw-alias-label-secondary)'],
    }

    function stTime(ts) {
      try { return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }) } catch (e) { return '' }
    }

    function stKpi(label, value, sub, green) {
      return h('div', { className: 'cc-kpi' },
        h('div', { className: 'cc-muted' }, label),
        h('div', { className: 'cc-kpiV', style: green ? { color: 'var(--dsw-alias-label-success,#2da44e)' } : null }, value),
        sub ? h('div', { className: 'cc-kpiS' }, sub) : null)
    }

    function stStat(label, main, sub) {
      return h('div', { className: 'cc-row' },
        h('span', { style: { minWidth: '86px' } }, label),
        h('span', { style: { flex: '1', minWidth: 0 } }, main),
        h('span', { className: 'cc-val' }, sub || ''))
    }

    /** 单次请求上下文重量：灰 = 实际送出的提示词，绿 = 这次省下的。 */
    function stSpark(series) {
      var i, max = 1, H = 48, W = Math.max(1, series.length) * 7
      for (i = 0; i < series.length; i++) max = Math.max(max, (series[i].p || 0) + (series[i].a || 0))
      var bars = []
      for (i = 0; i < series.length; i++) {
        var p = series[i].p || 0, a = series[i].a || 0
        var ph = p > 0 ? Math.max(2, Math.round(p / max * 40)) : 0
        var ah = Math.round(a / max * 40)
        if (ph > 0) bars.push(h('rect', { key: 'p' + i, x: i * 7, y: H - 4 - ph - ah, width: 5, height: ph, fill: 'var(--dsw-alias-border-l2,#c7cbd1)' }))
        if (ah > 0) bars.push(h('rect', { key: 'a' + i, x: i * 7, y: H - 4 - ah, width: 5, height: ah, fill: 'var(--dsw-alias-label-success,#2da44e)' }))
      }
      return h('svg', { width: '100%', height: H, viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' }, bars)
    }

    // One owner for reads, writes and disposal. Poll only after completion;
    // a mutation invalidates an older GET even if its transport ignores abort.
    function createTokenFeed(merge) {
      var alive = true, busy = false, revision = 0, timer, controller
      var page = typeof document !== 'undefined' ? document : null
      var paused = !!(page && page.hidden)
      function visibility() {
        paused = !!page.hidden
        if (paused) { if (!busy) cancelRead(); else clearTimeout(timer) }
        else load()
      }
      if (page && page.addEventListener) page.addEventListener('visibilitychange', visibility)
      function cancelRead() {
        revision++
        clearTimeout(timer)
        if (controller) controller.abort()
      }
      function schedule() {
        if (alive && !busy && !paused) timer = setTimeout(load, 2500)
      }
      async function request(action, body) {
        var c = new AbortController(), timedOut = false
        controller = c
        var deadline = setTimeout(function () { timedOut = true; c.abort() }, 10000)
        try {
          var response = await fetch('/cc/st/api/' + action, body === undefined
            ? { cache: 'no-store', signal: c.signal }
            : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: c.signal })
          if (!response.ok) throw new Error('HTTP ' + response.status)
          return await response.json()
        } catch (e) {
          if (timedOut) throw new Error('请求超时，请重试')
          throw e
        } finally {
          clearTimeout(deadline)
          if (controller === c) controller = null
        }
      }
      async function readData(ticket) {
        var data = await request('dashboard')
        if (!data || !data.flags || typeof data.flags !== 'object') throw new Error('返回值缺少 flags')
        if (alive && ticket === revision) merge({ data: data, error: '' })
      }
      async function load() {
        if (!alive || busy || paused) return
        cancelRead()
        var ticket = revision
        try { await readData(ticket) }
        catch (e) { if (alive && ticket === revision) merge({ error: String(e.message || e) }) }
        finally { if (alive && ticket === revision) schedule() }
      }
      async function post(action, body) {
        if (!alive || busy) return
        busy = true
        cancelRead()
        var ticket = revision
        merge({ busy: action, error: '' })
        try {
          var result = await request(action, body)
          if (!result || result.ok !== true) throw new Error('接口拒绝了这次改动')
          if (alive && ticket === revision && !paused) await readData(ticket)
        } catch (e) {
          if (alive && ticket === revision) merge({ error: String(e.message || e) })
        } finally {
          if (alive && ticket === revision) { busy = false; merge({ busy: '' }); schedule() }
        }
      }
      return { load: load, post: post, dispose: function () { alive = false; cancelRead(); if(page && page.removeEventListener)page.removeEventListener('visibilitychange', visibility) } }
    }

    function SaveTokenCard() {
      var pair = React.useState({ data: null, error: '', busy: '' })
      var st = pair[0], set = pair[1], feed = React.useRef(null)
      React.useEffect(function () {
        var current = createTokenFeed(function (patch) {
          set(function (prev) { return Object.assign({}, prev, patch) })
        })
        feed.current = current
        current.load()
        return function () { current.dispose(); feed.current = null }
      }, [])
      function post(action, body) { if (feed.current) return feed.current.post(action, body) }

      var d = st.data
      if (!d) {
        return h('div', { className: 'cc-card' },
          h('div', { className: 'cc-sub', role: st.error ? 'alert' : 'status' }, st.error ? '读取失败：' + st.error : '正在读取 token 统计…'),
          st.error ? h(Btn, { onClick: function () { if (feed.current) feed.current.load() } }, '重新读取') : null)
      }
      // Lowercase render helper distinguishes its positional arguments from
      // a React component's props. Lifecycle tests also exercise this call.
      return renderSaveTokenView(d, {
        busy: st.busy,
        error: st.error,
        onToggle: function (key, value) { post('set-enabled', { key: key, value: value }) },
        onReset: function () { post('reset', {}) },
      })
    }

    /**
     * 纯视图负责展示；createTokenFeed 负责请求生命周期，SaveTokenCard 连接两者。
     * 静态渲染测试覆盖格式，verify-token-lifecycle 覆盖真实 React 挂载、取数及点击。
     */
    function renderSaveTokenView(d, opts) {
      opts = opts || {}
      var busy = opts.busy || '', error = opts.error || ''
      var t = d.totals || {}, c = d.compression || {}
      var ratio = c.bytesBefore > 0 ? Math.round((1 - c.bytesAfter / c.bytesBefore) * 100) : 0
      var maxSaved = 1
      ;(d.byTool || []).forEach(function (x) { maxSaved = Math.max(maxSaved, x.savedBytes || 0) })
      var uptime = Math.round(d.uptimeSec || 0)
      function toggle(key, label) {
        var on = !!d.flags[key]
        return h(Btn, {
          key: key,
          disabled: busy !== '',
          'aria-pressed': on,
          title: on ? '已启用，点击关闭' : '已停用，点击启用',
          onClick: function () { opts.onToggle(key, !on) },
        }, label + '：' + (on ? '开' : '关'))
      }

      return h('div', { className: 'cc-card' },
        h('div', { className: 'cc-row', style: { flexWrap: 'wrap' } },
          h('span', { style: { fontWeight: 600 } }, '结构感知 · 无损优先'),
          h('span', { className: 'cc-muted' }, '已运行 ' + (uptime >= 60 ? Math.round(uptime / 60) + ' 分钟' : uptime + ' 秒')),
          h('span', { className: 'cc-tag' }, d.flags.expandTool ? 'save_token_expand 可取回' : 'expand 不可用'),
          h('span', { style: { flex: '1' } }),
          toggle('compress', '压缩'),
          toggle('dedupe', '去重'),
          h(Btn, { key: 'reset', disabled: busy !== '', onClick: function () { opts.onReset() } }, '重置计数')),
        h('p', { className: 'cc-muted' }, '统计与压缩、去重开关仅在本次运行有效，重启后计数归零、开关恢复默认开启。重置计数不影响原文取回。'),
        busy ? h('p', { className: 'cc-muted', role: 'status' }, '正在保存并确认…') : null,
        d.spillReady === false
          ? h('p', { className: 'cc-err' }, '可逆存储（spillStore）当前不可用 → 压缩保持关闭，工具输出原样进上下文。'
            + (d.lastSkip ? '原因：' + d.lastSkip : ''))
          : null,
        h('div', { className: 'cc-kpis' },
          stKpi('模型请求', fmt(t.requests || 0), '+' + fmt(t.auxRequests || 0) + ' 次辅助（标题 / 摘要）'),
          stKpi('输入 token（实际计费）', fmt((t.inputTokens || 0) + (t.cachedTokens || 0)),
            '缓存命中 ' + (d.cacheHitPct || 0) + '% · 其中 ' + fmt(t.cachedTokens || 0) + ' 走缓存'),
          stKpi('输出 token（实际计费）', fmt(t.outputTokens || 0), fmt(t.reasoningTokens || 0) + ' 为推理'),
          stKpi('省下的 token（估算）', fmt(t.avoidedTokens || 0), '单次调用上下文平均轻 ' + (d.reliefPct || 0) + '%', true)),
        h('div', null,
          h('div', { className: 'cc-muted' }, '单次请求的上下文重量：灰 = 实际送出，绿 = 已省下（最近 60 次）'),
          stSpark(d.series || []),
          h('div', { className: 'cc-muted', style: { marginTop: '6px' } },
            '平均提示 ~' + fmt(t.requests ? Math.round((t.estPromptTokens || 0) / t.requests) : 0) + ' tok'
            + ' · 平均省下 ~' + fmt(t.requests ? Math.round((t.avoidedTokens || 0) / t.requests) : 0) + ' tok/次')),
        h('div', null,
          stStat('压缩', c.count ? c.count + ' 次重塑，平均 -' + ratio + '% 字节（'
            + fmtBytes(c.bytesBefore) + ' → ' + fmtBytes(c.bytesAfter) + '）' : '还没触发过（输出需大于阈值）',
            c.count ? '顶层 ' + (c.topLevelCalls || 0) + ' · 嵌套 ' + (c.nestedCalls || 0) : ''),
          stStat('无损', (c.losslessEncodes || 0) + ' 次重编码（结构化数组，零损失）',
            (c.tabularWindows || 0) + ' 个抽采样窗口'),
          stStat('去重', (c.dedupeHits || 0) + ' 次命中重复调用（同一份内容重放）',
            '省 ' + fmtBytes(c.dedupeSavedBytes || 0)),
          d.estRatio ? stStat('估算比', '字节→token ×' + d.estRatio, (c.replays || 0) + ' 次回放对照实际计费') : null),
        h('div', null,
          h('div', { className: 'cc-muted' }, '省字节最多的工具'),
          (d.byTool || []).length === 0
            ? h('div', { className: 'cc-sub' }, '还没有压缩记录')
            : (d.byTool || []).map(function (tool) {
              return h('div', { className: 'cc-row', key: tool.name },
                h('span', { style: { minWidth: '132px', maxWidth: '132px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: tool.name }, tool.name),
                h('div', { className: 'cc-barTrack' },
                  h('div', { className: 'cc-barFill', style: { width: Math.max(4, Math.round((tool.savedBytes || 0) * 100 / maxSaved)) + '%' } })),
                h('span', { className: 'cc-val' }, fmtBytes(tool.savedBytes || 0) + ' / ' + tool.count + ' 次'))
            })),
        h('div', null,
          h('div', { className: 'cc-muted' }, '近期活动（最多 18 条）'),
          h('div', { style: { maxHeight: '190px', overflowY: 'auto' } },
            (d.recent || []).length === 0
              ? h('div', { className: 'cc-sub' }, '还没有活动记录')
              : (d.recent || []).map(function (r, i) {
                var kind = ST_KIND[r.kind] || ST_KIND.request
                return h('div', { className: 'cc-row', key: String(r.ts) + '-' + i },
                  h('span', { className: 'cc-muted' }, stTime(r.ts)),
                  h('span', { className: 'cc-tag', style: { color: kind[1], borderColor: kind[1] } }, kind[0]),
                  h('span', { style: { flex: '1', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: r.label + (r.detail ? ' · ' + r.detail : '') },
                    r.label + (r.detail ? ' · ' + r.detail : '')),
                  h('span', { className: 'cc-val' }, r.saved > 0 ? '-' + fmt(r.saved) : ''))
              }))),
        error ? h('p', { className: 'cc-err', role: 'alert' }, '接口出错：' + error) : null,
        h(Fold, { label: '说明' },
          h('div', { className: 'cc-note' }, '无损优先：均匀数组确定性重编码（TOON 式），零信息损失；常规输出走结构感知窗口，中段按行号抽采样。每次替换前先落盘保存完整原文，再提供 save_token_expand 工具或原文路径供取回；保存失败就不替换。压缩只在 tools/post-execute 发生一次，重放不改写历史。上游的 compaction assist 分支在嵌入时就整段删除（压缩契约原属本插件的「省缓存」一块，v1.14.0 起该块也随 DSH 0.1.7 一并移除）。'),
          h('div', { className: 'cc-path' }, '统计口径：只保留计数与字节数，不含任何 prompt 文本；计数与开关都在内存里，重启归零回到默认开（本页其余开关写 settings.json）。'),
          h('div', { className: 'cc-path' }, '压缩、去重、expand 三者共用同一份 spillStore 落盘；spillStore 不可用时压缩自动关闭，tool 输出原样进上下文。超过内存上限或重启后，取回可能需要根据提示中的原文路径调用 read 工具。')))
    }

    // ---------------------------------------------------- 设置页：门禁卡 --
    function GateCard() {
      return RuleCard({
        key: 'gate',
        title: '启用会话守则（全局默认）',
        setEnabled: setGateEnabled,
        setDraft: function (v) { return { gateDraft: v } },
        save: saveGateText,
        reload: reloadGate,
        notReadyText: function () {
          return '会话守则未装载：旧版 host 半仍在运行，请重启桌面应用后再操作（重启前请不要再动本面板的压缩开关，否则新字段会被旧版写盘逻辑抹掉）。'
        },
        warnings: [{
          field: 'Truncated',
          // 截断要说人话：原文多少、实际注入多少、超了多少 —— 只说"已截断"用户不知道自己丢了多少内容。
          // 字段名显式写出来（不走 pre 拼接）：verify-gate-truncation 第 ⑧ 组按源码口径盯的就是这两个名字。
          text: function (s) {
            return '你的规则被截断了：原文 ' + s.gateOriginalBytes + ' 字节，实际注入 ' + s.gateKeptBytes +
              ' 字节（上限 ' + s.gateMaxBytes + ' 字节，超出 ' + Math.max(0, s.gateOriginalBytes - s.gateKeptBytes) +
              ' 字节未进入提示词）。请精简规则或把大段内容拆到别处。'
          },
        }],
        summary: function () {
          return '规则七条 R1–R7（R4 是归属与裁决声明，不是行为规则）：R1 独立研判（允许并要求反对你，不默认你正确）；R2 不确定就提问（只问查不到、且会改变结果的那些）；R3 分工固定（你定目标/补真实情况/判定可用性，我搜索·执行·制作·验证·交付）；R4 形状真源在另一段、并声明三段之间的裁决顺序；R5 少犯错优先（先说假设、任务转成可验证目标；最小实现那几条的完整口径在 ponytail 段，不在此处重复）R6 查证再下结论（先验证再断言，没跑检查就明说）；R7 谨慎执行（不可逆动作先确认，授权按当次范围算）。'
        },
        closing: function () {
          return h('div', { className: 'cc-note' },
            '生效范围：注入 system prompt 的一个段（排在 persona 之后、工具说明之前）。它随 system prompt 每请求重发，' +
            '不进对话历史，因此不受上面压缩策略的影响；代价是每次请求（含子代理、工作流子会话）都多这几 KB token。' +
            '会话守则是"必须遵守的规则"，不是"模型无法违反"——它约束行为，不产生技术硬拦截。')
        },
      })
    }

    // ------------------------------------------------ 设置页：自动审查卡 --
    function ReviewCard() {
      var s = useCache()
      return h('div', { className: 'cc-card' },
        Switch('启用代码审查（需要时调用）', s.reviewEnabled, setReviewEnabled,
          !s.reviewReady || s.reviewSaving),
        !s.reviewReady
          ? h('div', { className: 'cc-err' }, '审查服务尚未就绪，请重新检测；更新插件后需重启桌面应用。')
          : h('div', { className: 'cc-muted' },
            s.reviewRegistered ? '已加入可用技能，调用时才加载审查正文。' : s.reviewEnabled ? '已开启，但技能尚未注册，请检查宿主服务或重启。' : '尚未启用，模型不会调用这项审查技能。'),
        h('div', { className: s.reviewOcrFound ? 'cc-ok' : 'cc-warn' },
          s.reviewOcrFound
            ? '审查工具已就绪'
            : '尚未安装审查工具，暂时无法执行。安装方式见下方“工具详情”。'),
        h('div', { style: { display: 'flex', gap: '8px' } },
          h(Btn, { disabled: s.reviewSaving, onClick: reloadReview }, '重新检测')),
        s.reviewError ? h('p', { className: 'cc-err' }, s.reviewError) : null,
        h(Fold, { label: '工具详情' },
          h('div', { className: 'cc-muted cc-review-details' },
            'auto-code-review · 正文 ' + kb(s.reviewSkillBytes) + ' · ' + (s.reviewSkillPath || '路径尚未读取')),
          h('div', { className: 'cc-muted cc-review-details' }, s.reviewOcrFound
            ? 'open-code-review ' + (s.reviewOcrVersion || '') + ' · ' + (s.reviewOcrCommand || '')
            : '安装命令：npm install -g @alibaba-group/open-code-review')),
        h(Fold, { label: '为什么不是常驻规则' },
          h('div', { className: 'cc-note' },
            '上游 alibaba/open-code-review（Apache-2.0）的 README 把"通用 agent + 自然语言 skill 做审查"' +
            '列为反面教材：大 changeset 选择性漏审、报出的位置与真实行号漂移、prompt 微调就质量大幅波动' +
            '——根因是纯语言驱动对审查过程没有硬约束。它的基准（AACR-bench：200 个真实 PR、1,505 条标注）' +
            '显示同模型下 F1 更高而 token 只用通用 agent 的约 1/9。所以这里一个字都不进 system prompt：' +
            '每次现向 ocr 取「该审哪些文件」（delegate preview）与「这些文件命中哪些规则」（delegate rule），' +
            '判断仍由当前模型做，不需要 API key。规则跟着上游升级，不在本仓库里腐烂。'),
          h('div', { className: 'cc-note' },
            '与 ponytail / 会话守则 R5 的分工：那两个管"少写、写最小实现"，这张卡管"写出来的东西对不对"。' +
            '重叠处（死代码、过度抽象）以 ponytail 的判断为准。'),
          h('div', { className: 'cc-path' }, '技能正文：' + (s.reviewSkillPath || '（未就绪）'))))
    }

    // ---------------------------------------------- 设置页：ponytail 编码纪律卡 --
    function PonytailCard() {
      return RuleCard({
        key: 'ponytail',
        title: '启用 ponytail 编码纪律（全局默认）',
        setEnabled: setPonytailEnabled,
        setDraft: function (v) { return { ponytailDraft: v } },
        save: savePonytailText,
        reload: reloadPonytail,
        notReadyText: function () {
          return '未装载：当前运行的 host 还没有 /cc/ponytail.json，请重启桌面应用后再操作。'
        },
        warnings: [{
          field: 'Truncated',
          text: function (s, pre) {
            return '你的规则被截断了：原文 ' + s[pre + 'OriginalBytes'] + ' 字节，实际注入 ' + s[pre + 'KeptBytes'] +
              ' 字节（上限 ' + s[pre + 'MaxBytes'] + ' 字节）。请精简规则。'
          },
        }],
        summary: function () {
          return 'ponytail（蒸馏自 GitHub DietrichGebert/ponytail，MIT）：最懒资深工程师的编码纪律——七级梯子' +
            '（YAGNI → 复用库内已有 → 标准库 → 平台原生 → 已装依赖 → 一行 → 最少代码）、修 bug 先 grep 全部调用方修根因、' +
            '禁没要求的抽象、故意简化留 ponytail: 注释标升级路径。只对编码任务生效，非编码请求不适用该节。' +
            '回复形状本身不在这里，在「输出形状」段（真源 shape-gate.md）。'
        },
        closing: function (s) {
          return h('div', { className: 'cc-note' },
            '代价与提醒：开着时这段规则随 system prompt **每请求重发**（含子代理），约 ' +
            Math.round((s.gateBytes + s.ponytailBytes) / 4 / 100) / 10 + 'K token/请求（按当前生效文本实测），' +
            '且读图、写文案之类的会话也会看到它（正文里已写明"非编码任务不适用"来兜底）。' +
            '平时不用可以关着，需要时来这里或点 chip 打开。')
        },
      })
    }

    // ------------------------------------------- 设置页：输出形状卡（v1.12.0）--
    function ShapeCard() {
      return RuleCard({
        key: 'shape',
        title: '启用输出形状（全局默认，初始开启）',
        setEnabled: setShapeEnabled,
        setDraft: function (v) { return { shapeDraft: v } },
        save: saveShapeText,
        reload: reloadShape,
        notReadyText: function () {
          return '未装载：当前运行的 host 还没有 /cc/shape.json，请重启桌面应用后再操作。'
        },
        warnings: [
          // 逃生开关压过设置：开关开着却一个字都没进提示词，必须说出来（否则用户会以为规则生效了）。
          {
            field: 'DisabledByEnv',
            text: function () {
              return '环境变量 DSH_OUTPUT_SHAPE_DISABLE=1 正在强制关闭本段：开关状态照旧记录，但规则不会注入提示词。' +
                '去掉这个变量并重启桌面应用才会恢复。'
            },
          },
          {
            field: 'Truncated',
            text: function (s, pre) {
              return '你的规则被截断了：原文 ' + s[pre + 'OriginalBytes'] + ' 字节，实际注入 ' + s[pre + 'KeptBytes'] +
                ' 字节（上限 ' + s[pre + 'MaxBytes'] + ' 字节）。请精简规则。'
            },
          },
        ],
        summary: function () {
          return '输出形状（蒸自 GitHub ayghri/i-have-adhd，MIT）：把回复整形成"读完就能动手"的形状——' +
            '首行给下一步、多步编号、状态复述、跑题后置、时间给量级、战果可见、报错讲因果、展示分组、无开场白无客套，' +
            '外加六条破例（要解释就讲透、破坏性操作先确认、连续三轮不对就换假设、真歧义先问一句、任务赢形状留、' +
            'system 指令优先）。'
        },
        closing: function (s, pre) {
          return [
            h('div', { className: 'cc-note', key: 'src' },
              '来源：本节原先由独立插件 dsh-output-shape 提供（段名 dsh-output-shape:output-shape）。' +
              '2026-09-21 并入本插件后那个插件已下线，段名改为 dsh-cache-control:shape-gate，order 仍是 410。' +
              '会话守则里的 R4 只留了一句归属声明，两者不会重复注入。'),
            h('div', { className: 'cc-note', key: 'cost' },
              '代价与提醒：开着时这段规则随 system prompt **每请求重发**（含子代理），约 ' +
              (Math.round(s[pre + 'Bytes'] / 4 / 100) / 10 || 1.2) + 'K token/请求' +
              '（' + s[pre + 'Bytes'] + ' B 中文按 4 B/token 估），' +
              '任何会话都会看到（读图、写文案也照带）。并入前它是默认开的，所以升级后不会变；不想付这份 token 就关掉它。' +
              '技能 i-have-adhd 与 ponytail 用的是同一份正文，关掉本节不影响按需调用技能。'),
          ]
        },
      })
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

    // ------------------------------------------------ 设置页：对话页卡 --
    // 常用宽度快捷键（bg-atelier 原样搬来）
    var WIDTH_PRESETS = [60, 70, 80, 90, 100]   // v1.5.0: 原 px 快捷键(1280/1600/1920/2560/3840) → 百分比

    /**
     * 宽度滑杆：拖动过程中只改本组件的局部状态 + 直接钉 CSS 变量做即时预览，
     * 松手 / 失焦 / 方向键才 STORE.set → scheduleSave。否则每拖一格都会把
     * 整页（含这条设置页）重渲染一遍，手感明显发涩。
     */
    function WidthField() {
      var s = useCache()
      var pair = React.useState(clampChatWidth(s.chatWidth))
      var val = pair[0]
      var setVal = pair[1]
      React.useEffect(function () {
        setVal(clampChatWidth(s.chatWidth))
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
            title: '占会话区可用宽度的 ' + w + '%',
            onClick: function () { setVal(w); pinChatWidth(true, w); commitChatWidth(w) },
          }, w + '%'))
        })(WIDTH_PRESETS[i])
      }
      return h('div', null,
        h('div', { className: 'cc-row', style: { marginTop: '10px' } },
          h('span', { style: { minWidth: '108px' } }, '对话页宽度'),
          h('input', {
            type: 'range', min: String(CHAT_PCT_MIN), max: String(CHAT_PCT_MAX), step: '1', value: String(val),
            onChange: function (e) { onInput(Number(e.target.value)) },
            onPointerUp: function () { commitChatWidth(val) },
            onKeyUp: function () { commitChatWidth(val) },
            onBlur: function () { commitChatWidth(val) },
          }),
          h('span', { className: 'cc-val' }, Math.round(val) + '%')),
        h('div', { className: 'cc-chips' }, chips))
    }

    /**
     * 「存储」卡（v1.8.0）：各用途分别占多少盘；清理**先给候选清单**再动手。
     * 清理走"移到回收目录"而不是删（不可逆操作先从可回溯开始），回收目录自己再单独清。
     */
    function fmtBytes(bytes) {
      var n = Number(bytes) || 0
      if (n < 1024) return n + ' B'
      var units = ['KB', 'MB', 'GB', 'TB']
      var i = -1
      do { n = n / 1024; i += 1 } while (n >= 1024 && i < units.length - 1)
      return (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10) + ' ' + units[i]
    }

    function StorageCard() {
      var pair = React.useState({ loading: true, error: '', data: null, busy: '', notice: '' })
      var st = pair[0], set = pair[1], lifecycle = React.useRef({ alive: false, ticket: 0, controller: null, busy: false })
      var confirmPair = React.useState(null), confirmation = confirmPair[0], confirm = confirmPair[1]
      function merge(patch) {
        if (lifecycle.current.alive) set(function (prev) { return Object.assign({}, prev, patch) })
      }
      // A new request invalidates its predecessor even when abort is ignored.
      async function request(url, body) {
        var owner = lifecycle.current, ticket = ++owner.ticket
        if (owner.controller) owner.controller.abort()
        var controller = new AbortController(), timedOut = false
        owner.controller = controller
        var timer = setTimeout(function () { timedOut = true; controller.abort() }, 15000)
        try {
          var options = { cache: 'no-store', signal: controller.signal }
          if (body !== undefined) Object.assign(options, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
          })
          var res = await fetch(url, options)
          if (!res.ok) throw new Error('HTTP ' + res.status)
          var data = await res.json()
          if (!data || data.ok !== true) throw new Error(data && data.error || '服务返回异常')
          return owner.alive && ticket === owner.ticket ? data : null
        } catch (e) {
          if (!owner.alive || ticket !== owner.ticket) return null
          throw new Error(timedOut ? '统计或操作超时，请重试' : String(e.message || e))
        } finally {
          clearTimeout(timer)
          if (owner.controller === controller) owner.controller = null
        }
      }
      async function load(force) {
        if (lifecycle.current.busy) return
        merge({ loading: true, error: '' })
        try {
          var data = await request('/cc/storage' + (force ? '?refresh=1' : ''))
          if (data) merge({ data: data, loading: false })
        } catch (e) { merge({ loading: false, error: e.message }) }
      }
      React.useEffect(function () {
        var owner = lifecycle.current
        owner.alive = true
        load(false)
        return function () {
          owner.alive = false
          owner.ticket++
          if (owner.controller) owner.controller.abort()
        }
      }, [])
      async function execute(action) {
        var owner = lifecycle.current
        if (owner.busy) return
        owner.busy = true
        confirm(null)
        merge({ busy: action.label, error: '', notice: '' })
        try {
          var result = await request(action.url, action.body)
          if (!result) return
          var notice = action.url.indexOf('/purge') >= 0
            ? '已清空回收目录，释放 ' + fmtBytes(result.freed)
            : '已移入回收 ' + (result.moved || []).length + ' 项。'
          if (result.skipped && result.skipped.length) {
            notice += ' ' + result.skipped.length + ' 项未移动：' + result.skipped.map(function (x) { return x.reason }).join('；')
          }
          merge({ notice: notice })
          owner.busy = false
          await load(true)
        } catch (e) { merge({ error: e.message }) }
        finally { owner.busy = false; merge({ busy: '' }) }
      }
      var data=st.data, categories=data&&data.categories||[], candidates=data&&data.candidates||[]
      var total=data&&data.total||{bytes:0,files:0}, recycle=data&&data.recycle||{bytes:0,files:0}
      var reclaim=candidates.reduce(function(n,c){return n+c.bytes},0)
      var disabled=st.loading||!!st.busy
      return h('div',{className:'cc-card'},
        h('div',{className:'cc-row'},h('span',{style:{flex:1}},st.loading?'正在统计目录占用…':data?'已统计 '+fmtBytes(total.bytes)+' · '+total.files+' 个文件':'读取失败，可重试'),
          h(Btn,{disabled:disabled,onClick:function(){load(true)}},st.loading?'读取中…':'刷新统计')),
        st.error?h('div',{className:'cc-err',role:'alert'},st.error):null,
        st.notice?h('div',{className:'cc-note',role:'status'},st.notice):null,
        st.busy?h('p',{className:'cc-muted',role:'status'},'正在'+st.busy+'…'):null,
        data&&data.truncated?h('p',{className:'cc-warn'},'部分目录达到统计上限，当前显示的是已统计用量。'):null,
        h('div',null,categories.slice().sort(function(a,b){return b.bytes-a.bytes}).map(function(c){return h('div',{className:'cc-storage-row',key:c.id},
          h('span',null,c.label),h('span',{className:'cc-val'},c.exists?fmtBytes(c.bytes):'—'),
          h('div',{className:'cc-storage-meter'},h('span',{style:{width:(total.bytes?Math.max(0.5,c.bytes/total.bytes*100):0)+'%'}})),
          h('small',null,(c.exists?c.files+' 个文件':'暂无文件')+' · '+String(c.note||'').replace(/\*\*/g,'')))})),
        data?h(Fold,{label:'清理预览 · '+candidates.length+' 项缓存 · '+fmtBytes(reclaim)},
          h('p',{className:'cc-note'},'移入回收后仍占磁盘空间，可手动取回；清空回收目录才会释放空间。提示词产物、会话历史和附件不会在这里清理。'),
          candidates.length?candidates.map(function(c){return h('div',{className:'cc-storage-row',key:c.path},h('span',null,c.label),h('span',{className:'cc-val'},fmtBytes(c.bytes)),h('small',{title:c.path},String(c.why||'').replace(/\*\*/g,'')),
            h(Btn,{disabled:disabled,onClick:function(){confirm({url:'/cc/storage/clean',body:{paths:[c.path]},label:'移入回收',description:'将“'+c.label+'”的 '+fmtBytes(c.bytes)+' 缓存移入回收目录。'})}},'移入回收'))}):h('p',{className:'cc-muted'},'没有需要回收的缓存'),
          h('div',{className:'cc-row',style:{marginTop:14}},h(Btn,{disabled:disabled||!candidates.length,onClick:function(){confirm({url:'/cc/storage/clean',body:{paths:candidates.map(function(c){return c.path})},label:'批量移入回收',description:'将上面 '+candidates.length+' 项缓存（'+fmtBytes(reclaim)+'）移入回收目录。'})}},'全部移入回收'))):null,
        data?h('div',{className:'cc-row'},h('span',{className:'cc-muted',style:{flex:1}},'回收目录 · '+fmtBytes(recycle.bytes)+' · '+recycle.files+' 个文件'),
          h(Btn,{disabled:disabled||!recycle.files,onClick:function(){confirm({url:'/cc/storage/purge',body:{},label:'清空回收目录',description:'永久删除回收目录内 '+recycle.files+' 个文件（'+fmtBytes(recycle.bytes)+'）。清空后无法从本插件取回。'})}},'清空回收目录')):null,
        confirmation?h('div',{className:'cc-inline-alert',role:'alertdialog','aria-label':'确认清理'},h('div',null,h('p',null,confirmation.description),h('div',{className:'cc-row'},h(Btn,{onClick:function(){execute(confirmation)}},'确认'+confirmation.label),h(Btn,{onClick:function(){confirm(null)}},'取消')))):null)
    }

    function ChatPageCard() {
      var s = useCache()
      return h('div', { className: 'cc-card' },
        Switch('启用固定对话页宽度（关闭 = 跟随 DSH 自适应）', s.chatWidthEnabled,
          setChatWidthEnabled, !s.appearanceReady),
        s.chatWidthEnabled ? h(WidthField) : null,
        // 宽度一旦固定，会话区那两条宽度把手就"拖了没反应"，只剩误触（用户 2026-09-14）。
        // v1.7.0 拆成两个开关：两竖杠（没反应的）与侧栏分隔条（有反应的）分开管，
        // 免得想藏死控件的人顺手把能干活的也藏了。都默认关：不动 DSH 的既有行为。
        h('div', { style: { marginTop: '10px' } },
          Switch('隐藏会话区两竖杠（宽度把手：对话页宽度固定后，拖它不再改变列宽）', s.hideResizer,
            setHideResizer, !s.resizerReady)),
        h('div', { style: { marginTop: '6px' } },
          Switch('隐藏侧栏分隔条（拖它仍能改侧栏宽度，默认保留）', s.hideDivider,
            setHideDivider, !s.dividerReady)),
        s.resizerReady ? null : h('div', { className: 'cc-err' }, '「隐藏会话区两竖杠」需重启桌面应用后可用（host 半要认识 hideResizer 键）'),
        s.dividerReady ? null : h('div', { className: 'cc-err' }, '「隐藏侧栏分隔条」需重启桌面应用后可用（host 半要认识 hideDivider 键）'),
        h(Fold, { label: '说明' },
          h('div', { className: 'cc-note' },
            s.chatWidthEnabled
              ? '现在把会话列宽钉在会话区可用宽度的 ' + clampChatWidth(s.chatWidth) + '%：往会话根元素上写'
                + ' --dsh-chat-content-width / --dsh-composer-card-max-width / --dsh-chat-user-width（!important，'
                + '绕过 DSH 的响应式 clamp）。**百分比**，所以全屏/缩窗、换显示器比例都跟着走（v1.5.0 之前是固定 px）。'
                + '100% = 铺满可用区（两侧各留宿主自己的 32px 内边距）；输入卡会始终比消息列宽 32×该比例的像素。'
                + '拖动即时预览、松手才存盘；切换会话会让根节点重建，故另有一条 DOM 观察器补写回去。'
              : '未启用：宽度跟随 DSH 自己的响应式 clamp。开关与数值都存进本插件的 settings.json（原来存在底图工坊里，已随本功能一并迁出）。')
            + ' 拖拽把手分两类、各一个开关：会话区两竖杠（宽度把手，宽度钉死后拖了没反应）与'
              + '侧栏/详情栏分隔条（拖它仍能改侧栏宽）。两类都按 **cursor 含 resize** 的语义识别'
              + '（宿主的类名是 CSS-module 哈希，升级就变），再用宿主写在把手上的 data-width-handle'
              + ' 属性区分是哪一类；各自的开关拨开即隐藏，插件被停用时标记会自动撤干净。'))
    }

    // Advanced controls are lazy: the host API is read only while their view is mounted.
    var RULE_NAMES = { gate: '会话守则', ponytail: 'ponytail', shape: '输出形状' }
    function policyJson(url, body, signal) {
      var options = { cache: 'no-store', signal: signal }
      if (body !== undefined) Object.assign(options, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      return requestJson(url, options).then(function (res) {
        if (!res.ok || !res.j || res.j.ok !== true) throw new Error(res.status === 404 ? '新功能需重启 DSH Desktop 后使用' : res.j && res.j.error || '读取失败：HTTP ' + res.status)
        return res.j
      })
    }
    function usePolicyResource(url) {
      var pair = React.useState({ data: null, error: '', busy: false, loading: !!url })
      var value = pair[0], set = pair[1], owner = React.useRef(null)
      var reload = React.useState(0), tick = reload[0], setTick = reload[1]
      React.useEffect(function () {
        var current = { alive: true, busy: false, controller: new AbortController() }
        owner.current = current
        set({ data: null, error: '', busy: false, loading: !!url })
        if (url) policyJson(url, undefined, current.controller.signal).then(function (data) {
          if (current.alive) set({ data: data, error: '', busy: false, loading: false })
        }).catch(function (error) {
          if (current.alive) set({ data: null, error: error.message, busy: false, loading: false })
        })
        return function () { current.alive = false; current.controller.abort() }
      }, [url, tick])
      async function run(body, replace) {
        var current = owner.current
        if (!url || !current || current.busy || STORE.state.policyWriting) return null
        var mutation = url.indexOf('/cc/policy') === 0 && body.action !== 'preview'
          || url.indexOf('/cc/history') === 0 && body.action === 'restore'
        current.busy = true
        if (mutation) STORE.set({ policyWriting: true })
        set(function (prev) { return Object.assign({}, prev, { busy: true, error: '' }) })
        try {
          var result = await policyJson(url, body)
          // Reconcile shared state even if the user leaves this view while the
          // host finishes the write. Local component disposal only cancels UI updates.
          if (mutation) {
            if (body.action === 'restore' || body.action === 'apply' && body.scope === 'global') load()
            policyChanged()
          }
          if (!current.alive) return null
          if (replace) set(function (prev) { return Object.assign({}, prev, { data: result }) })
          return result
        } catch (error) {
          if (current.alive) set(function (prev) { return Object.assign({}, prev, { error: error.message }) })
          return null
        } finally {
          current.busy = false
          if (mutation) STORE.set({ policyWriting: false })
          if (current.alive) set(function (prev) { return Object.assign({}, prev, { busy: false }) })
        }
      }
      return Object.assign({}, value, { run: run, refresh: function () { if (!owner.current || !owner.current.busy) setTick(function (n) { return n + 1 }) } })
    }
    function policyChanged() { STORE.set({ policyTick: (STORE.state.policyTick || 0) + 1 }) }
    function policyLocked(s) {
      return s.saving || s.policyWriting || ['gate', 'ponytail', 'shape'].some(function (key) {
        return s[key + 'Saving'] || (s[key + 'Draft'] !== null && s[key + 'Draft'] !== s[key + 'Text'])
      })
    }
    function ResourceError(props) {
      return props.resource.error ? h('div', { className: 'cc-inline-alert', role: 'alert' },
        h('span', { className: 'cc-err' }, props.resource.error),
        h(Btn, { disabled: props.resource.busy, onClick: props.resource.refresh }, '重新读取')) : null
    }
    function DiffView(props) {
      var diff = props.diff
      if (!diff || !diff.changed) return h('p', { className: 'cc-muted' }, '正文没有变化')
      return h('div', { className: 'cc-diff-grid' },
        h('div', null, h('div', { className: 'cc-muted' }, '当前内容 · 从第 ' + diff.startLine + ' 行起'), h('pre', { className: 'cc-diff removed' }, diff.removed || '（空）')),
        h('div', null, h('div', { className: 'cc-muted' }, '变更后内容'), h('pre', { className: 'cc-diff added' }, diff.added || '（空）')))
    }
    function RuleHistory(props) {
      var s = useCache(), key = props.ruleKey
      var resource = usePolicyResource('/cc/history?key=' + key + '&revision=' + (s.policyTick || 0))
      var pair = React.useState(''), selected = pair[0], select = pair[1]
      var detail = usePolicyResource(selected ? '/cc/history?key=' + key + '&id=' + encodeURIComponent(selected) : null)
      var rows = resource.data && resource.data.history || []
      var busy = resource.busy || policyLocked(s)
      async function restore() {
        var result = await resource.run({ action: 'restore', key: key, id: selected })
        if (result) { acceptRule(key, result[key]); select('') }
      }
      return h('div', { className: 'cc-policy-stack' },
        h('p', { className: 'cc-muted' }, '每次修改前保留原文，清除自定义也会留档。最近 50 版在此列出。'),
        h(ResourceError, { resource: resource }),
        resource.loading ? h('span', { className: 'cc-muted' }, '正在读取历史…') : null,
        !resource.loading && !resource.error && !rows.length ? h('span', { className: 'cc-muted' }, '还没有历史版本；下次修改会自动记录。') : null,
        rows.length ? h('select', { className: 'cc-select', 'aria-label': RULE_NAMES[key] + '历史版本', value: selected, disabled: busy, onChange: function (e) { select(e.target.value) } },
          h('option', { value: '' }, '选择一个历史版本'), rows.map(function (row) { return h('option', { key: row.id, value: row.id }, new Date(row.at).toLocaleString('zh-CN') + ' · ' + row.reason + ' · ' + kb(row.bytes)) })) : null,
        h(ResourceError, { resource: detail }),
        detail.data ? h('div', null, h(DiffView, { diff: detail.data.history.diff }), h(Btn, { disabled: busy, onClick: restore }, resource.busy ? '正在恢复…' : '恢复此版本')) : null,
        policyLocked(s) ? h('p', { className: 'cc-muted' }, '请先保存或取消当前草稿，再恢复历史。') : null)
    }
    function RuleFeedback() {
      var s = useCache(), rules = {}
      Object.keys(RULE_NAMES).forEach(function (key) { rules[key] = { enabled: key === 'shape' ? shapeInjected(s) : s[key + 'Enabled'], text: s[key + 'Draft'] !== null ? s[key + 'Draft'] : s[key + 'Text'] } })
      var input = JSON.stringify(rules), pair = React.useState({ data: null, error: '' }), result = pair[0], set = pair[1]
      React.useEffect(function () {
        var alive = true, controller = new AbortController()
        set({ data: null, error: '' })
        var timer = setTimeout(function () {
          policyJson('/cc/analyze', { rules: JSON.parse(input) }, controller.signal).then(function (data) { if (alive) set({ data: data, error: '' }) })
            .catch(function (error) { if (alive) set({ data: null, error: error.message }) })
        }, 350)
        return function () { alive = false; clearTimeout(timer); controller.abort() }
      }, [input])
      if (result.error) return h('p', { className: 'cc-muted' }, result.error)
      if (!result.data) return h('p', { className: 'cc-muted' }, '正在检查规则负担…')
      var data = result.data
      return h('div', { className: 'cc-feedback' },
        h('strong', null, '启用规则合计 ' + kb(data.bytes) + ' · 粗估 ' + data.tokenEstimate.min + '–' + data.tokenEstimate.max + ' token / 请求'),
        h('p', { className: 'cc-muted' }, data.note),
        data.warnings.length ? data.warnings.map(function (warning, index) { return h('div', { className: 'cc-warn', key: index },
          h('p', null, warning.message), warning.refs.map(function (ref, i) { return h('p', { className: 'cc-muted', key: i }, RULE_NAMES[ref.key] + ' 第 ' + ref.line + ' 行：' + ref.excerpt) })) })
          : h('span', { className: 'cc-muted' }, '未发现常见重复或篇幅冲突；不代表已经完成语义审查。'))
    }
    function Diagnostics(props) {
      var s = useCache(), sid = props.sessionId
      var resource = usePolicyResource('/cc/diagnostics?sessionId=' + encodeURIComponent(sid || '') + '&revision=' + (s.policyTick || 0) + '-' + (s.savedAt || 0))
      var data = resource.data, last = data && data.lastRequest
      return h('div', { className: 'cc-policy-stack' },
        h('div', { className: 'cc-row' }, h('strong', { style: { flex: 1 } }, '从配置到实际请求'), h(Btn, { disabled: resource.loading, onClick: resource.refresh }, '重新检查')),
        h(ResourceError, { resource: resource }),
        data ? h('div', null,
          h('p', { className: 'cc-muted' }, '宿主插件 ' + data.version + ' 已加载 · ' + (data.requestProbe ? '请求检查已接入' : '请求检查未接入，请重启应用')),
          Object.keys(RULE_NAMES).map(function (key) {
            var present = last && last.rules[key]
            var message = !data.mounted[key] ? '未挂载，需要重启或检查插件冲突'
              : !sid ? '已挂载；打开会话后可核对实际请求'
              : !last ? '已挂载；尚未观察到当前会话的新请求'
              : !last.current ? '配置已有变化，等待下一次请求验证'
              : present.status === 'present' ? '最近请求确认带上规则' : present.status === 'off' ? '当前配置关闭此规则，不作注入校验' : '最近请求未找到应有规则，请检查会话是否覆盖系统提示词'
            return h('div', { className: 'cc-diagnostic-row', key: key }, h('strong', null, RULE_NAMES[key]), h('span', { className: !data.mounted[key] || last && last.current && present.status === 'missing' ? 'cc-warn' : 'cc-muted' }, message))
          }),
          last ? h('p', { className: 'cc-muted' }, '最近观察：' + new Date(last.at).toLocaleString('zh-CN') + '。只核对请求文本是否包含规则，不代表模型一定遵守；不保存对话正文。') : null) : null)
    }
    function PolicyWorkbench(props) {
      var s = useCache(), sid = props.sessionId
      var resource = usePolicyResource('/cc/policy?sessionId=' + encodeURIComponent(sid || '') + '&revision=' + (s.policyTick || 0) + '-' + (s.savedAt || 0))
      var tabPair = React.useState('presets'), mode = tabPair[0], setMode = tabPair[1]
      var scopePair = React.useState('global'), scope = scopePair[0], setScope = scopePair[1]
      var presetPair = React.useState('builtin:daily'), selected = presetPair[0], select = presetPair[1]
      var namePair = React.useState(''), name = namePair[0], setName = namePair[1]
      var previewPair = React.useState(null), preview = previewPair[0], setPreview = previewPair[1]
      var deletePair = React.useState(false), deleting = deletePair[0], setDeleting = deletePair[1]
      var noticePair = React.useState(''), notice = noticePair[0], setNotice = noticePair[1]
      var data = resource.data, locked = policyLocked(s), disabled = resource.busy || resource.loading || locked || !data
      var presets = data && data.presets || [], chosen = presets.find(function (p) { return p.id === selected })
      React.useEffect(function () { setPreview(null); setDeleting(false) }, [scope, selected, sid, s.savedAt, s.policyTick])
      async function action(body, message) {
        var result = await resource.run(Object.assign({ sessionId: sid, scope: scope }, body), false)
        if (result) {
          setNotice(message || '已保存'); setPreview(null); setDeleting(false)
          if (body.action === 'create') { var row = result.presets.find(function (p) { return p.name === name.trim() }); if (row) select(row.id); setName('') }
          if (body.action === 'delete') select('builtin:daily')
        }
      }
      async function showPreview() {
        var result = await resource.run({ action: 'preview', id: selected, scope: scope, sessionId: sid })
        if (result) setPreview(result)
      }
      return h('div', { className: 'cc-card cc-policy-tools' },
        h('div', { className: 'cc-policy-toolbar', 'aria-label': '策略工具' },
          [['presets', '策略预设'], ['session', '当前会话'], ['diagnostics', '生效检查']].map(function (tab) {
            return h('button', { type: 'button', key: tab[0], className: 'cc-policy-tool', 'aria-pressed': mode === tab[0], onClick: function () { setMode(tab[0]) } }, tab[1])
          })),
        mode === 'diagnostics' ? h(Diagnostics, { sessionId: sid }) : h(React.Fragment, null,
          h(ResourceError, { resource: resource }),
          resource.loading ? h('span', { className: 'cc-muted' }, '正在读取策略…') : null,
          notice ? h('p', { className: 'cc-muted', role: 'status' }, notice) : null,
          locked ? h('p', { className: 'cc-warn' }, '请先保存或取消规则草稿，等待设置保存完成。') : null,
          mode === 'session' ? h('div', { className: 'cc-policy-stack' },
            h('p', { className: 'cc-muted' }, sid ? '仅影响当前会话（' + sid.slice(-8) + '）的后续请求，其他会话保持各自设置。' : '先打开一个已有会话，才能单独设置。'),
            data && sid ? Object.keys(RULE_NAMES).map(function (key) {
              var overrides = data.session && data.session.overrides || {}, rule = overrides[key]
              return h('label', { className: 'cc-policy-field', key: key }, h('span', null, RULE_NAMES[key]),
                h('select', { className: 'cc-select', 'aria-label': RULE_NAMES[key] + '当前会话', disabled: disabled, value: !rule || typeof rule.enabled !== 'boolean' ? 'inherit' : String(rule.enabled),
                  onChange: function (e) { action({ action: 'session', key: key, enabled: e.target.value === 'inherit' ? null : e.target.value === 'true' }, '当前会话已更新') } },
                  h('option', { value: 'inherit' }, '跟随全局'), h('option', { value: 'true' }, '仅此会话开启'), h('option', { value: 'false' }, '仅此会话关闭')),
                rule && typeof rule.text === 'string' ? h('small', { className: 'cc-muted' }, '正文使用此会话的预设快照；选“跟随全局”后恢复全局正文。') : null)
            }) : null,
            h(Btn, { disabled: disabled || !sid || !data || !data.session || !Object.keys(data.session.overrides).length, onClick: function () { action({ action: 'session', reset: true }, '当前会话已恢复跟随全局') } }, '全部恢复跟随全局'))
          : h('div', { className: 'cc-policy-stack' },
            h('p', { className: 'cc-muted' }, '预设保存三个常驻规则的开关和正文。内置组合使用插件自带正文；外观、审查工具与省 token 开关不随预设改变。'),
            h('div', { className: 'cc-policy-fields' },
              h('label', { className: 'cc-policy-field' }, h('span', null, '应用范围'), h('select', { className: 'cc-select', 'aria-label': '预设应用范围', value: scope, disabled: resource.busy, onChange: function (e) { setScope(e.target.value) } },
                h('option', { value: 'global' }, '全局默认'), h('option', { value: 'session', disabled: !sid }, '仅当前会话'))),
              h('label', { className: 'cc-policy-field' }, h('span', null, '规则组合'), h('select', { className: 'cc-select', 'aria-label': '规则组合', value: selected, disabled: disabled, onChange: function (e) { select(e.target.value) } },
                presets.map(function (p) { return h('option', { key: p.id, value: p.id }, p.name + (p.builtin ? ' · 内置' : '')) }))),
              h(Btn, { disabled: disabled || !chosen || scope === 'session' && !sid, onClick: showPreview }, '预览应用')),
            preview ? h('div', { className: 'cc-policy-preview' },
              h('strong', null, '将“' + preview.name + '”应用到' + (preview.scope === 'global' ? '全局默认' : '当前会话')),
              preview.changes.map(function (change) { return h('div', { key: change.key },
                h('p', null, change.label + '：' + (change.before ? '开' : '关') + ' → ' + (change.after ? '开' : '关') + (change.diff.changed ? ' · 正文有变化' : ' · 正文不变')),
                change.diff.changed ? h(Fold, { label: change.label + '正文差异' }, h(DiffView, { diff: change.diff })) : null) }),
              h('div', { className: 'cc-row' }, h(Btn, { disabled: disabled, onClick: function () { action({ action: 'apply', id: preview.id, revision: preview.revision }, '预设已应用，后续请求生效') } }, '确认应用'), h(Btn, { disabled: resource.busy, onClick: function () { setPreview(null) } }, '取消'))) : null,
            h(Fold, { label: '保存与管理我的预设' },
              h('div', { className: 'cc-policy-stack' },
                h('input', { className: 'cc-select', 'aria-label': '预设名称', maxLength: 40, placeholder: '给这套规则起个名字', value: name, disabled: disabled, onChange: function (e) { setName(e.target.value) } }),
                h('div', { className: 'cc-row cc-wrap' },
                  h(Btn, { disabled: disabled || !name.trim() || scope === 'session' && !sid, onClick: function () { action({ action: 'create', name: name }, '当前组合已保存为预设') } }, '保存当前组合'),
                  h(Btn, { disabled: disabled || !chosen || chosen.builtin || !name.trim(), onClick: function () { action({ action: 'rename', id: selected, name: name }, '预设已重命名') } }, '重命名所选预设'),
                  h(Btn, { disabled: disabled || !chosen || chosen.builtin, onClick: function () { setDeleting(true) } }, '删除所选预设')),
                deleting ? h('div', { role: 'alertdialog', 'aria-label': '删除预设', className: 'cc-inline-alert' }, h('span', null, '删除“' + chosen.name + '”？已应用的规则不会改变。'), h(Btn, { disabled: resource.busy, onClick: function () { action({ action: 'delete', id: selected }, '预设已删除') } }, '确认删除'), h(Btn, { onClick: function () { setDeleting(false) } }, '取消')) : null)))))
    }
    function hostSessionId(props) {
      if (!props) return null
      var fromStore = typeof props.useSessions === 'function' ? props.useSessions(function (state) {
        if (!state) return null
        if (typeof state.current === 'string') return state.current
        var rows = state.byId || {}
        return Object.keys(rows).find(function (id) { return rows[id] && rows[id].retainedBy && rows[id].retainedBy.mainView > 0 }) || null
      }) : null
      return props.sessionId || fromStore || null
    }
    function SettingsFrame(props) { return h(CacheControlPage, { sessionId: hostSessionId(props) }) }

    var PAGE_TABS = [
      { id: 'rules', label: '规则', title: '模型如何协作', description: '规则保存后从下一个请求生效，可单独设置当前会话；自动审查只在调用时加载。' },
      { id: 'tokens', label: '省 token', title: '工具输出与用量', description: '查看压缩、去重和取回状态。统计只在此分区打开时刷新。' },
      { id: 'appearance', label: '对话外观', title: '让对话更好读', description: '调整提问气泡与会话宽度，只影响界面，不改变模型行为。' },
      { id: 'storage', label: '存储', title: '查看与整理占用', description: '先查看可回收缓存，再决定是否清理。会话历史、附件和提示词产物不参与批量清理。' },
    ]
    function CacheControlPage(props) {
      props = props || {}
      var s = useCache(), active = PAGE_TABS.find(function(t){return t.id === s.pageTab}) || PAGE_TABS[0]
      var draft = ['gate','ponytail','shape'].some(function(pre){return s[pre+'Draft'] !== null && s[pre+'Draft'] !== s[pre+'Text']})
      var enabled = (s.gateReady && s.gateEnabled ? 1 : 0) + (s.ponytailReady && s.ponytailEnabled ? 1 : 0) + (s.shapeReady && shapeInjected(s) ? 1 : 0)
      var bytes = (s.gateReady && s.gateEnabled ? s.gateBytes : 0) + (s.ponytailReady && s.ponytailEnabled ? s.ponytailBytes : 0) + (s.shapeReady && shapeInjected(s) ? s.shapeBytes : 0)
      function section(title, caption, component, key) {
        return h('section', { key: title, className: key && (s[key+'Draft'] !== null || s[key+'HistoryOpen']) ? 'is-editing' : '' },
          h('div',{className:'cc-section-head'},h('h3',{className:'cc-h'},title), key ? h('span',{className:'cc-section-kind'},'常驻规则') : null),
          caption ? h('p',{className:'cc-section-caption'},caption) : null, h(component))
      }
      var content
      if (active.id === 'rules') content = h(React.Fragment, null, h(PolicyWorkbench, { sessionId: props.sessionId }),
        h('p', { className: 'cc-global-caption' }, '全局规则 · 下方开关与正文作为所有会话的默认值；当前会话单独设置可在上方调整。'),
        h('div', { className: 'cc-analysis-area' }, ['gate','ponytail','shape'].some(function(key){return s[key+'Draft'] !== null}) ? h(RuleFeedback) : h(Fold, { label: '规则负担与检查' }, h(RuleFeedback))),
        h('div',{className:'cc-rule-grid'},
        section('会话守则','核实事实、必要提问与执行边界。',GateCard,'gate'),
        section('ponytail','编码纪律：优先复用，避免过度实现。',PonytailCard,'ponytail'),
        section('输出形状','控制回复的结构、重点与阅读节奏。',ShapeCard,'shape'),
        section('自动审查','按需检查代码，不占用常驻规则篇幅。',ReviewCard)))
      else if (active.id === 'tokens') content = section('省 token',null,SaveTokenCard)
      else if (active.id === 'appearance') content = h('div',{className:'cc-appearance-grid'},section('气泡置顶','保留最近一条提问，长内容可在气泡内滚动。',AppearanceCard),section('对话页','设置阅读宽度和拖拽把手的显示方式。',ChatPageCard))
      else content = section('存储',null,StorageCard)
      return h('div',{className:'cc-page cc-workbench'},
        h('header',{className:'cc-workbench-head'},
          h('div',null,h('div',{className:'cc-eyebrow'},'对话控制台'),h('h1',{className:'cc-workbench-title'},'会话策略'),h('p',{className:'cc-sub'},'管理模型规则、工具输出与对话外观。')),
          h('div',{className:'cc-head-actions'},h('span',{className:'cc-save-state'+(s.saving||s.error||!s.loaded?' pending':''),role:'status'},s.loading?'读取中':s.saving?'正在保存':s.error?'需要处理':s.loaded?'设置已同步':'尚未连接'),
            h(Btn,{disabled:s.loading||s.saving||draft||Object.keys(pendingSettings).length>0,onClick:load},'重新读取'))),
        s.error ? h('div',{className:'cc-inline-alert',role:'alert'},h('span',{className:'cc-err'},s.error),h(Btn,{disabled:s.saving,onClick:function(){if(Object.keys(pendingSettings).length)saveNow();else load()}},'重试')) : null,
        h('div',{className:'cc-workbench-summary'},
          h('div',null,h('span',{className:'cc-muted'},'全局常驻规则'),h('strong',null,s.loaded?enabled+' / 3 已启用':'读取中'),h('small',null,'会话可单独设置')),
          h('div',null,h('span',{className:'cc-muted'},'全局附加文本'),h('strong',null,s.loaded?kb(bytes):'—'),h('small',null,'每次请求的规则量，并非计费 token')),
          h('div',null,h('span',{className:'cc-muted'},'代码审查'),h('strong',null,!s.reviewReady?'未就绪':s.reviewRegistered?'按需可用':s.reviewEnabled?'等待服务':'未启用'),h('small',null,s.reviewRegistered&&!s.reviewOcrFound?'审查工具尚未安装':'使用时才加载规则'))),
        h('div',{className:'cc-workbench-tabs',role:'tablist','aria-label':'会话策略分区'},PAGE_TABS.map(function(tab){return h('button',{
          key:tab.id,id:'cc-tab-'+tab.id,type:'button',className:'cc-workbench-tab',role:'tab','aria-label':tab.label,'aria-selected':active.id===tab.id,'aria-controls':'cc-panel-'+tab.id,tabIndex:active.id===tab.id?0:-1,
          onClick:function(){STORE.set({pageTab:tab.id})},
          onKeyDown:function(e){
            var step=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0
            if(!step&&e.key!=='Home'&&e.key!=='End')return
            e.preventDefault();var index=PAGE_TABS.indexOf(tab)
            index=e.key==='Home'?0:e.key==='End'?PAGE_TABS.length-1:(index+step+PAGE_TABS.length)%PAGE_TABS.length
            STORE.set({pageTab:PAGE_TABS[index].id});e.currentTarget.parentNode.querySelectorAll('[role=tab]')[index].focus()
          }
        },tab.label,tab.id==='rules'&&draft?h('span',{className:'cc-tab-dot',title:'有未保存的规则草稿','aria-label':'有未保存草稿'}):null)})),
        h('div',{key:active.id,id:'cc-panel-'+active.id,role:'tabpanel','aria-labelledby':'cc-tab-'+active.id,tabIndex:0},
          h('div',{className:'cc-tab-intro'},h('div',null,h('h2',null,active.title),h('p',null,active.description))),content),
        h('footer',{className:'cc-workbench-footer'},h('span',null,'设置自动保存 · 规则正文需手动保存'),h('span',null,'会话策略 1.16.0')))
    }

    // ------------------------------------------------ 面板定位数学（纯函数）--
    /**
     * 面板定位校正：把"实测的视口位置"与"期望的视口位置"对齐，返回要并入 pos 的补丁或 null。
     *
     * 量纲约定（这条就是 2026-09-14 那个 bug 的全部原因）：**两边都必须是视口 Y 坐标**。
     *   - pos.bottom != null：面板下沿该贴在 chip 上沿之上 ⇒ 期望下沿 Y = chipRect.top − gap
     *   - pos.top    != null：翻转到下方时上沿该贴在 chip 下沿之下 ⇒ 期望上沿 Y = chipRect.bottom + gap
     * CSS 的 bottom 表示"距视口底部多远"，与视口 Y 相差一个 vh，**不能拿去和 rect 混用**。
     *
     * 收敛性：布局是线性的，一次把差补掉即归零，下一轮 dy ≈ 0 不再 setPos ⇒ 不自激。
     * 量级闸门 MAX_PANEL_PATCH：超过它说明测量本身不可信（变换矩阵、测量时机不对），
     * 宁可不校正 —— 也绝不能让一次错误测量把面板推到屏幕外。
     */
    var MAX_PANEL_PATCH = 400
    function computePanelPatch(cur, panelRect, chipRect, gap) {
      if (!cur || !panelRect || !chipRect) return null
      if (cur.bottom != null) {
        var dy = (chipRect.top - gap) - panelRect.bottom
        if (!Number.isFinite(dy) || Math.abs(dy) <= 1 || Math.abs(dy) > MAX_PANEL_PATCH) return null
        return { bottom: cur.bottom - dy }
      }
      if (cur.top != null) {
        var dy2 = (chipRect.bottom + gap) - panelRect.top
        if (!Number.isFinite(dy2) || Math.abs(dy2) <= 1 || Math.abs(dy2) > MAX_PANEL_PATCH) return null
        return { top: cur.top + dy2 }
      }
      return null
    }

    function CacheControlComposerChip(props) {
      var globalState = useCache(), sid = hostSessionId(props)
      var scoped = usePolicyResource(sid ? '/cc/policy?sessionId=' + encodeURIComponent(sid) + '&revision=' + (globalState.policyTick || 0) + '-' + (globalState.savedAt || 0) : null)
      var s = globalState
      if (sid) {
        s = Object.assign({}, globalState, { loading: globalState.loading || globalState.policyWriting || scoped.loading || scoped.busy || !scoped.data })
        var effective = scoped.data && scoped.data.session && scoped.data.session.effective
        if (effective) Object.keys(RULE_NAMES).forEach(function (key) {
          var rule = effective[key]
          s[key + 'Enabled'] = rule.enabled
          s[key + 'Text'] = rule.text
          s[key + 'Bytes'] = rule.injectedBytes
        })
      }
      async function change(key, value) {
        if (sid) {
          await scoped.run({ action: 'session', sessionId: sid, key: key, enabled: value }, true)
        } else ({ gate: setGateEnabled, ponytail: setPonytailEnabled, shape: setShapeEnabled })[key](value)
      }
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
      // ⚠️ 2026-09-14 事故：这里原来把**两个不同量纲**相减（期望值写成"距视口底部的距离"
      //    `vh - c.top + 6`，实测值 `r.bottom` 却是**视口 Y 坐标**），于是 dy 恒不为 0；
      //    而 patch 又把 dy 累加回 bottom 且依赖数组含 pos.bottom ⇒ 每帧误差翻倍，
      //    二十来帧后 bottom 涨到 -6.7e7px，面板被摆到视口外 3355 万像素处。
      //    用户看到的现象是"点 ▾ 没反应"——其实 aria-expanded 已 true、DOM 里也有 .cc-panel，
      //    只是它在屏幕外（实测 rect.y = 33554004）。定位数学抽进 computePanelPatch()，并加了
      //    ±400px 量级闸门：任何测量异常最多只能微调，不可能再把面板丢出屏幕。
      React.useEffect(function () {
        var p = panelRef.current
        var c = btnRef.current
        if (!open || !p || !c || !p.getBoundingClientRect || !c.getBoundingClientRect) return undefined
        var patch = computePanelPatch(pos, p.getBoundingClientRect(), c.getBoundingClientRect(), 6)
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
        h('span', null, sid ? '会话策略 · 仅当前会话' : '会话策略 · 全局默认'),
        h('button', { className: 'cc-close', 'aria-label': '关闭', onClick: function () { setOpen(false) } }, '✕'))

      // 会话守则 —— 同一个框内，独立开关
      var gateSection = [
        h('div', { className: 'cc-sect', key: 'h', style: { borderTop: 'none', paddingTop: '0' } },
          h('span', { className: 'cc-sectTitle' }, '会话守则'),
          h('span', { className: 'cc-sectHint' }, '下一步即生效')),
        h(React.Fragment, { key: 'on' }, Switch('启用（规则 R1–R3 研判提问分工 / R5–R7 少犯错·查证·谨慎）', s.gateEnabled, function(v){change('gate',v)}, s.loading || !s.gateReady)),
        s.gateReady ? h('div', { key: 'meta' }, GateSummary(s))
          : h('div', { className: 'cc-err', key: 'meta' }, '未装载：需重启桌面应用'),
        s.gateOpen ? h('div', { className: 'cc-gateBody', key: 'body' }, s.gateText || '（空）') : null,
        h('div', { key: 'btns', style: { display: 'flex', gap: '6px', alignItems: 'center' } },
          h(Btn, {
            onClick: function () {
              var next = !STORE.state.gateOpen
              STORE.set({ gateOpen: next })
              if (next && !STORE.state.gateText) reloadGate()
            },
          }, s.gateOpen ? '收起规则' : '查看规则'),
          h(Btn, { onClick: reloadGate }, '重读'),
          s.gateSaving ? h('span', { className: 'cc-muted', key: 'hint' }, '规则处理中…') : null),
      ]

      // ponytail —— 独立开关，与门禁同族（v1.10.0 加入；曾写作 "②b"，v1.11.1 起标题不带编号）
      var ponySection = [
        h('div', { className: 'cc-sect', key: 'h' },
          h('span', { className: 'cc-sectTitle' }, 'ponytail'),
          h('span', { className: 'cc-sectHint' }, '下一步即生效')),
        h(React.Fragment, { key: 'on' }, Switch('启用编码纪律（YAGNI / 梯子 / 修根因）', s.ponytailEnabled, function(v){change('ponytail',v)}, s.loading || !s.ponytailReady)),
        s.ponytailReady ? h('div', { key: 'meta' }, RuleSummary(s, 'ponytail'))
          : h('div', { className: 'cc-err', key: 'meta' }, '未装载：需重启桌面应用'),
        s.ponytailOpen ? h('div', { className: 'cc-gateBody', key: 'body' }, s.ponytailText || '（空）') : null,
        h('div', { key: 'btns', style: { display: 'flex', gap: '6px', alignItems: 'center' } },
          h(Btn, {
            onClick: function () {
              var next = !STORE.state.ponytailOpen
              STORE.set({ ponytailOpen: next })
              if (next && !STORE.state.ponytailText) reloadPonytail()
            },
          }, s.ponytailOpen ? '收起规则' : '查看规则'),
          h(Btn, { onClick: reloadPonytail }, '重读'),
          s.ponytailSaving ? h('span', { className: 'cc-muted', key: 'hint' }, '规则处理中…') : null),
      ]

      // 输出形状 —— 独立开关，与上面两段同族（v1.12.0 并入；规则正文的编辑在设置页那张卡里）
      var shapeSection = [
        h('div', { className: 'cc-sect', key: 'h' },
          h('span', { className: 'cc-sectTitle' }, '输出形状'),
          h('span', { className: 'cc-sectHint' }, '下一步即生效')),
        h(React.Fragment, { key: 'on' }, Switch('启用回复形状（首行给下一步 / 无客套）', s.shapeEnabled, function(v){change('shape',v)}, s.loading || !s.shapeReady)),
        s.shapeReady ? h('div', { key: 'meta' }, RuleSummary(s, 'shape'))
          : h('div', { className: 'cc-err', key: 'meta' }, '未装载：需重启桌面应用'),
        s.shapeReady && s.shapeDisabledByEnv
          ? h('div', { className: 'cc-warn', key: 'env' }, '环境变量 DSH_OUTPUT_SHAPE_DISABLE=1 正在强制关闭本段。') : null,
        h('div', { key: 'btns', style: { display: 'flex', gap: '6px', alignItems: 'center' } },
          h(Btn, { onClick: reloadShape }, '重读'),
          h('span', { className: 'cc-muted' }, '改规则去设置页')),
      ]

      var note = h('div', { className: 'cc-note' },
        '守则：' + (!s.gateReady ? '未装载，需重启桌面应用。'
          : s.gateEnabled
            ? kb(s.gateBytes) + ' 规则已常驻 system prompt，对当前所选范围的后续请求生效，不被压缩稀释。'
            : '未注入，模型不会看到 R1–R3/R5–R7。')
        + ' ponytail：' + (!s.ponytailReady ? '未装载，需重启桌面应用。'
          : s.ponytailEnabled
            ? kb(s.ponytailBytes) + ' 编码纪律常驻注入（对非编码会话也占 token）。'
            : '未注入，仅按需技能可用。')
        + ' 输出形状：' + (!s.shapeReady ? '未装载，需重启桌面应用。'
          : s.shapeDisabledByEnv ? '被环境变量 DSH_OUTPUT_SHAPE_DISABLE=1 强制关闭。'
            : s.shapeEnabled
              ? kb(s.shapeBytes) + ' 回复形状常驻注入（默认开，在所选范围生效）。'
              : '未注入，仅按需技能 i-have-adhd 可用。'))
      var status = scoped.error ? h('div', { className: 'cc-err' }, scoped.error) : s.error || s.gateError || s.ponytailError || s.shapeError
        ? h('div', { className: 'cc-err' }, s.error || s.gateError || s.ponytailError || s.shapeError)
        : h('div', { className: 'cc-ok' }, s.saving ? '正在保存…' : '已与磁盘一致')

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
        h('div', { className: 'cc-note' }, sid ? '这里的开关仅影响当前会话。设置页可恢复跟随全局；子会话保持自己的设置。' : '这里修改全局默认规则。'),
        h(React.Fragment, null, gateSection),
        h(React.Fragment, null, ponySection),
        h(React.Fragment, null, shapeSection),
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

      // ---- chip：每段各自可点（点哪段切哪个），竖线分隔，右侧 ▾ 才弹面板 ----
      var gateTitle = '会话守则 · 长期规则：' + (!s.gateReady ? '未装载，需重启桌面应用。'
        : (s.gateEnabled ? '开（' : '关（') + kb(s.gateBytes) + ' · ' + s.gateLines + ' 行 · '
          + (s.gateSource === 'override' ? '自定义' : '内置') + '）'
          + '\nR1 独立研判 / R2 必要提问 / R3 分工固定 / R5 少犯错 / R6 查证 / R7 谨慎，常驻 system prompt。'
          + '\n生效范围：当前所选范围的后续请求，不被压缩稀释。'
          + '\n点这一段 = 直接开/关；要看或改规则点右侧 ▾。')
      var ponyTitle = 'ponytail 编码纪律：' + (!s.ponytailReady ? '未装载，需重启桌面应用。'
        : (s.ponytailEnabled ? '开（' : '关（') + kb(s.ponytailBytes) + ' · ' + s.ponytailLines + ' 行 · '
          + (s.ponytailSource === 'override' ? '自定义' : '内置') + '）'
          + '\nYAGNI / 七级梯子 / 修根因 / 禁没要求的抽象，常驻 system prompt。'
          + '\n生效范围：当前所选范围的后续请求；只对编码任务生效，但 token 对所有会话照收。'
          + '\n点这一段 = 直接开/关。')
      var shapeTitle = '输出形状（回复形状 · 默认开）：' + (!s.shapeReady ? '未装载，需重启桌面应用。'
        : (shapeInjected(s) ? '开（' : '关（') + kb(s.shapeBytes) + ' · ' + s.shapeLines + ' 行 · '
          + (s.shapeSource === 'override' ? '自定义' : '内置') + '）'
          + (s.shapeDisabledByEnv ? '\n注意：DSH_OUTPUT_SHAPE_DISABLE=1 正在强制关闭，开关状态不作数。' : '')
          + '\n首行给下一步 / 多步编号 / 状态复述 / 跑题后置 / 报错讲因果 / 无开场白无客套，常驻 system prompt。'
          + '\n生效范围：当前所选范围的后续请求。'
          + '\n点这一段 = 直接开/关；要改规则去设置页「输出形状」。')
      var caretTitle = '规则面板：查看·重读规则（气泡置顶与对话页宽度在设置页）'

      return h(React.Fragment, null,
        h('span', {
          className: 'cc-chip' + ((s.gateEnabled || s.ponytailEnabled || shapeInjected(s)) ? ' on' : ''),
          ref: btnRef,
          'data-cache-control-toggle': '1',
        },
          sid ? h('span', { className: 'cc-scope-label' }, '本会话') : null,
          h('button', {
            type: 'button',
            className: 'cc-seg' + (s.gateEnabled && s.gateReady ? ' on' : ''),
            disabled: s.loading || !s.gateReady,
            'aria-pressed': s.gateEnabled === true && s.gateReady === true,
            title: (sid ? '仅当前会话\n' : '全局默认\n') + gateTitle,
            onClick: function(){change('gate', !s.gateEnabled)},
          },
            h('span', { className: 'cc-segLabel' }, '提问'),
            OnOff(s.gateEnabled, !s.gateReady)),
          h('span', { className: 'cc-div' }),
          h('button', {
            type: 'button',
            className: 'cc-seg' + (s.ponytailEnabled && s.ponytailReady ? ' on' : ''),
            disabled: s.loading || !s.ponytailReady,
            'aria-pressed': s.ponytailEnabled === true && s.ponytailReady === true,
            title: (sid ? '仅当前会话\n' : '全局默认\n') + ponyTitle,
            onClick: function(){change('ponytail', !s.ponytailEnabled)},
          },
            h('span', { className: 'cc-segLabel' }, '懒码'),
            OnOff(s.ponytailEnabled, !s.ponytailReady)),
          h('span', { className: 'cc-div' }),
          h('button', {
            type: 'button',
            className: 'cc-seg' + (shapeInjected(s) && s.shapeReady ? ' on' : ''),
            disabled: s.loading || !s.shapeReady,
            'aria-pressed': shapeInjected(s) === true && s.shapeReady === true,
            title: (sid ? '仅当前会话\n' : '全局默认\n') + shapeTitle,
            onClick: function(){change('shape', !s.shapeEnabled)},
          },
            h('span', { className: 'cc-segLabel' }, '形状'),
            OnOff(shapeInjected(s), !s.shapeReady)),
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
          stopResizerWatch()   // 不给宿主留一条被隐藏的把手：卸载时把标记撤干净
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
              function (props) { return h(PageBoundary, null, h(SettingsFrame, props)) })
          })
        } catch (e) { errors.push('settings.section: ' + String((e && e.message) || e)) }
      }
      // ---- 错误边界：整页渲染若抛错，把原因显示在面板里（槽在 production React 下静默吞掉，不留痕）----
      class PageBoundary extends React.Component {
        constructor(props) { super(props); this.state = { err: null } }
        static getDerivedStateFromError(e) { return { err: String((e && e.stack) || (e && e.message) || e) } }
        componentDidCatch(e) { if (typeof console !== 'undefined') console.error('cache-control settings page:', e) }
        render() {
          if (this.state.err) return h('div', { className: 'cc-card' }, h('div', { className: 'cc-err', style: { whiteSpace: 'pre-wrap', fontSize: '11px' } }, '会话策略渲染失败：\n' + this.state.err))
          return this.props.children
        }
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
          return slots.register(rightEntry, function (props) {
            return React.createElement(ChipBoundary, null, h(CacheControlComposerChip, props))
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
      // Static format checks and real React lifecycle checks share the same
      // production view/card; no test-only rendering branch.
      SaveTokenView: renderSaveTokenView,
      SaveTokenCard: SaveTokenCard,
      CacheControlPage: CacheControlPage, StorageCard: StorageCard,
      saveNow: saveNow, reloadSettings: load, saveGateText: saveGateText, reloadGate: reloadGate, setReviewEnabled: setReviewEnabled,
      ST_KIND: ST_KIND,
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
      clampChatWidth: clampChatWidth,
      CHAT_PCT_MIN: CHAT_PCT_MIN,
      CHAT_PCT_MAX: CHAT_PCT_MAX,
      CHAT_PCT_DEFAULT: CHAT_PCT_DEFAULT,
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
      // v1.6.0 缝：面板定位数学（纯函数，离线可断言收敛性）与原生拖拽条隐藏。
      computePanelPatch: computePanelPatch,
      MAX_PANEL_PATCH: MAX_PANEL_PATCH,
      markResizers: markResizers,
      clearResizers: clearResizers,
      applyResizerHiding: applyResizerHiding,
      setHideResizer: setHideResizer,
      setHideDivider: setHideDivider,
      isWidthHandle: isWidthHandle,
      WIDTH_HANDLE_ATTR: WIDTH_HANDLE_ATTR,
      RESIZER_CURSOR_RE: RESIZER_CURSOR_RE,
      pinChatWidth: pinChatWidth,
      findChatRoot: findChatRoot,
      setChatWidthEnabled: setChatWidthEnabled,
      commitChatWidth: commitChatWidth,
      setForceOpen: function (v) { FORCE_OPEN = !!v },
      setFoldsOpen: function (v) { FOLD_DEFAULT_OPEN = !!v },
      chipText: function () {
        return { gateEnabled: STORE.state.gateEnabled, gateReady: STORE.state.gateReady }
      },
      // v1.10.0 缝：ponytail 段与门禁互不影响，chip"点哪段切哪个"要能离线断言
      flipPonytail: flipPonytail,
      setPonytailEnabled: setPonytailEnabled,
      ponytailChip: function () {
        return { ponytailEnabled: STORE.state.ponytailEnabled, ponytailReady: STORE.state.ponytailReady }
      },
      // v1.12.0 缝：输出形状段同理 —— "点哪段切哪个"、默认开、逃生开关压过设置，都要能离线断言
      flipShape: flipShape,
      setShapeEnabled: setShapeEnabled,
      shapeInjected: shapeInjected,
      shapeChip: function () {
        return {
          shapeEnabled: STORE.state.shapeEnabled,
          shapeReady: STORE.state.shapeReady,
          shapeDisabledByEnv: STORE.state.shapeDisabledByEnv,
          injected: shapeInjected(),
        }
      },
    }
    return module.exports
  },
})
