---
id: "f3f909c2-38a4-441b-aa36-962eff326a92"
level: "subtask"
title: "Extract quoteWindowsToken into a zero-dependency shared module (retire the twin)"
status: "completed"
priority: "medium"
tags:
  - "windows"
  - "quoting"
  - "tech-debt"
  - "architecture"
  - "llm-client"
  - "core"
blockedBy:
  - "01d923cb-e8b0-49d1-bd33-9a57b1d4ec9e"
source: "exploration-2026-08-17"
startedAt: "2026-08-19T03:33:35.644Z"
completedAt: "2026-08-19T03:38:36.543Z"
endedAt: "2026-08-19T03:38:36.543Z"
acceptanceCriteria:
  - "An explicit written decision: extract to a shared module, or keep the twin with the source-side parity guard — with the reasoning recorded"
  - "IF EXTRACTED: exactly one copy of quoteWindowsToken/buildWindowsCliCommandLine/WINDOWS_BARE_BINARY_RE exists in the monorepo"
  - "IF EXTRACTED: the new package is foundation-tier with zero runtime dependencies and no imports from domain/execution/orchestration tiers"
  - "IF EXTRACTED: domain-isolation.test.js has a documented allowlist entry permitting the orchestration-tier import; the spawn-only rule is otherwise unchanged"
  - "IF EXTRACTED: the now-tautological parity test is deleted, not left in place, and CLAUDE.md's architecture tiers + package table are updated"
  - "IF NOT EXTRACTED: the 'update the twin' comments on both copies are verified present and accurate"
description: "OPTIONAL / DECIDE-THEN-DO. The originating analysis recommended doing the parity-test repoint now and considering this separately — file it so the decision is tracked, not so it is assumed.\n\nToday `quoteWindowsToken`, `buildWindowsCliCommandLine`, and `WINDOWS_BARE_BINARY_RE` are duplicated between packages/llm-client/src/exec.ts (canonical) and packages/core/win-spawn.js (twin), tied together only by \"update the twin\" comments and a parity test. The duplication exists because of the spawn-only rule: orchestration-tier files (config.js, pair-programming.js) must not import @n-dx/llm-client, enforced by tests/e2e/domain-isolation.test.js.\n\nThat rule exists to stop orchestration from pulling in domain/foundation LOGIC. These are pure string functions with zero imports, so hosting them in a tiny foundation-tier package (e.g. packages/win-quoting/) that BOTH sides import satisfies the rule's intent while removing the duplication. Note the rejected alternative: keeping win-spawn.js canonical and having llm-client import *up* into core inverts the tier hierarchy — do not do that.\n\nCost to weigh before committing: a new published package in a monorepo that already has 6; a domain-isolation.test.js allowlist entry (must be an explicit documented allowlist, not a silent exception); CLAUDE.md architecture-tier and package-table updates; and the parity test becomes obsolete and should be deleted rather than left asserting a tautology.\n\nCheaper alternative worth evaluating first: keep the twin and rely on the (already-repointed) source-to-source parity test plus the existing \"update the twin\" comments. If the parity test is build-independent and reliable, the duplication may simply not be worth a new package — record that decision explicitly either way so this does not get re-litigated."
---
