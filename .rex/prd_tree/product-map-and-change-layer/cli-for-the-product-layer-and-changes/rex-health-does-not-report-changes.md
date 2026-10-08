---
id: "da151468-f047-4581-89a1-369d24eaea66"
level: "task"
title: "rex health does not report changes that are not landed on main"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "rex"
  - "pr-11"
blockedBy:
  - "f5d8c06e-1f67-4390-ab65-23b9799c6486"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "rex health on a v2 tree whose completed change was squash-merged without its trailer prints that change with the 'not reachable from main' reason (test)"
  - "rex health on a shallow clone reports the landing check as unavailable instead of failing the whole command (test)"
description: "The landing task (52f22b65) asked that a 'not landed' result be reported by rex health. computeLandings returns landed:false with a reason, but rex health (core/health.ts) still works on the v1 PRDItem model and never calls it. A completed change that was squash-merged without its N-DX-Item trailer is therefore invisible to the operator.\n\nEvidence: packages/rex/src/core/change-landing.ts has no caller. Related: f5d8c06e (run the v2 tree rules from rex health) is the same wiring gap for checkV2Rules, and this should land with or after it.\n\nReachable: through `rex health` on a v2 tree, once v2 health exists.\n\nVerdict: should-fix. The criterion in the description was not met by 52f22b65.\n\nFix: once rex health reads a v2 tree, call computeLandings for completed changes and print each landed:false change with its reason. When git is unavailable or the clone is shallow, print the error as a health note, not a crash."
lastModified: "2026-10-08T04:55:37.295Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
