---
"@n-dx/hench": patch
"@n-dx/rex": patch
"@n-dx/web": patch
---

Stop refusing every task completion in a project on the `.ndx/` layout.

Hench's uncommitted-work gate refuses to mark a task completed while the work
that completes it is still in the working tree. The PRD writes hench makes
itself are supposed to be discounted — the agent's `rex_update_status` call and
hench's own completion write land in the PRD tree by design, so counting them
would refuse everything.

That discount list, and the staging list the completion commit derives from the
same definition, were spelled `.rex/...` and nothing else. On a project migrated
to the `.ndx/` container the PRD lives at `.ndx/rex/prd_tree/`, so:

- `prdPathsToStage` existence-checked a directory nothing writes to, found none,
  and the completion commit landed empty;
- the gate then refused the task over the very PRD writes it had just declined
  to stage, naming `.ndx/rex/prd_tree/<task>/index.md` back to the operator as
  the agent's leaked work.

Every task completion failed, in every project on the new layout, with a
refusal that pointed at hench's own files. Both lists now come from the layout
resolver: the staged set resolves the project's actual layout (a writer has to
pick one spelling), while the discount covers both, like
`HENCH_RUNTIME_GITIGNORE_ENTRIES` already did for `.hench/` — it is a classifier
answering "is this hench's own bookkeeping?" about a path git handed it.

Two adjacent paths had the same literal and are fixed with it:
`scopePrdPathsToReport` dropped every path in the store's save report, and the
changed-files/repaired-files filters treated nothing under `.ndx/` as
bookkeeping — so on a migrated project every run looked like it had changed
files and the full-suite gate fired for runs that produced no code.

Separately, the dashboard's derived `<rexDir>/.cache/prd.json` is now gitignored
by `rex init` and discounted by the gate. The `ndx start` watcher regenerates it
on every PRD write, so a run made while the dashboard was up had a regenerable
cache file counted as the task's own leaked work — on either layout. Its name is
now a single constant in rex's paths module (`PRD_CACHE_DIRNAME`) that the
gitignore rule, the gate and the web server all read, rather than a literal in
each.
