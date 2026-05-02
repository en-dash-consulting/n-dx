---
id: "9aaa6f12-199e-4737-9b0e-737a76ed23fc"
level: "feature"
title: "Suppress DEP0040 punycode Deprecation Warning in CLI Output"
status: "completed"
source: "smart-add"
startedAt: "2026-04-08T15:36:34.920Z"
completedAt: "2026-04-08T15:36:34.920Z"
acceptanceCriteria: []
description: "The CLI emits a noisy Node.js deprecation warning (DEP0040) about the built-in punycode module on every invocation. This clutters output and degrades the CLI's professional appearance. The fix involves tracing which dependency introduces punycode, updating or replacing it, and adding a fallback suppression at the CLI entry point if the transitive source cannot be cleanly replaced."
---

## Children

| Title | Status |
|-------|--------|
| [Add CLI startup deprecation filter as a belt-and-suspenders guard](./add-cli-startup-deprecation-81c349/index.md) | completed |
| [Trace and eliminate the DEP0040 punycode deprecation source](./trace-and-eliminate-the-dep0040-1a926c/index.md) | completed |
