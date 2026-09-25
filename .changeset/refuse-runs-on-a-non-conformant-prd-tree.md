---
"@n-dx/rex": patch
"@n-dx/hench": patch
"@n-dx/web": patch
---

`ndx work` and the dashboard's Execute now refuse to start against a PRD tree written under a different slug rule, instead of discovering it at the completion write.

An autonomous run writes the PRD when it finishes its task, so a run started with a mismatched build does not fail — it succeeds, and carries a whole-tree re-slug into whatever branch is open under a "task completed" commit. The store's write guard refuses that write, but only after the run has claimed the task, spent its tokens and edited the code.

Both surfaces now ask the question first, through rex's new `checkTreeConformance`: the CLI refuses before taking a claim or writing anything (including on `--dry-run`, so a preview cannot report that the real run would have been fine), and `POST /api/hench/execute` answers 412 with the same message, which the viewer already surfaces on the run card. Unlike the write-time guard, a tree whose marker agrees is still path-scanned, so one whose paths were disturbed is refused too. There is no override flag: the fix is `rex migrate-slugs`, or upgrading rex when the tree was written by a newer rule. An interactive `ndx work` or the dashboard can offer to run the migration for you and then stop without executing the task.
