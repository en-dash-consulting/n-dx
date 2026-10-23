---
id: "400f7e1e-ab50-429d-917b-dc38aa41ff3a"
type: "change"
title: "Audit all ndx CLI commands against web dashboard feature coverage and document gaps"
slug: "audit-all-ndx-cli-commands-against-web"
intent: "Systematically compare every command in the ndx CLI dispatch (init, analyze, recommend, add, plan, work, self-heal, start, status, usage, sync, refresh, dev, ci, config, export, fix, health, validate, report, pair-programming, and rex/sourcevision/hench sub-commands) against what the web dashboard currently exposes — whether as a trigger, a status view, or a configuration panel. Produce a gap inventory with each command rated full/partial/none and ranked by user-facing impact to guide implementation order."
acceptanceCriteria:
  - "All ndx CLI commands and significant sub-commands are enumerated and evaluated"
  - "Each command is rated as full / partial / none dashboard coverage with a one-line rationale"
  - "Gap inventory is committed to the repo (e.g., docs/cli-ui-gap.md) or captured as PRD task descriptions"
  - "Gaps are ranked by user impact so the implementation task has a clear priority order"
touches:
  - "749cecdc-4d4c-4468-ae08-5e28e117996c"
priority: "high"
tags:
  - "web"
  - "cli"
  - "audit"
source: "smart-add"
---
