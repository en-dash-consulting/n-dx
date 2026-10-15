---
"@n-dx/rex": patch
"@n-dx/core": patch
---

`ndx migrate [dir]`, with neither `--plan` nor `--apply`, runs every migration step the project still needs, in order: the layout move into `.ndx/`, the `prd.md` / `prd.json` conversion to the folder tree, then `rex migrate-plan` (to `--out`, default `./migration-plan.json`) and `rex migrate-apply`. A step already done is skipped, so a failed run resumes where it stopped; `--dry-run` rehearses each step that can. rex commands on a v1 PRD (`prd_tree/` and no `product/`) keep working and print one deprecation line on stderr naming `ndx migrate` (not under `--quiet`; `NDX_LEGACY_NOTICE=off` silences it). `ndx ci`, `status`, `plan`, `add`, `recommend`, `refresh`, `work` and `analyze` print it once per command, not once per rex process they spawn.

Soft freeze: bare `ndx migrate` used to exit 1 asking for `--plan` or `--apply`; `--plan` and `--apply` are unchanged.
