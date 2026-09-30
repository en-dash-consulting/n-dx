---
"@n-dx/web": patch
---

Home names the next command instead of showing dashes on a never-analysed
project. A next-step panel above the three stage cards reads one of four
states: not initialised (`{cli} init`), initialised but not analysed
(`{cli} analyze`), analysed with no PRD yet (`{cli} plan`), or a PRD present
(the next task's title and `{cli} work`). The command always names the
project's configured CLI, never a hardcoded `ndx`.

`/api/status` gains one boolean, `initialized` — reusing the same check
`routes-static.ts` already uses to gate the dashboard vs. the setup-wizard
landing page — because `sv.freshness`/`rex.exists`/`hench.configured` alone
can't tell a project `ndx init` never touched apart from one it has but
hasn't analysed: both read as `unavailable`/`false`/`false`.

`useProjectStatus` also now shape-checks the `/api/status` body once, in
`fetchStatus`, rather than trusting an unchecked cast. A body missing a
section, or carrying a malformed one (`rex.stats = {}`), is now discarded
wholesale — treated the same as a failed fetch — rather than rendered
piecemeal, which is what lets the next-step panel compute one of its four
states without also having to guard against a half-populated object.

A slot below the panel is reserved, empty, for the preflight card.
