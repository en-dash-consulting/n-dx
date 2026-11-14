---
id: "58c29a6c-14b2-474e-acfb-237613391f80"
type: "task"
title: "Give every vendor CLI session the host slot directory"
slug: "give-every-vendor-cli-session-the-host"
summary: "A vendor CLI session that starts before hench finishes finding the slot location goes the whole session without it. This makes the session start wait for that lookup briefly, once per session, and gives Codex sessions the location too."
description: "Fixes change 10fb002b (\"A vendor CLI session started before…\"), found by the review of task 5e14adef (commit e1ccf4e2b). Read its intent. Close it with a resolution naming this task's commit.\n\nProblem: `spawnVendorProcess` in `packages/hench/src/agent/lifecycle/cli-loop.ts` calls `sandbox.prepareSpawn(cliEnv)` once per session. `prepareSpawn` (via `withHostValidationSlotDir` / `reclaimHostValidationSlot` in `packages/hench/src/process/validation-run.ts`) only peeks at the host identity cache. If the `ioreg`/`reg` lookup started at run start has not finished, the session gets no `NDX_VALIDATION_SLOT_DIR` and no pre-spawn reclaim for its whole life.\n\nFix:\n- For the vendor CLI session spawn only, which happens once per session, wait for the host identity lookup before building the session env. Bound the wait by the existing lookup timeout and honour the run's abort signal. A transient failure (or the 60 s negative cache) still falls through without a directory, with one warning line saying in-session test runs will resolve the slot themselves. Per-command tool spawns keep the existing never-wait peek.\n- Hand `NDX_VALIDATION_SLOT_DIR` to Codex vendor sessions the same way as Claude sessions (the review's dropped low finding), wherever the vendor session env is built (`resolveSessionCliEnv` and the codex path).\n- Keep `startHostIdentityLookup` at run start so the wait is usually zero.\n\nTests:\n- the vendor CLI session env carries the directory when the lookup resolves after spawn begins (an injected slow identity), and the spawn waited for it;\n- abort during that wait stops the spawn;\n- a transient lookup failure still spawns, without the directory and with the warning;\n- a Codex session env carries the directory.\n\nOperator notes: run cli-loop / vendor-cli-env / sandbox tests and the static root policy tests. Update the hench changeset text if needed. No `process.env.NDX_*` writes in tests."
acceptanceCriteria:
  - "The vendor CLI session spawn waits (bounded by the lookup timeout, abortable) for the host identity and passes NDX_VALIDATION_SLOT_DIR; per-command spawns still never wait"
  - "Codex sessions get NDX_VALIDATION_SLOT_DIR too; a transient failure spawns without it and warns once"
  - "Tests cover the slow lookup, abort, transient failure and Codex cases; change 10fb002b is closed"
priority: "high"
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-3-runner-slot"
  - "review-fix"
source: "ndx-capture"
---
