---
id: "ab334ee0-fbb4-4aff-9718-daeed370457d"
level: "task"
title: "ndx ci architecture-policy gate fails on a clean main — four allowlist paths can never match"
status: "pending"
priority: "high"
acceptanceCriteria:
  - "The four packages/core allowlist entries are corrected to their repo-relative paths, or the comparison is normalized so both forms match"
  - "Every file that legitimately imports child_process is either allowlisted with a stated reason or refactored to spawn through win-spawn.js"
  - "ndx ci reports architecture policy green on a clean checkout of main"
  - "A test pins the ci.js allowlist against tests/e2e/architecture-policy.test.js so the two enforcement surfaces cannot diverge again"
  - "An allowlist entry whose path matches no file on disk is reported as a defect rather than silently ignored"
description: "CHILD_PROCESS_ALLOWED in packages/core/ci.js:938 lists the orchestration entry points as bare filenames - cli.js, ci.js, web.js, config.js - but checkArchitecturePolicy (ci.js:977) compares against relative(dir, full), which for those files is packages/core/cli.js and so on. Those four entries can never match, so the gate reports the spawn-only orchestration tier as violating the no-child_process rule. pr-check.js and packages/web/dev.js are at paths that do match, which is why they are not flagged. Separately, several files that legitimately spawn were never added to the list at all: packages/core/bin/{rex,hench,sourcevision}.js, win-spawn.js, git-preflight.js, cli-ink.js, assistant-integration.js, scripts/cli-smoke-parity.mjs, scripts/run-vitest-bind-aware.mjs, and the generated .claude/skills/iso-map/scripts/iso-map.mjs. Result: 20 violations and a failed pipeline on a clean checkout of main - verified by confirming every flagged file already imports child_process at origin/main. The equivalent tests/e2e/architecture-policy.test.js passes, so only the ci.js copy is broken and the two enforcement surfaces have diverged. Impact: CONTRIBUTING tells contributors to run 'ndx ci .' as the pre-push health gate, and that gate is red for everyone regardless of their change, which trains people to ignore it. GitHub Actions does not run ndx ci, so nothing else catches the drift."
lastModified: "2026-09-05T01:25:40.405Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
