---
"@n-dx/rex": patch
---

Four rex correctness fixes:

- `rex usage` and the token budget preflight apply `rex.budget` from `.n-dx.json` (and from `.ndx/config.json` on the `.ndx/` layout). Before, `token-store` read the wrong directory and key, so the overrides were ignored.
- `computeLanding` takes the change rather than bare item ids, and an open change never reports as landed. `trailerIds`, exported from `public.ts`, now accepts any node with `id`, `aliases` and `children` (`Pick<RuleNode, "id" | "aliases" | "children">`). The widening is backward compatible.
- The v2 bundle export refusal names a child file the reader skipped as invalid, with its warning, instead of telling the operator to add a child back. The bundle format is unchanged.
- `FileStore` and `FolderTreeStore` save reports are project-relative on the `.ndx/` layout (`.ndx/rex/prd_tree/...`), so hench's completion commit stages the task's PRD edits instead of dropping them.
