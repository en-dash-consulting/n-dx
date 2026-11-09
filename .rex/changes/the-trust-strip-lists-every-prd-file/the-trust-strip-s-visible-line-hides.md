---
id: "5fffe8ab-9579-4d30-92f6-e595c9b0aaa3"
type: "task"
title: "The trust strip's visible line hides the PRD item count behind '+N more' when three config files come first"
slug: "the-trust-strip-s-visible-line-hides"
description: "Verdict: should-fix (medium). Found by adversarial review of 6c7e1f04.\n\nScenario: packages/llm-client/src/repo-trust.ts `collectRepoExecutionConfig` pushes the grouped PRD entry (`.rex/changes/** (214 PRD items with saved run settings)`) after hench config, project config and assistant files (around lines 1044–1157). packages/web/src/viewer/components/repo-trust-strip.ts `buildTrustNotice` names the first three sources, within a 140-character budget, then `+N more`. A checkout with `.hench/config.json`, `.n-dx.json` and `.mcp.json` shows `(.hench/config.json, .n-dx.json, .mcp.json, +1 more)`, and the PRD count the task title promises never shows. Reachable on every untrusted dashboard load in such a checkout.\n\nOptions:\n1. (Recommended) The server sends a structured count, such as `prdRunBlocks: number` on the /api/trust view. The strip appends 'and N PRD items with saved run settings' and leaves that entry out of the named sources. Cost: a small server and viewer change plus a test. It doesn't depend on wording.\n2. The strip recognises the grouped entry by its `PRD items with saved run settings` suffix and always names it. Cheap, but it couples the strip to llm-client's wording.\n3. The server orders the grouped entry first. Cheap, but it loses the config-file names when the budget is tight."
acceptanceCriteria:
  - "With sources [.hench/config.json, .n-dx.json, .mcp.json, '.rex/changes/** (214 PRD items with saved run settings)'], the strip's visible detail contains '214 PRD items' (viewer unit test)"
  - "The visible line stays under the existing 400-character cap in that case (viewer unit test)"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
