---
id: "b092ce9b-d725-4872-8db2-e2a0ba7d117f"
type: "task"
title: "Sidecar replies lose single line breaks since they render as Markdown"
slug: "sidecar-replies-lose-single-line"
description: "Verdict: should-fix (adversarial review of 5e3017b6). renderMarkdown (packages/web/src/viewer/utils/markdown.ts, paragraph branch) joins consecutive non-blank lines with a space, and .sidecar-msg-assistant now sets white-space: normal. A reply such as \"Done.\\nRun ndx work next.\\nThen check Live.\" previously showed three lines (pre-wrap) and now shows one run-on line. Reachable on every Sidecar and hub-drawer reply with single newlines. Options: (a) add a `breaks` option to renderMarkdown that emits <br> between paragraph lines, on for Sidecar, off for the PR preview (cheap, recommended); (b) restore pre-wrap on paragraphs only (CSS-only, but keeps the source's indentation spaces too)."
acceptanceCriteria:
  - "A Sidecar reply with single newlines inside a paragraph shows each line on its own line (viewer test)"
  - "The PR preview still joins wrapped lines into one paragraph (viewer test)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
