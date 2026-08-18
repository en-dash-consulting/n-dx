---
id: "868493c8-081f-4d99-8037-9ecf8e933c9d"
level: "feature"
title: "Fix verified code-review findings on dashboard command triggers"
status: "pending"
priority: "critical"
acceptanceCriteria: []
description: "Code review of the feature/add-new-dashboards-in-UI branch surfaced nine findings, all verified against the code on 2026-08-18. Three are blocking (reshape preview always reports no proposals; needs-llm false negative for projects without an explicit llm.vendor; progress UI never renders while jobs run because exec() buffers). The rest are correctness/polish on the same new command-trigger surface (resolveNdxBin non-monorepo failure, unsynchronized .sourcevision/ writers, ANSI strip regex missing the escape byte, manifest description/trigger mismatches, CI failure discarding its report, and an auth credential spawn on every settings mount)."
---

## Children

| Title | Status |
|-------|--------|
| [Cache the auth credential check; stop spawning ndx auth on every settings mount](./cache-the-auth-credential-check-e46feb.md) | pending |
| [Command manifest: treat absent llm.vendor as claude in hasLlmVendor](./command-manifest-treat-absent-29a2a7.md) | pending |
| [Fix ANSI strip regex in parseRefreshPhases: missing escape byte](./fix-ansi-strip-regex-in-f256f5.md) | pending |
| [Reconcile command manifest descriptions and triggers with actual endpoints](./reconcile-command-manifest-56a686.md) | pending |
| [Reshape trigger: spawn rex reshape with --quiet so stdout parses as JSON](./reshape-trigger-spawn-rex-032fba.md) | pending |
| [resolveNdxBin: resolve @n-dx/core from the server module graph before the dogfood path](./resolvendxbin-resolve-n-dx-core-44bea9.md) | pending |
| [Single shared lock for sv-analyze, refresh, and ci (.sourcevision writers)](./single-shared-lock-for-sv-7ac28a.md) | pending |
| [Stream job output incrementally via spawnManaged so progress UI renders while running](./stream-job-output-incrementally-35a6da.md) | pending |
| [Validation view: render CI report on failing exit instead of raw error banner](./validation-view-render-ci-08ca82.md) | pending |
