---
id: "8c2cd508-2e50-41a3-9350-8df138aec452"
type: "task"
title: "A non-string hench.claudePath override cannot hide the repository's claudePath from the trust review"
slug: "a-non-string-hench-claudepath-override"
description: "Second short adversarial re-review of #816 + #817 (the 20 fix commits since abf90b308; two parallel passes, trust/config and child-env/spawn/backstop; fix/security-child-env at 9b60c492e), 2026-10-28, trust pass finding 1 (high; probed against the built branch).\n\nFailure scenario: HENCH_FIELD_CHECKS (packages/llm-client/src/repo-trust.ts) has no claudePath entry, so foldHenchOverride keeps an invalid-typed override, and optionalString(merged.claudePath) returns null. hench's applyOverrideLayer (packages/hench/src/store/config.ts) validates claudePath as z.string().optional() and reverts it to the lower layer. Trigger: .hench/config.json sets \"claudePath\": \"/tmp/FAKE_evil_claude\", and .n-dx.json sets {\"hench\":{\"claudePath\":1}} (null, an object or an array work too). Probed: evaluateRepoTrust reports state baseline with no findings, and applyRepoTrust returns that claudePath unclamped. resolveVendorCliPath falls back to it when no cli_path is set. This is the c2f9fcd8 mask again, for a field c2f9fcd8 did not cover.\n\nFix: add claudePath to HENCH_FIELD_CHECKS as an optional string. Better still, add a test that walks every field collectRepoExecutionConfig reads from the hench section and asserts each has a field check whose validity agrees with hench's schema, so a new field cannot drift again."
acceptanceCriteria:
  - "An invalid-typed hench.claudePath override in .n-dx.json or a tracked .n-dx.local.json cannot make the review miss a lower layer's claudePath"
  - "Every hench-section field the trust review reads has a field check that agrees with hench's schema on what is valid (test)"
  - "Test: the probe's shape evaluates untrusted with a vendor-cli-path finding and is clamped; it fails on the code before the fix"
priority: "high"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
