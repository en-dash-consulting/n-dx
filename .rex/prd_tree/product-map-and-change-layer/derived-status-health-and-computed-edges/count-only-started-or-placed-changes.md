---
id: "bd27f348-30ef-4e76-b29a-38401ecb10ad"
level: "task"
title: "Count only started or placed changes as building, and let children follow an amended parent"
status: "in_progress"
priority: "high"
startedAt: "2026-10-08T04:34:55.849Z"
acceptanceCriteria: []
description: "Pre-freeze review findings 3, 6 and 11 (2026-10-07, Ryan), PR 11's domain part. Runs after PR 30 is merged into this branch (shared applied/open predicates, CheckResult changes).\n\n- Revised must be reachable. A direct product-layer edit drafts an open change that amends the node, which today makes the node read changing at once, so an untouched Inbox draft hides the revision. Only a change that is started (in_progress or later, not cancelled) or placed (needsPlacement not set) counts as building the edit; an unstarted change with needsPlacement leaves the node revised. The long-revised rule follows the same definition.\n- Children follow the parent. specHash covers the node's own spec only (decided in PR 30). When a capability is amended by an open, building change, its sub-capabilities read changing too.\n- Checks: ignore a CheckResult whose requirementId is not one of the node's current requirements when computing health and met; with more than one result per requirement, the latest at wins.\nTests for each point, including an untouched Inbox draft leaving the node revised.\n\nThe same run also does 2a940e6b: a retired node's health is ok, ignoring its stale checks and any open fix: true change that still targets it."
lastModified: "2026-10-08T04:34:56.104Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
