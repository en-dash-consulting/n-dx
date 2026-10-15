---
id: "04e0520a-25d3-4ac9-be96-9552513bf52d"
level: "task"
title: "`ndx ci` restricted-import scan walks gitignored build output and agent worktrees, reporting false violations"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "With ci.restrictedImports configured, a gitignored build/ directory holding a compiled copy of an allowed file does not fail `ndx ci` (test)"
  - "A file under .claude/worktrees/<name>/ in a user project is not scanned (test)"
  - "An untracked, non-ignored source file that imports the module outside its allow list still fails the step (test)"
  - "The n-dx parity test in tests/e2e/architecture-policy.test.js still passes"
description: "Verdict: should-fix (from the adversarial review of c8fccd87).\n\nScenario: a project sets ci.restrictedImports [{ module: \"node:child_process\", allow: [\"src/lib/exec.ts\"] }], builds with tsc into build/ (or has .next/, out/, coverage/, or Claude agent worktrees under .claude/worktrees/<name>/). `ndx ci` then reports build/lib/exec.js, or .claude/worktrees/x/src/lib/exec.ts, as a violation, because the path is not on the allow list. The source is fine.\n\nEvidence: packages/core/ci.js scanRestrictedImports skips only sourceScanSkipDirs() (node_modules, dist, .git, n-dx state dirs) plus each rule's excludeDirs. Only n-dx's own allowlist rule supplies excludeDirs (.claude/worktrees, .local_testing). A configured rule has none.\n\nReachable: `ndx ci` on any opted-in project after a local build, or with agent worktrees present. CI checkouts that run `ndx ci` before a build are unaffected.\n\nOptions:\n1. List files with `git ls-files --cached --others --exclude-standard`, falling back to the walk outside git. This matches what is committed and costs one spawn. ci.js already spawns. Recommended.\n2. Hard-code more skip dirs (build, out, .next, coverage, .claude/worktrees). Cheap, but the list never finishes.\n3. Add an `exclude` key to a rule. This widens the config shape the task asked to keep small.\n\nOperator note (overnight 2026-10-15): Do NOT edit packages/core/cli.js, help.js or command-effects.js, README.md, docs/guide/commands.md, docs/cli-ui-gap.md or tests/setup-session-env.js: another session owns them tonight. If the fix needs one, stop and say so in your summary. Each new test must fail on the code before your change; say how you checked. Run the six static root policy tests before committing. Do not add a changeset. Never use pnpm. Take option 1 (git ls-files --cached --others --exclude-standard, falling back to the walk outside a git repository). Register any new spawn in tests/shell-spawn-inventory.md if the policy requires it, and keep the n-dx parity test meaningful."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T07:02:04.151Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
