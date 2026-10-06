---
"@n-dx/hench": patch
---

Offer stash and discard at the dirty-tree gate, and prompt attended autonomous runs instead of refusing them.

A run that could not start because the working tree was dirty gave the operator three answers — commit, stop, proceed — so anyone who wanted the changes set aside or gone had to leave hench, deal with git, and start over. The gate now also offers `s[t]ash` (`git stash push -u` under the same generated message the commit option proposes) and `[d]iscard` (revert tracked edits, remove untracked files). `s` still means stop; stash is `t` and discard is `d`, so existing muscle memory cannot start a run that was meant to be aborted.

Discard asks a second time before removing anything, defaulting to No, and is never reachable by a bare Enter or a Ctrl-C. It is implemented as a stash that is immediately dropped, so the removed work — untracked files included — survives as a dangling commit whose sha is printed: `git stash store <sha>` then `git stash pop` brings it all back until git gc reaps it. Ignored files are never touched by either answer.

Autonomous runs (`--auto`/`--loop`/`--epic-by-epic`) used to abort outright on a dirty tree. On a TTY they now get the same prompt — it runs once, before the work loop starts, so it cannot stall an iteration — with the escalated default (commit) and an explicit `proceed` standing in for `--allow-dirty`. Without a TTY, with `--yes`, or with `--allow-dirty` already passed, the previous behaviour is unchanged.
