---
id: "470bef87-90da-4345-932c-74e386314499"
type: "task"
title: "Specs to tighten panel"
slug: "specs-to-tighten-panel"
description: "A new StagePanelId `spec-gaps` tile (6×1, beside Plan health on Plan's last row) reading the change rows' criteriaGap and openBlockers fields from S3: changes with no acceptance criteria, open tasks with none, changes waiting on a blocker and amendments awaiting review, each a count linking to Open changes filtered to it, rows at zero hidden. When the project has at least one structured requirement, a line for capabilities without one; until then one line: \"Nothing is marked ready: rex ready needs an automated requirement\", linking the Product page's Requirements tab. Empty state: \"Every open change has criteria.\""
acceptanceCriteria:
  - "The tile lists only non-zero gap counts, each linking to its filtered list"
  - "A project with no requirements shows the ready explanation line instead of a requirement coverage row"
  - "With no gaps the tile shows its empty state"
priority: "medium"
source: "ndx-capture"
---
