---
"@n-dx/hench": patch
---

Stop reporting a refused timer-expiry auto-commit as a completed one. The commit-message watcher ran `git commit -F` through `execStdout`, which resolves even when git exits non-zero, so a rejected signing request, a failing pre-commit hook or a missing git identity printed "committed staged changes", set the flag that makes the normal commit prompt skip itself, and deleted the pending message file — leaving the run's work uncommitted with nothing reporting it, for the next task's commit to absorb. The commit is now checked: a refusal is reported as a refusal, the staged changes and the message file are left in place for the commit prompt to land, and `didAutoCommit()` stays false.

Checked git failures also name their cause when git reported it on stdout — where hook runners and signing helpers usually print it — instead of surfacing a bare "Command failed: git commit".
