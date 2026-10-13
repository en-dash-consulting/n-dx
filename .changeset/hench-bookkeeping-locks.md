---
"@n-dx/hench": patch
---

A rex lock held while a run ends no longer counts as the run's own work.

The blanket `.rex/` prefix that the bookkeeping list replaced covered
`prd.lock`, `prd.json.lock`, `reshape.lock` and `.backups/`. The list did not,
and `rex init` does not gitignore them either — it appends only
`n-dx_workflow.md`, `execution-log*.jsonl` and the derived cache. The lock and
backup patterns live in the `ndx.gitignore` block an operator pastes by hand,
so on a project that skipped that paste they are untracked and reach
`git status --porcelain --untracked-files=all`. A lock held while the
end-of-run snapshot was taken — the dashboard refreshing, an MCP write — read
as changed work and fired the full-suite gate on a run that had produced none.

`prd_tree/`, `.cache/` and `tree-meta.json` are no longer spelled by hand in
that list either: the rex gateway already re-exports all three, and a rename on
rex's side the list did not follow would have silently stopped discounting what
it names.
