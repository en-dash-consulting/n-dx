---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
---

Enforce the git-subcommand allowlist in CLI provider mode. Previously only the
API-provider agent loop honored `guard.allowedGitSubcommands`; CLI-mode spawns
were granted a blanket `Bash(git:*)`, which auto-approved destructive
subcommands (`reset`, `clean`, `revert`, `push`). The Claude CLI adapter now
grants `git` at subcommand granularity (`Bash(git commit:*)`, …) drawn from the
guard allowlist, so destructive subcommands fall through to a permission prompt
(denied under a non-interactive `acceptEdits` spawn). Codex remains
sandbox-gated (no per-command allowlist). When no allowlist is present, `git`
keeps its legacy unscoped grant.
