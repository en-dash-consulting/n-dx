---
id: "da151468-f047-4581-89a1-369d24eaea66"
level: "task"
title: "rex health does not report changes that are not landed on main"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "rex"
  - "pr-11"
blockedBy:
  - "f5d8c06e-1f67-4390-ab65-23b9799c6486"
source: "ndx-adversarial-review"
startedAt: "2026-10-09T06:48:08.576Z"
completedAt: "2026-10-09T06:55:34.030Z"
endedAt: "2026-10-09T06:55:34.030Z"
resolutionType: "code-change"
resolutionDetail: "Run 32701a16 (claude-sonnet-5-5, review claude-opus-5-5), commits 59a1fc1dc and 9842108b4; stale dist only; gate re-run green after rebuild (node scripts/run-all-tests.mjs affected 319b9a873, 4/4 suites). Closed by the overnight Lane A session."
acceptanceCriteria:
  - "rex health on a v2 tree whose completed change was squash-merged without its trailer prints that change with the 'not reachable from main' reason (test)"
  - "rex health on a shallow clone reports the landing check as unavailable instead of failing the whole command (test)"
description: "The landing task (52f22b65) asked that a 'not landed' result be reported by rex health. computeLandings returns landed:false with a reason, but rex health (core/health.ts) still works on the v1 PRDItem model and never calls it. A completed change that was squash-merged without its N-DX-Item trailer is therefore invisible to the operator.\n\nEvidence: packages/rex/src/core/change-landing.ts has no caller. Related: f5d8c06e (run the v2 tree rules from rex health) is the same wiring gap for checkV2Rules, and this should land with or after it.\n\nReachable: through `rex health` on a v2 tree, once v2 health exists.\n\nVerdict: should-fix. The criterion in the description was not met by 52f22b65.\n\nFix: once rex health reads a v2 tree, call computeLandings for completed changes and print each landed:false change with its reason. When git is unavailable or the clone is shallow, print the error as a health note, not a crash.\n\nDesign boundary (PR 18, 2026-10-09):\n- v1 trees keep today's behaviour exactly, as PR 17 did for add_item. On a v2 tree, ndx add, smart-add and capture create a change and propose placement; on a v1 tree they add a level-based item as today. rex health on a v1 tree reports exactly what it reports today; the v2 tree rules (f5d8c06e) and the landing check (da151468) run on v2 trees only. This repository's own PRD is v1, and ndx add, rex add, smart-add and rex health are used on it every day.\n- No skill text changes (.claude/, .agents/, packages/core/assistant-assets/skills/). Rewriting the PRD skills for v2 is PR 24 (d5f63839).\n- Write paths go through PR 31's store transaction (store.withTransaction).\n- Lane files: packages/rex/src/cli/ (commands, help), packages/rex/src/core/health.ts and the reshape/reorganize/prune modules, tree-diff, and packages/core for ndx add routing (spawn only, no library imports in orchestration scripts). Do not change web, hench, MCP tool shapes or the v2 schema.\n- Terminology: \"capability criteria\" for a capability's criteria; \"acceptance criteria\" (or \"done when\") for a work item's acceptanceCriteria. Never a bare \"criteria\" in help text or errors."
lastModified: "2026-10-09T06:55:34.311Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
