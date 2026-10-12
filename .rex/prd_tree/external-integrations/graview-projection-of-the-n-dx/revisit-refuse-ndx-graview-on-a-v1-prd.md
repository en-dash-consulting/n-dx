---
id: "692f21d3-5030-45ec-b49a-871cb0d800d8"
level: "task"
title: "Revisit: refuse ndx graview on a v1 PRD once n-dx's own tree has migrated"
status: "pending"
priority: "low"
tags:
  - "graview"
  - "migration"
source: "pr-review:#650"
acceptanceCriteria:
  - "After n-dx's own PRD is v2, ndx graview on a v1 tree writes nothing and exits non-zero with the migrate-first message unless graview.proposeProductLayer is true"
  - "The refusal names migration review once that exists"
description: "Ryan's decision on #650: the projection needs a v2 PRD; on a v1 tree every ndx graview command should write nothing and exit non-zero with \"ndx graview needs a v2 PRD, and this project's PRD is v1. Run ndx migrate --plan, review the plan, then apply it.\" The stack kept projecting v1 trees with the product layer rex's migration plan proposes (every node marked proposed, nothing written to rex), because n-dx's own checkout is v1 until PR 23 applies the migration and the face dogfoods on it. Revisit once n-dx has migrated: then refuse v1 by default, keep the proposed layer only behind graview.proposeProductLayer, and point the refusal at migration review."
lastModified: "2026-10-12T20:19:31.084Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
