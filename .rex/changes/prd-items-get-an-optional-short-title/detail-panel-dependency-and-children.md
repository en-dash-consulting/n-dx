---
id: "2485fa8e-44e4-4b98-9096-6e495e257a90"
type: "task"
title: "Detail panel dependency and children lists show summaries instead of titles"
slug: "detail-panel-dependency-and-children"
summary: "Two lists in the item detail panel started showing each item's one- or two-sentence summary instead of its name. This puts the short name or title back."
description: "Verdict: should-fix (severity low-medium, regression); user decision: these lists use short title → title, the row chain and the uniqueness rule stay as they are. From the adversarial review of feat/short-titles.\n\nDependencyList and ChildrenSummary used to render dep.title / child.title; they now call displayTitle (shortTitle → summary → title, impact-tags.ts:183), so a child or dependency with a summary and no short title shows its 1-2 sentence summary. Items from rex analyze usually carry a summary, so this is common. Contradicts the changeset ('as before') and acceptance criterion 3 ('fall back to the full title').\n\nEvidence: packages/web/src/viewer/components/prd-tree/task-detail.ts:268 and :345.\n\nFix: use a shortTitle → title helper (matching core/short-title.ts shownName) in those two lists, with the full title as tooltip."
acceptanceCriteria:
  - "The detail panel's dependency list shows each item's short title, else its title, never its summary"
  - "The detail panel's children list shows each item's short title, else its title, never its summary"
  - "A test renders both lists with an item that has a summary and no short title and asserts its title is shown"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
