---
id: "70eb342f-9637-4ced-a11f-8d4b04febfea"
type: "change"
title: "Dashboard file watchers have no 'error' listener, so a watcher error crashes ndx start"
slug: "dashboard-file-watchers-have-no-error"
intent: "Verdict: out-of-scope (pre-existing; found while reviewing aeac2c3a). In packages/web/src/server/start.ts, registerSourcevisionWatcher, registerRexWatcher, registerHenchWatcher and registerDevViewerWatcher each call fs.watch inside try/catch, but none attaches an 'error' listener to the FSWatcher it returns. try/catch only covers a synchronous throw from watch(). An FSWatcher that later emits 'error' with no listener throws an uncaught exception that takes down the server. Known trigger: on Windows, deleting a watched directory emits EPERM (nodejs/node#4337). Example: `git checkout` of a branch without .rex/changes/ while `ndx start` is serving. Not reproduced here (macOS). Reachability: Windows users switching branches or removing a PRD folder while the dashboard runs.\n\nOptions: (a, recommended) attach `w.on(\"error\", …)` in each register* helper. It logs a warning, closes the watcher and drops it from the handle list. For the rex PRD folders it also clears the entry so the folder can be re-watched (see task fea3f678). Cost: small, plus a unit test that emits 'error' on a returned watcher and asserts the process survives. (b) A process-level uncaughtException guard. Rejected, because it hides unrelated faults.\n\nOperator notes (2026-10-14, v2 hardening 4/5): packages/web only, except the criteria's tests. Hal's draft #742 edits packages/web/src/server/routes-live*.ts, routes-worktrees.ts, the hub proxy and the Live viewer files; stay out of them. Do not edit packages/rex/tests/unit/schema/v2.test.ts. Add a changeset (patch, @n-dx/web). Run the six static root policy tests before finishing: tests/e2e/architecture-policy, domain-isolation, shell-spawn-inventory-policy, wall-clock-inventory-policy, layout-literal-policy and obfuscated-code-policy."
acceptanceCriteria:
  - "Every FSWatcher created by start.ts's register* watcher helpers has an 'error' listener"
  - "A test that emits 'error' on a watcher returned by registerRexWatcher does not throw, and the watcher is closed"
touches:
  - "7a93b80b-7460-40c3-975d-5fd555ef4264"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "web"
  - "v2-hardening"
source: "ndx-adversarial-review"
---
