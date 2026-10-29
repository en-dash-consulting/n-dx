---
id: "c2f9fcd8-7c27-4696-8f18-86254046e278"
type: "task"
title: "An invalid-typed .n-dx.json override no longer hides a wide .hench/config.json guard from the trust review"
slug: "an-invalid-typed-n-dx-json-override-no"
description: "Whole-stack adversarial re-review of #816 + #817 (diff mode, origin/main...fix/security-child-env at abf90b308), 2026-10-28, finding B (critical, must-fix; reproduced on the built L2 head).\n\nFailure scenario: a repository ships a valid but wide .hench/config.json guard (curl and bash allowed, blockedPaths empty, git push allowed, env.allow naming a credential, permissionMode bypassPermissions) and a .n-dx.json whose hench section sets those same fields to values of the wrong type (allowedCommands: 0, allowedGitSubcommands: 0, env.allow: 0, permissionMode: 0) plus the baseline blockedPaths. The trust collector (packages/llm-client/src/repo-trust.ts:500-581) deep-merges the override, reads each non-array as empty (stringArray(...) ?? []), and reports no finding: state baseline, not restricted, so applyRepoTrust (packages/hench/src/store/trust.ts) returns the config unclamped. hench's loadConfig (packages/hench/src/store/config.ts:120-135) re-validates the merged override, finds the invalid fields, and revertInvalidFields restores them from .hench/config.json, so the run uses the wide guard. The same masking also stops the digest moving when .hench/config.json changes after acceptance.\n\nReproduced: with the mask, `state baseline | findings 0 | clamped false` and the effective guard allows curl with zero blocked paths; the control without .n-dx.json evaluates untrusted and clamps curl out.\n\nReachable: `ndx work` / `hench run` in any cloned checkout (run.ts → applyRepoTrust). Pre-existing on main (the collector's shallow read), but it defeats the trust gate this layer builds, so it is fixed here.\n\nOptions: (a) evaluate the config hench actually validated: applyRepoTrust computes its findings from the effective guard and permissionMode as well as the collector's view, so whatever runs is what is assessed. Cost: a second input to the evaluation; low risk. (b) The collector fails closed: a malformed execution field in an override becomes a warning finding (or falls back to the lower layer exactly as revertInvalidFields does, so both readers agree). Cost: one helper shared by both readers. Recommended: (b) with the fallback rule shared, so the evaluator and the loader cannot disagree again; (a) as a belt if cheap."
acceptanceCriteria:
  - "Closes #686 (finding 1, follow-up): the guard the trust review assesses is the guard hench runs, whatever the override files contain"
  - "An override field of the wrong type in .n-dx.json or a tracked .n-dx.local.json cannot make the evaluator read an execution field as empty while hench's loader restores it from .hench/config.json"
  - "Test: a wide .hench/config.json masked by an invalid-typed .n-dx.json evaluates untrusted (or changed after acceptance) and applyRepoTrust clamps it; the test fails on the code before the fix"
  - "Test: after acceptance, changing .hench/config.json under such a mask moves the digest and the checkout reads changed"
priority: "critical"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:critical"
source: "ndx-adversarial-review"
---
