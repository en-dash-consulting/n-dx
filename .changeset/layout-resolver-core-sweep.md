---
"@n-dx/core": patch
"@n-dx/hench": patch
"@n-dx/llm-client": patch
"@n-dx/web": patch
---

Route core, and the rest of hench and web, through the layout resolver

Every remaining literal `.rex/`, `.hench/`, `.sourcevision/` and `.n-dx*` path
in the orchestration tier now asks `resolveLayout` where the project keeps its
state, as do the hench and web files the 0.8.0 sweep left behind. On a project
that has run `ndx migrate-layout`, these all used to read or write a path
nothing is there — silently, because a missing file is indistinguishable from
an empty project. Fixed as part of that:

- `ndx start stop` and `ndx start status` could not find a running dashboard on
  the new layout, and left it running.
- The staleness notice told a migrated project that all three of its tool
  directories were missing and that it should re-run `ndx init`.
- `ndx ci`, `ndx export` and `ndx refresh` looked for analysis output, the PRD
  tree and run records under the legacy names; the cross-vendor reviewer found
  no codebase context, no PRD excerpt and no configured test command.
- The guard baseline every hench run is clamped to blocked `.rex/**` and
  `.hench/**` only, so on the new layout the agent was free to write n-dx's own
  state, PRD tree included.
- The "Strict Safety" workflow template had drifted from that baseline in both
  copies, dropping half its credential patterns — choosing it left a project
  *less* protected than the default. Both copies now derive from the baseline.
- Hench classified PRD writes by file extension on the new layout, so run
  summaries reported bookkeeping as documentation changes.
- The note printed after a completion commit named a gitignore path the
  operator does not have, so following it left the tree dirty and the next run
  still refused to start.

New in `@n-dx/llm-client`: `layoutStateNames()`, for the classifiers that are
handed a path and must recognise n-dx state under either layout rather than
resolve one.
