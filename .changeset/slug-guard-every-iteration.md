---
"@n-dx/hench": patch
---

Re-check the PRD tree's slug rule before every task in a run, not only the first.

A single check before the first task is not enough. A long `--loop`,
`--iterations` or `--epic-by-epic` run outlives that answer — another worktree
writes the tree, an operator pulls, a migration lands — and from the second task
onward the run would be working against a tree nobody had asked about again, with
its own completion write re-slugging whatever had drifted: the run would become
the sweeper the guard exists to prevent.

The check runs at the top of `runOne`, the single funnel every execution mode
passes through, so all three modes are covered by construction — including the
first task. The pre-flight check before `--reset-deferred` stays, because that is
the run's first PRD write, but the first task does not treat it as its own
answer: the commit gate in between blocks on an operator prompt, so an attended
run could otherwise start task one against a tree verified an arbitrarily long
time earlier. A run now parses the tree once per task, at roughly 0.33s on a
405-item tree.
