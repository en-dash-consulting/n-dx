---
id: "516de95e-6983-4f90-98c4-da8d634b9ab2"
level: "task"
title: "Runs whose task left the PRD still reach a capability, through the archive and the tree's history"
status: "pending"
priority: "low"
tags:
  - "graview"
  - "evidence"
source: "notepad:graview-run"
acceptanceCriteria:
  - "A run whose task id is in the archive's merge actions lands for the surviving item"
  - "A run whose task id is in neither the tree nor the archive is resolved through the PRD tree as committed at the run's time to its then-parent feature, when that feature is still in the tree"
  - "The projection reports how many runs it re-tied and how many stay orphaned, and capability coverage on n-dx rises accordingly"
description: "From the graview run's notepad. 514 of 674 runs on n-dx name task ids that rex prune, reorganize and re-imports removed from the tree; .rex/archive.json holds only 35 of them, so 505 of 638 backfilled commits land for nothing and only 19 of 294 capabilities get files or zones. Map archived ids forward through the archive's merge actions, and resolve the rest from the committed tree's history (`git show <commit>:.rex/prd_tree`) to the feature the task sat under then."
lastModified: "2026-10-13T00:05:00.121Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
