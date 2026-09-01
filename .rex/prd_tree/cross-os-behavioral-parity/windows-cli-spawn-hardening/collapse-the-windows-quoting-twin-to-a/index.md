---
id: "0994732e-03c6-4de8-86ef-2f200a2cbe35"
level: "task"
title: "Collapse the Windows quoting twin to a single implementation"
status: "completed"
priority: "high"
tags:
  - "windows"
  - "quoting"
  - "tech-debt"
  - "testing"
  - "llm-client"
  - "core"
source: "exploration-2026-08-17"
startedAt: "2026-08-19T03:38:50.189Z"
completedAt: "2026-08-19T03:38:50.189Z"
endedAt: "2026-08-19T03:38:50.189Z"
acceptanceCriteria:
  - "The parity guard cannot fail because of a stale build — only because the two implementations genuinely differ"
  - "A single documented decision on whether the twin stays duplicated or collapses to one shared module"
  - "If collapsed: exactly one copy of quoteWindowsToken/buildWindowsCliCommandLine exists in the monorepo and the spawn-only rule is still enforced (allowlist entry, not a silent exception)"
  - "No orchestration-tier file imports @n-dx/llm-client as a result of this work"
description: "`quoteWindowsToken` / `buildWindowsCliCommandLine` exist twice, byte-identical by convention (packages/llm-client/src/exec.ts canonical, packages/core/win-spawn.js twin), with tests/unit/windows-quoting-parity.test.js as the only guard. That guard just fired for real — but the divergence was NOT in the source: it was a stale `dist/`. The compiled dist still had the pre-`WINDOWS_BARE_BINARY_RE` builder (quoting the binary unconditionally), so the test reported `claude \"--print\" \"hi\"` vs `\"claude\" \"--print\" \"hi\"` and presented a source-vs-artifact skew as a package-vs-package divergence.\n\nThat is the tell: the duplication is not the fragile part — the *build-freshness coupling* is. The parity test reads one twin from source and the other from a compiled artifact, so any unbuilt change to exec.ts manufactures a false divergence.\n\nTwo independent moves, cheapest first: (1) remove the build from the equation by pointing the test at src (Vitest transforms TS directly); (2) optionally remove the duplication itself by hosting the pure function in a zero-dependency shared module. The spawn-only rule is what forced the duplication — orchestration (config.js, pair-programming.js) must not import @n-dx/llm-client — but that rule exists to keep orchestration from pulling in domain/foundation *logic*, and quoteWindowsToken is a pure string function with no imports.\n\nNOTE: the third option from the originating analysis — harden the Vitest globalSetup to check dist freshness rather than mere existence — is ALREADY IMPLEMENTED in tests/e2e/verify-build.js (hard error under CI, loud stderr warning locally, mtime walk skipping nested node_modules/dist). It is deliberately not filed here."
---

## Children

| Title | Status |
|-------|--------|
| [Extract quoteWindowsToken into a zero-dependency shared module (retire the twin)](./extract-quotewindowstoken-into-a-zero.md) | completed |
| [Repoint the Windows quoting parity test at src/exec.ts instead of dist/public.js](./repoint-the-windows-quoting-parity.md) | completed |
