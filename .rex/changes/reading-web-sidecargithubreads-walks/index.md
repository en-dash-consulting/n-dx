---
id: "8f66583f-8954-41f8-a4c3-9355ade22dfa"
type: "change"
title: "Reading web.sidecarGithubReads walks the whole PRD tree and spawns git on every branch-health request"
slug: "reading-web-sidecargithubreads-walks"
intent: "Found by the adversarial review of c7e09da1 (run d0f7df28). Verdict: should-fix, low.\n\nWhen the shared `.n-dx.json` sets `web.sidecarGithubReads: true`, `resolveGithubReads` (packages/web/src/server/sidecar/settings.ts) calls `evaluateRepoTrust(projectDir)` on every read. That function also runs `collectRepoInventory`, which walks every folder under `.rex/product`, `.rex/changes` and `.rex/prd_tree` and lists `.hench/runs`, all synchronously. It also spawns git through `isLocalConfigTracked`. Only the trust state is needed.\n\nReachable: `GET /api/branch-health` (once per Workspaces card on mount, and again when a strip is expanded), `GET /api/sidecar/settings`, every `github_read` and every Diagnose branch packet. A board of N worktrees in a trusted checkout with the key in shared config runs N synchronous PRD walks on the server's event loop.\n\nOptions: (A, recommended) export a state-only check from llm-client (e.g. `repoTrustStateOf(projectDir)` = collectRepoExecutionConfig + assess + readRepoTrustRecord + repoTrustState, as `gateConfig` in credential-routing.ts already does) and call it from `resolveGithubReads`. Small, no behaviour change. (B) cache the evaluation per request burst. More state, risk of serving a stale trust decision after `ndx trust accept`."
acceptanceCriteria:
  - "resolveGithubReads decides trust without running collectRepoInventory (a test spying on the inventory walk sees no call)"
  - "The trusted and untrusted outcomes of web.sidecarGithubReads are unchanged (existing sidecar-settings and sidecar-carry-out tests still pass)"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "low"
discoveredFrom: {"item":"c7e09da1-bd76-435f-93f8-f13954089029","run":"d0f7df28-aebb-4f35-8777-89ec66b1dd55"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "performance"
source: "ndx-adversarial-review"
---
