---
id: "fb20ed48-0a1e-4c82-b556-a5a7a1dc8d9d"
level: "task"
title: "Decide whether a running hench run is actually running from its recorded pid, host and heartbeat, with lock files as the fallback"
status: "pending"
priority: "high"
tags:
  - "live"
  - "run-liveness"
  - "adopted-from-pr-484"
source: "adopted from draft PR #484 (fix/running-task-audit), adapted to the Live branch's decisions, 2026-10-01"
acceptanceCriteria:
  - "A running record whose pid is alive and heartbeat fresh is `live`; whose pid is dead on this host is `orphaned` with canEnd true; recorded on another host is `foreign` (unit tests)."
  - "A live pid whose heartbeat is older than the shared stale threshold is `unknown`, not `live` (unit test)."
  - "EPERM from the pid probe counts as alive (unit test)."
  - "A record with no pid falls back to lock-file evidence with #484's attribution window (unit tests ported from #484)."
  - "Changeset for @n-dx/hench (patch)."
description: "Run files stay `status: \"running\"` forever after a crash, Ctrl-C, reboot or kill -9, and today only a time-since-heartbeat `stale` flag hints at it. Add one canonical liveness verdict in hench, `packages/hench/src/process/run-liveness.ts`, adapted from draft PR #484 (`git show refs/review/pr-484:packages/hench/src/process/run-liveness.ts`, commit 0563a730d) but with this branch's evidence taking precedence.\n\nVerdicts (same names as #484 so its tests and copy can be reused): `live`, `foreign`, `unknown`, `orphaned`, each with a human-readable `reason`, the identified `pid` (or null) and `canEnd` (true only for `orphaned`). Evidence, in this order:\n1. The run's `host` (already on the run record) differs from this machine → `foreign`; local pids say nothing about it.\n2. The run record's own `pid` (added on this branch and refreshed by the heartbeat): alive → `live`; dead → `orphaned`. When the pid is alive but the heartbeat (`lastActivityAt`) is older than the shared stale threshold, report `unknown` with a reason saying the process exists but has stopped reporting (hung, or the pid was reused), never `live`.\n3. Only for records written before the pid field existed: fall back to #484's `.hench/locks/<pid>.lock` evidence (a live lock naming the task → `live`; untagged live locks started within #484's attribution window → `unknown`; none → `orphaned`).\nAlive means `process.kill(pid, 0)` succeeds or fails with EPERM: EPERM is a process that exists but belongs to someone else, so it must read as alive, matching `packages/web/src/server/run-staleness.ts`. #484's copy treats EPERM as dead, which would end a live run; do not carry that over.\nThe verdict is a pure function of (run record, live locks, host, now) plus an injectable pid probe, so it is testable without processes. Port #484's unit tests for the lock-fallback cases and add cases for each pid rule.\n\nConstraints: hench imports only through its gateways; additive, no schema change; changeset for @n-dx/hench (patch)."
lastModified: "2026-10-01T19:44:28.490Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
