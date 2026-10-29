---
id: "cd98987d-aaed-4775-b013-f8146d569837"
type: "task"
title: "ndx ci runs the repository's docs build with the sanitized repo-command environment"
slug: "ndx-ci-runs-the-repository-s-docs"
description: "Whole-stack adversarial re-review of #816 + #817 (diff mode, origin/main...fix/security-child-env at abf90b308), 2026-10-28, finding E2 (high, must-fix; pre-existing).\n\nFailure scenario: packages/core/ci.js:142 runs `pnpm docs:build` in the target directory with no env for any project that has .rex and .sourcevision. The script is the repository's own, so a cloned repository's docs:build receives every credential in the operator's shell. The spawn also has no row in tests/shell-spawn-inventory.md.\n\nProbed: a fake pnpm saw the fake credentials the probe exported.\n\nOption: pass `env: (await loadShellTestEnv(dir)).env` (core's route to repoCommandEnv), add the inventory row, and keep child-process-allowlist.json in step."
acceptanceCriteria:
  - "Closes #686 (finding 3, follow-up): ndx ci's docs build runs with the same sanitized environment as every other repository-owned command"
  - "core/ci.js passes the repo-command environment to the docs build spawn, and the spawn is listed in tests/shell-spawn-inventory.md"
  - "Test: a sentinel credential is not visible to a stub docs:build run by ndx ci; the test fails on the code before the fix"
priority: "high"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
