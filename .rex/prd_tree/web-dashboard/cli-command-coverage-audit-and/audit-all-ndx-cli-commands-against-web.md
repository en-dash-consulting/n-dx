---
id: "400f7e1e-ab50-429d-917b-dc38aa41ff3a"
level: "task"
title: "Audit all ndx CLI commands against web dashboard feature coverage and document gaps"
status: "completed"
priority: "high"
tags:
  - "web"
  - "cli"
  - "audit"
source: "smart-add"
startedAt: "2026-04-19T03:35:57.566Z"
completedAt: "2026-04-19T03:39:08.521Z"
resolutionType: "code-change"
resolutionDetail: "Created docs/cli-ui-gap.md: 33 commands enumerated, rated full/partial/none, ranked by impact with implementation estimates."
acceptanceCriteria:
  - "All ndx CLI commands and significant sub-commands are enumerated and evaluated"
  - "Each command is rated as full / partial / none dashboard coverage with a one-line rationale"
  - "Gap inventory is committed to the repo (e.g., docs/cli-ui-gap.md) or captured as PRD task descriptions"
  - "Gaps are ranked by user impact so the implementation task has a clear priority order"
description: "Systematically compare every command in the ndx CLI dispatch (init, analyze, recommend, add, plan, work, self-heal, start, status, usage, sync, refresh, dev, ci, config, export, fix, health, validate, report, pair-programming, and rex/sourcevision/hench sub-commands) against what the web dashboard currently exposes — whether as a trigger, a status view, or a configuration panel. Produce a gap inventory with each command rated full/partial/none and ranked by user-facing impact to guide implementation order."
---
