---
id: "f8793184-7072-4254-900e-2e30672183b6"
level: "task"
title: "rex migrate-plan / migrate-apply and ndx migrate-layout still run inside an agent run"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-23"
  - "lane-migration"
  - "needs-decision"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "rex migrate-plan and rex migrate-apply exit non-zero and write nothing with NDX_AGENT_RUN=1 set (test, fails today)"
  - "ndx migrate-layout exits non-zero and moves nothing with NDX_AGENT_RUN=1 set (test, fails today)"
  - "Without the marker all three run as before (existing tests pass)"
description: "Found by the adversarial review of 315b10e0 (run 4c45fe7d). Verdict: should-fix (low); S2-Q5 deliberately scoped the guard to `ndx migrate` and core only.\n\nScenario: inside an `ndx work` agent session (NDX_AGENT_RUN=1), `ndx migrate` now refuses (packages/core/cli.js handleMigrate), but the same writes are reachable by other doors: `rex migrate-plan . && rex migrate-apply .` (or `ndx rex migrate-apply`), and `ndx migrate-layout .`, which moves state into .ndx/. None checks the marker, so an agent that reads rex's help or the docs can still migrate the repository it is working in.\n\nReachable: yes, through the hench allowlist (npx, node) — but less likely than `ndx migrate`, which the notice names.\n\nOptions:\n1. (Recommended) Refuse in rex's migrate-plan/migrate-apply CLI handlers and in core's handleMigrateLayout when NDX_AGENT_RUN is set, with the same message. Small; a rex change, so needs Ryan's OK given S2-Q5's \"core only\".\n2. Leave as is and document that the marker guards only `ndx migrate`."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T04:40:12.675Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
