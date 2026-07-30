---
id: "e76192c9-1aa4-43db-bb83-8b39cc25de84"
level: "task"
title: "Enforce the git-subcommand allowlist in CLI provider mode (default), not just API mode"
status: "completed"
priority: "high"
startedAt: "2026-07-14T20:50:53.364Z"
completedAt: "2026-07-14T21:59:41.744Z"
endedAt: "2026-07-14T21:59:41.744Z"
acceptanceCriteria: []
description: "guard.allowedGitSubcommands (default excludes reset/clean/revert/push) is only enforced in API provider mode via toolGit -> checkGitSubcommand. In CLI provider mode — the DEFAULT — the spawned Claude/Codex session is granted 'Bash(git:*)' by buildAllowedTools in packages/hench/src/agent/.../claude-cli-adapter.ts (lines ~58-61), which permits ALL git subcommands including reset/checkout/clean/revert. So an autonomous CLI-mode run can roll back the tree, gated only by Claude's --permission-mode (autonomous defaults to acceptEdits). Constrain the permissions the CLI adapter grants so destructive git subcommands are excluded when git is allowlisted, aligning CLI mode with the API-mode guard.\n\n## Acceptance Criteria\n- In CLI provider mode, the spawned session's git permission is scoped to guard.allowedGitSubcommands rather than a blanket Bash(git:*).\n- Destructive subcommands not on the allowlist (reset, clean, revert, push by default) are not auto-permitted; attempting them requires an express prompt / is denied under acceptEdits.\n- Non-destructive subcommands on the allowlist (status, add, commit, diff, log, branch, checkout, stash, show, rev-parse) continue to work without regression.\n- Behavior is identical for Claude and Codex CLI adapters (or the gap is documented per-adapter).\n- Regression/integration test asserts the generated allowed-tools list contains scoped git permissions and excludes reset/clean/revert."
---
