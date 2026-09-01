---
"@n-dx/hench": patch
---

Stop a failed auto-commit destroying the commit message and reporting success

When the auto-commit timer fired and `git commit -F` failed — a rejecting
pre-commit hook, a signing failure, a held `.git/index.lock` — the watcher
deleted `.hench-commit-msg.txt` anyway and carried on.

It was worse than a silent failure. `git commit` ran through `execStdout`,
which discards its error argument and always resolves, so the `catch` was
unreachable and `autoCommitted = true` ran regardless of the outcome.
`didAutoCommit()` then reported success to `performCommitPromptIfNeeded`,
which acknowledged an auto-commit that had never happened. The staged work
stayed uncommitted, the executor's authored message was gone, and the files
rode the next run's `git add -A` under an unrelated task.

The commit now runs through `exec`, so the exit code is actually observed, and
the message file is only discarded when it is provably useless:

| Outcome | Commit | Message file | `didAutoCommit()` |
|---|---|---|---|
| Commit succeeds | yes | removed | true |
| Empty / whitespace-only message | no | removed | false |
| Fails, "nothing to commit" | no | removed | false |
| Fails for any other reason | no | **kept** | false |

A real failure now emits an `info()`-level warning naming how many files are
left staged, instead of a `detail()` line that is easy to lose in a long run
log. Keeping the file is the recoverable direction — the pre-run commit gate
already handles a dirty tree with a message file present — and it leaves
`performCommitPromptIfNeeded` able to find and present the message rather than
returning at its `!existsSync` check.
