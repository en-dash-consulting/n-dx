---
id: "f5d8c06e-1f67-4390-ab65-23b9799c6486"
level: "task"
title: "Run the v2 tree rules from rex health and pass structureHealth.maxCriteriaPerCapability to criteria-growth"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "rex"
  - "pr-11"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "rex health on a v2 tree with a capability over 15 own plus inherited criteria prints a warning naming it (test)"
  - "Setting rex.structureHealth.maxCriteriaPerCapability in .n-dx.json changes the threshold rex health uses (test)"
  - "A capability at or under the threshold produces no warning in rex health output (test)"
description: "checkV2Rules has no caller outside tests, so the criteria-growth warning never reaches `rex health`, and the configured threshold (rex.structureHealth.maxCriteriaPerCapability in .n-dx.json) is never read into RuleOptions.maxCriteria. The task that added the rule met its criteria at rule level only."
lastModified: "2026-10-08T00:30:08.149Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
