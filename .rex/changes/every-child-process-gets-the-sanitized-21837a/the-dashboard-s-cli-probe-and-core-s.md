---
id: "755f5f63-86fc-473e-b46e-cdd654ec894a"
type: "task"
title: "The dashboard's CLI probe and core's malformed-policy fallback keep the user's own env denies"
slug: "the-dashboard-s-cli-probe-and-core-s"
description: "Second short adversarial re-review of #816 + #817 (the 20 fix commits since abf90b308; two parallel passes, trust/config and child-env/spawn/backstop; fix/security-child-env at 9b60c492e), 2026-10-28, child-env pass finding 5 (low; read from the code).\n\nFailure scenario: packages/web/src/server/llm-catalog.ts calls resolveVendorCliEnv({ ...config, vendor }) with no envConfig, so the user's hench.guard.env.deny entries are ignored for the probe. In packages/core/config.js, loadVendorCheckEnv's fallback (~lines 2778-2781) uses only the defaults when compileEnvPolicy throws. A repository that sets hench.guard.env.allow to a non-array (7) makes it throw, which discards the deny entries the user put in .n-dx.local.json. That environment reaches the `ndx auth` preflight.\n\nFix: the web probe resolves the project env policy the way core does (the user's local deny, plus the trust-gated allow). The fallback drops only the malformed field, and keeps every valid deny array from the user's local config."
acceptanceCriteria:
  - "The dashboard's CLI probe applies the user's hench.guard.env.deny entries"
  - "A malformed repository guard.env field does not discard the user's own valid deny entries in core's fallback"
  - "Test: each path with a placeholder variable the user denies; the tests fail on the code before the fix"
priority: "low"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
