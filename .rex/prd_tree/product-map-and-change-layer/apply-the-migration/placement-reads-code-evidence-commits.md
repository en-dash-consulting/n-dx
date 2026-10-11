---
id: "11e34607-4eff-43e5-8328-bbc9f19aae37"
level: "task"
title: "Placement reads code evidence: commits and zones of a held change rank the capabilities realized in the same zones"
status: "pending"
priority: "medium"
tags:
  - "product-map"
  - "lane-migration"
  - "rex"
blockedBy:
  - "9df350f1-c56a-4520-a01e-e7e33b97e354"
source: "ndx-capture"
acceptanceCriteria:
  - "ClassifyOptions accepts filesOf(itemId) and classifyV1Tree passes a held change's files and each candidate's realized files (the files of its applied history) to rankPlacementCandidates"
  - "draftCapabilitySpecs receives codeFiles per capability from the same evidence when the caller supplies it"
  - "The adapter's proposed layer supplies the evidence from trailer and run commits; the Inbox count on this repository falls and the test asserts a change placed by file evidence that words alone would hold"
  - "Placement reasons name the file evidence that decided a placement"
description: "The placement engine already scores file evidence (PlacementChange.files against PlacementNode.realizedBy, WEIGHT_FILE_EVIDENCE) and the spec drafter takes codeFiles per capability, but classifyV1Tree never receives either, so the migration plan places 132 of this repository's changes by shared words alone and holds the rest in the Inbox. Once run records carry their commits and the adapter can roll commits through files to zones, the same evidence can reach the plan: ClassifyOptions gains an evidence hook (files per v1 item id) that the caller fills from trailer and run commits, place() passes a held change's files and a candidate node's realized files to rankPlacementCandidates, and draftCapabilitySpecs gets codeFiles the same way. Rex still shells out to nothing; the caller gathers the facts. The adapter is the first caller; the migration CLI the second. Fewer held changes on the review queue is the measure."
lastModified: "2026-10-11T03:34:07.296Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
