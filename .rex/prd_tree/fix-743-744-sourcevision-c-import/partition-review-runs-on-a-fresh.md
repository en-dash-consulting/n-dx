---
id: "19317f06-e9d6-4fb6-a1a9-e8ce8baa8dcb"
level: "task"
title: "Partition review runs on a fresh partition and flags a zone holding most of the files"
status: "completed"
priority: "high"
tags:
  - "sourcevision"
  - "zones"
source: "ndx-capture"
startedAt: "2026-10-15T02:22:50.452Z"
completedAt: "2026-10-15T02:24:41.218Z"
endedAt: "2026-10-15T02:24:41.218Z"
resolutionType: "code-change"
resolutionDetail: "Initial partition assessed; dominant-zone report"
acceptanceCriteria:
  - "An analysis with no previous zones.json records a partition health assessment in zones.partitionReview and manifest.lastAnalysis.partition."
  - "A zone holding more than half the analysed files is reported as oversized even when its sub-zones are balanced."
  - "Existing behaviour for runs with previous zones is unchanged apart from the oversized report."
description: "Retest of #743: one zone held 1,348 of 1,766 files (76%), and nothing reported it. `reviewPreviousPartition` in analyzers/zones.ts only runs when previous zones exist, so a run without zones.json leaves `manifest.lastAnalysis.partition` and `zones.partitionReview` null. Assess the health of the partition the run produced as well, and make the oversized check in `assessPartitionHealth` report a zone over ~50% of files even when `hasBalancedSubZones` lets it pass."
lastModified: "2026-10-15T02:24:41.515Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
