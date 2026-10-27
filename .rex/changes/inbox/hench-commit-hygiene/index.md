---
id: "00c871e8-958f-4637-b5e8-72e1cb07979d"
type: "change"
title: "Hench commit hygiene"
slug: "hench-commit-hygiene"
intent: "When hench marks a task complete it commits PRD metadata by staging the whole .rex/prd_tree directory, which once swept a 1,378-file in-flight rename into a 'task completed' commit. The serializer already reports exactly which files it wrote and deleted. Make the completion commit stage that list, plus the tree metadata file, and nothing else, while keeping the existing behaviour for work the operator staged deliberately.\n\nGoal: A hench completion commit contains only the PRD files that the completion changed."
acceptanceCriteria:
  - "An unrelated dirty file under .rex/prd_tree/ is not included in a completion commit (integration test in the completion-metadata suite)."
  - "Existing pathspec behaviour for operator-staged work is retained."
  - "A real ndx work completion commit touches only the completed item's files and its parent's."
plannedRelease: "0.7.1"
priority: "medium"
tags:
  - "0.7.1"
  - "hench-commit-hygiene"
source: "caos work management: feature ndx 0.7.1 - Hench commit hygiene"
---
