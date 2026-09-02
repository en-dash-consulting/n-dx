---
id: "eda61028-981e-4196-9555-8100e9e65ebf"
level: "feature"
title: "Artifact diet — cap sourcevision artifacts and startup context"
status: "completed"
priority: "medium"
tags:
  - "sourcevision"
  - "hench"
  - "context"
  - "artifacts"
source: "ndx-capture"
startedAt: "2026-08-31T15:11:01.723Z"
completedAt: "2026-08-31T15:11:01.723Z"
endedAt: "2026-08-31T15:11:01.723Z"
acceptanceCriteria:
  - "The llms.txt file-path table is capped with a stated truncation marker"
  - "The CONTEXT.md routes section is capped in line with the existing findings cap"
  - "The sourcevision zones MCP resource returns compact (non-pretty-printed) JSON and supports pagination or per-zone scoping instead of the whole file in one result"
  - "hench --context-file enforces a size guard and reports truncation instead of inlining unbounded content"
  - "ndx work injects a distilled repo primer (5–10 KB, cached by sourcevision content hash) instead of the full CONTEXT.md plus PRD tree"
  - "Task briefs cap sibling lists, dedupe inherited requirements across the parent chain, and summarize workflow.md instead of embedding it verbatim"
description: "Sourcevision artifacts tax every downstream consumer (audit S1–S3, H7, H10). llms.txt is ~70% an uncapped file-path table (llms-txt.ts:285-303); CONTEXT.md's routes section is uncapped (context.ts:163-173) and the whole file is piped into every ndx work run; the sourcevision://zones MCP resource serves all of zones.json pretty-printed (~80K tokens; cli/mcp.ts:508); hench's --context-file is read whole with no size guard (run.ts:1177); briefs include unbounded sibling lists, the full inherited-requirements chain, and workflow.md verbatim (brief.ts:135-255). Cap all of these, and replace the untrimmed CONTEXT.md + full-PRD-tree pipe with a distilled 5–10 KB repo primer (context.distill task class) cached by content hash — the vendor-neutral startup-context floor (design §08.3)."
lastModified: "2026-08-31T15:11:01.728Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Cap hench startup context: --context-file size guard and brief diet](./cap-hench-startup-context-context-file.md) | completed |
| [Cap sourcevision artifacts: llms.txt file table, CONTEXT.md routes, zones MCP resource](./cap-sourcevision-artifacts-llms-txt.md) | completed |
| [Distilled context primer (context.distill) replacing the untrimmed CONTEXT.md pipe](./distilled-context-primer-context.md) | completed |
