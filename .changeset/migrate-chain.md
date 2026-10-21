---
"@n-dx/rex": patch
"@n-dx/core": patch
---

`ndx migrate [dir]`, with neither `--plan` nor `--apply`, runs every migration step the project still needs, in order: the layout move into `.ndx/`, the `prd.md` / `prd.json` conversion to the folder tree, then `rex migrate-plan` (to `--out`, default `./migration-plan.json`) and `rex migrate-apply`. A step already done is skipped, so a failed run resumes where it stopped; `--dry-run` rehearses each step that can.

rex commands on a v1 PRD (`prd_tree/` and no `product/`) keep working and print one deprecation line on stderr naming `ndx migrate`; the next release refuses v1 PRDs. The line is dropped under `--quiet`, and `NDX_LEGACY_NOTICE=off` silences it. `ndx ci`, `status`, `plan`, `add`, `recommend`, `refresh`, `work`, `analyze`, `self-heal`, `start`, `web` and `pair-programming` print it once per command, not once per rex process they spawn.

Agents are never told to migrate and cannot: every hench run that `ndx work`, `ndx self-heal` and `ndx pair-programming` spawn gets `NDX_AGENT_RUN=1` and `NDX_LEGACY_NOTICE=off`, and `ndx migrate` (bare, `--plan` and `--apply`) refuses while `NDX_AGENT_RUN` is set: an operator runs the migration from their own shell.

Soft freeze: bare `ndx migrate` used to exit 1 asking for `--plan`; it now runs the chain. `--plan` and `--apply` are unchanged. `NDX_LEGACY_NOTICE` (`off`) and `NDX_AGENT_RUN` are new environment variables read by rex and core.
