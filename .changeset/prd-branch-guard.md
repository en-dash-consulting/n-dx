---
"@n-dx/rex": patch
"@n-dx/hench": patch
"@n-dx/web": patch
---

Refuse whole-tree PRD rewrites off the default branch without `--allow-on-branch`.

`reshape`, `reorganize`, `prune`, the `migrate-*` commands, and
`import-bundle --replace` each rewrite the entire `.rex/prd_tree/` in one
pass. Run on a feature branch, that rewrite has repeatedly ridden into `main`
inside an unrelated pull request. These commands now refuse to run off the
repository's default branch (the branch `origin/HEAD` names, else
`main`/`master`) unless `--allow-on-branch` is passed; the refusal names the
branch and the flag. Read-only previews (`--dry-run`, and `reorganize`
without `--accept`) still run anywhere. A tree with no resolvable git branch
(no repo, or git unavailable) is unaffected — the guard only fires on a real,
named feature branch.

`packages/rex/src/core/branch-guard.ts` is the shared guard, wired into each
of the six affected `cli/commands/*.ts` files. `hench`'s interactive
`migrate-slugs` offer and the dashboard's equivalent tree-conformance-gate
route both already gate the migration behind an explicit human confirmation,
so both now pass `--allow-on-branch` through to carry that consent — neither
flow's behavior changes.
