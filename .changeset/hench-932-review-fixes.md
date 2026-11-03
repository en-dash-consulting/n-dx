---
"@n-dx/hench": patch
---

Close gaps in agent containment found in review:

- The path guard follows a dangling symbolic link to its target instead of treating it as a missing file, so a committed `notes.md -> ~/Library/LaunchAgents/x.plist` or `x -> .git/hooks/pre-commit` is refused. `write_file` and `edit_file` open with `O_NOFOLLOW` (an `lstat` refusal on Windows, which has no such flag), so a link that appears after the check is not written through.
- The commands hench starts from the repository after the agent's turn — the test gate, the post-task tests, the completion check's test command, a requirement's validation command and a cleanup batch's typecheck — run inside the same OS sandbox as `run_command`. `npm audit` and `npm outdated` stay unconfined: they need the registry and run no project code.
- The sandboxed Claude CLI gets `~/Library/Keychains` read-only rather than read-write. `securityd` still answers it and its Bash children, so a keychain item whose access list trusts `/usr/bin/security` remains readable; SECURITY.md says so.
- `hench.maxCostUsdPerRun` and `hench.maxCostUsdPerDay` are checked before every model request in the API, Gemini and local loops as well as before every CLI vendor spawn.
- A saved review setting can raise the review, never lower it: a saved `review` or `reviewMode` is honoured only when it reviews at least as hard as `hench.review.mode` (off < self < pair) and is otherwise ignored with a `saved-setting-widens` warning, and a saved `reviewOptional: true` relaxes only a review the task's own saved mode turned on.
