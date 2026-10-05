---
id: "411b7aa8-8991-4d92-afc8-c51e872ba07b"
level: "task"
title: "run-resolve integration tests assume POSIX paths and quoting, failing CLI Smoke (Windows) on PR #503"
status: "pending"
priority: "high"
tags:
  - "0.9.0"
  - "task-prep"
  - "hench"
  - "windows"
  - "ci"
  - "tests"
source: "ci"
acceptanceCriteria:
  - "run-resolve.test.ts compares paths after normalising them, so it passes when git prints forward slashes and the code reports native Windows paths."
  - "The --context-file expectation uses platform-aware quoting (double quotes on win32)."
  - "No other test added by this feature compares a native path against raw `git rev-parse` output or hard-codes POSIX quoting."
description: "PR #503's CLI Smoke (Windows) fails in \"Run per-package tests\" (run 37342925484, job 111874253993) with three failures in packages/hench/tests/integration/run-resolve.test.ts. The implementation is right; the tests assume POSIX:\n1. :106 \"describes the task, the workspace and each setting with its source\": expects `workspace.root` to equal `git rev-parse --show-toplevel`, which on Windows prints forward slashes (`C:/Users/runneradmin/AppData/Local/Temp/hench-resolve-ek31l5`) while resolve reports the native path (`C:\\Users\\runneradmin\\...`).\n2. :390 \"refusals are reported, not thrown > claimed-elsewhere\": same mismatch for `task.claimedBy.worktree` against `git rev-parse` of the other worktree.\n3. :192 \"keeps the flags that change behaviour but are not options: --mine, --priority, --context-file\": hard-codes POSIX single quotes `--context-file='/tmp/notes with space.md'`; on win32 shellWord (packages/hench/src/cli/commands/run-resolve.ts) correctly double-quotes it.\n\nFix: normalise the git output with node:path `resolve()` (or compare realpaths) before comparing paths, and build the expected command with the same platform-aware quoting (call the exported shellWord, or branch on process.platform). Do not change run-resolve.ts behaviour. These were latent: the earlier Windows run stopped at the root e2e step before per-package tests ran. Also grep the other new tests from this feature (packages/hench/tests, packages/web/tests, tests/e2e) for `rev-parse --show-toplevel` comparisons or hard-coded `'…'` quoting that would fail the same way. Test-only change: no changeset needed.\n\n## How to run checks without approval prompts (operator note)\n\nCommands are only pre-approved when they START with `npx`, `node`, `npm`, `git` or `vitest`; never prefix one with `cd … &&`. From the project root: `npx vitest run --root packages/<pkg> [paths]`, `npx tsc -p packages/<pkg>/tsconfig.json --noEmit` (web also `-p packages/web/tsconfig.test.json`), and `npx vitest run tests/e2e tests/integration` for the root policy tests. e2e tests that spawn a CLI need that package's dist rebuilt: `npm run build --prefix packages/<pkg>`. Run a final check with `env -u NDX_CLI_PATH -u N_DX_CLI_PATH` cleared is not possible in the sandbox; note in the summary if a test depends on the environment."
lastModified: "2026-10-05T17:18:15.210Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
