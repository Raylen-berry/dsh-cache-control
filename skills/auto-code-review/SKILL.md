---
name: auto-code-review
description: >
  写完/改完代码后的一轮硬审查：用 open-code-review（ocr）的 delegate 模式取「该审哪些文件」与
  「这些文件命中的规则」，再按规则逐条核对 diff，输出定位到 文件:行 的问题清单。适用于任何编码
  任务的收尾——写、改、重构、修 bug、合分支前。用户说"审一下""过一遍代码""按 ocr 规则查"时启用。
  NOT for: 需求尚未落地成代码时；纯文档/配置改动；只要风格统一就行的场景（那是 formatter 的活）。
whenToUse: 一轮编码工作即将交付前；改动跨多文件、或涉及安全/并发/输入处理路径时。
allowed-tools: Bash, Read, Grep, Glob, AskUserQuestion
---

# 自动代码审查（open-code-review · delegation mode）

上游 [alibaba/open-code-review](https://github.com/alibaba/open-code-review)（Apache-2.0）。
本技能只借用它的**确定性那一半**：选文件、分组、按文件特征匹配规则。判断由当前模型做，不需要 API key。

## 为什么是委托模式，不是把规则抄进常驻提示词

上游 README 明确把"通用 agent + 自然语言 skill 做审查"列为反面教材，三条通病：大 changeset
选择性漏审、报出的问题与实际行号漂移、prompt 微调就质量大幅波动。根因是**纯语言驱动对审查过程
没有硬约束**。所以这里不复制规则文本，每次现取 —— 规则跟着上游升级，不在我们仓库里腐烂。

## 前置

`ocr` 可执行文件在 PATH 上（`npm install -g @alibaba-group/open-code-review`），Git ≥ 2.41。
不在 ⇒ 直接说明并跳过本流程，**不要**改用别的东西凑数、也不要反复重试安装。

## 三步

1. **问它该审什么**（不要自己 `git diff --name-only` 猜 —— 那正是漏审的来源）：

   ```bash
   ocr delegate preview --format json
   ```

   读 `reviewable_files[]`（含 `path` / `status` / `insertions` / `deletions`）与
   `excluded_count`。范围不对时用 `--from <base> --to <head>` 或 `-c <commit>` 重取，
   而不是手工挑文件。

2. **按组取规则**（同一条命令可以传多个路径，它会按规则内容分组）：

   ```bash
   ocr delegate rule --format json <path1> <path2> ...
   ```

   读 `groups[]`：每组一份 `rule` 正文 + 适用的 `files[]`。**逐组审，不要合并成一遍扫**——
   分组的存在就是为了把注意力锁在对应文件上。

3. **对着 diff 出结论**，每条问题必须给 `文件:行 + 违反的是哪条规则 + 一句为什么`。
   拿不准是否真问题的标【存疑】列在最后，不要混进确定项。

## 硬性边界

- **不许只看 diff 就下结论**。规则里凡是要求核对上下文的（空指针、Hooks 规则、异步是否独立、
  重复代码可提取），必须把相关文件读进来再看。
- **一行都不许编造行号**。没在 diff 或文件里确认过的位置不能出现在结论里。
- 上游基准显示它偏向精确率、**recall 有意更低**：它没圈进来的文件不代表干净，只代表它选了不审。
  需要全量审计用 `ocr scan`，那是另一条路。
- 结论只报告，**不自动改代码**。改不改由用户定（会话守则 R1：裁决权在用户）。
- 与 ponytail / R5 的关系：那两个管"少写、写最小实现"，本技能管"写出来的东西对不对"。
  重叠处（死代码、过度抽象）以 ponytail 的判断为准，本技能不重复提。
