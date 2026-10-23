---
id: "868493c8-081f-4d99-8037-9ecf8e933c9d"
type: "change"
title: "Fix verified code-review findings on dashboard command triggers"
slug: "fix-verified-code-review-findings-on"
intent: "Code review of the feature/add-new-dashboards-in-UI branch surfaced nine findings, all verified against the code on 2026-08-18. Three are blocking (reshape preview always reports no proposals; needs-llm false negative for projects without an explicit llm.vendor; progress UI never renders while jobs run because exec() buffers). The rest are correctness/polish on the same new command-trigger surface (resolveNdxBin non-monorepo failure, unsynchronized .sourcevision/ writers, ANSI strip regex missing the escape byte, manifest description/trigger mismatches, CI failure discarding its report, and an auth credential spawn on every settings mount)."
priority: "critical"
---

Migration suggestion (text claude-opus-5-5, not accepted): place on "CLI Command Coverage Audit and Dashboard Trigger Controls" (749cecdc-4d4c-4468-ae08-5e28e117996c).
