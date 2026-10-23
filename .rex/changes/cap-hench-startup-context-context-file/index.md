---
id: "cbe1204f-415d-4dde-92c0-e38e8db3e530"
type: "change"
title: "Cap hench startup context: --context-file size guard and brief diet"
slug: "cap-hench-startup-context-context-file"
intent: "hench reads --context-file whole with readFileSync and no size bound (run.ts:1253), and ndx work pipes the entire CONTEXT.md plus the full PRD tree through it. Task briefs additionally carry unbounded sibling lists, the full inherited-requirements chain up every parent, and workflow.md verbatim (brief.ts). Add a size guard that truncates with a stated marker rather than inlining unbounded content, cap sibling lists, dedupe inherited requirements across the parent chain, and summarize workflow.md instead of embedding it whole."
acceptanceCriteria:
  - "hench --context-file enforces a size guard and reports truncation instead of inlining unbounded content"
  - "Task briefs cap sibling lists with an omission marker"
  - "Inherited requirements are deduplicated across the parent chain"
  - "workflow.md is summarized rather than embedded verbatim"
  - "A brief built from a pathological PRD stays within a bounded size, verified by test"
touches:
  - "eda61028-981e-4196-9555-8100e9e65ebf"
priority: "medium"
tags:
  - "hench"
  - "context"
source: "ndx-work"
---
