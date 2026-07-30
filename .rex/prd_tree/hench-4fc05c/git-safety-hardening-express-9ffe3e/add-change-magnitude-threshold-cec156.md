---
id: "cec156b2-8d88-40fb-999b-89571208dfd6"
level: "task"
title: "Add change-magnitude threshold and config to the pre-run commit gate"
status: "completed"
priority: "medium"
startedAt: "2026-07-17T15:50:23.198Z"
completedAt: "2026-07-17T18:11:45.526Z"
endedAt: "2026-07-17T18:11:45.526Z"
resolutionType: "code-change"
resolutionDetail: "Pre-run commit gate now measures change magnitude (files + lines changed via git diff HEAD --numstat) with configurable hench.git.checkpointThreshold (default 200, 0 disables) and hench.git.requireCleanTree; --allow-dirty overrides config. New shared helper measureChangeMagnitude for future checkpoint sites. 36 unit tests cover quiet path, escalation, requireCleanTree, and flag-over-config precedence."
acceptanceCriteria: []
description: "The pre-run commit gate (performPreRunCommitGateIfNeeded in packages/hench/src/agent/lifecycle/shared.ts) fires on ANY dirty file (dirty.length >= 1) and counts files only — there is no notion of how BIG the uncommitted changes are, and the only override is the --allow-dirty CLI flag (no persistent config). Add a magnitude measure (e.g. total lines changed via 'git diff --numstat' and/or file count) and a configurable threshold so the gate can escalate (e.g. force a commit checkpoint, or refuse to proceed) when changes are large, while staying quiet for trivial dirty state. Expose the threshold as config in .n-dx.json / .hench/config.json (e.g. hench.git.checkpointThreshold, hench.git.requireCleanTree) rather than flag-only. Reuse this same size check anywhere a checkpoint decision is made (init baseline, pre-run gate).\n\n## Acceptance Criteria\n- Pre-run gate computes a change magnitude (lines changed and/or file count) from git, not just a non-empty dirty list.\n- A configurable threshold (persisted in .n-dx.json / .hench config, surfaced via ndx config with documented default) controls escalation; below threshold behavior is unchanged.\n- At/above threshold in interactive mode, the gate escalates (stronger prompt / defaults toward commit); autonomous mode behavior is explicit and documented (abort unless --allow-dirty, as today).\n- --allow-dirty continues to override; CLI flag takes precedence over config.\n- Help text and config surface document the new threshold and precedence.\n- Regression tests cover: below-threshold quiet path, at/above-threshold escalation, flag-overrides-config precedence."
---
