---
"@n-dx/rex": patch
"@n-dx/hench": patch
"@n-dx/web": patch
---

Task selection now passes over tasks another worktree is working on.

`ndx work` claims its task before the pre-run gate and releases it on
completion, failure, or interrupt. `rex next` and the `get_next_task` MCP tool
skip tasks claimed by another worktree and report what they skipped (`rex next`
under `--verbose`), and the dashboard's execute route answers 409 naming the
worktree that holds the claim. Selection inside the worktree that owns a claim
is unaffected, so re-running after a crash still works, and behaviour outside a
git repository is unchanged.
