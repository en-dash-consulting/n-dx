---
id: "3d9c9817-9690-4634-85b2-17730d9dad6e"
type: "task"
title: "Detail-panel assignee picker shows a failed save as saved"
slug: "detail-panel-assignee-picker-shows-a"
summary: "If saving an assignee fails, the detail panel still shows the new person as assigned and shows no error. This shows the failure and keeps the real value."
description: "Verdict: should-fix (severity medium), from the adversarial review of feat/assignee-picker-mine-filter.\n\nTaskDetail's onSave is onUpdate(item.id, {assignee}); handleItemUpdate (packages/web/src/viewer/hooks/use-prd-actions.ts:211-236) swallows a non-OK response (logs and refetches, never throws), so AssigneePicker runs setShown(value); the refetched item.assignee is unchanged, so useEffect([assignee]) never resets the label, and the picker's error alert never appears. Trigger: PATCH returns 400/409/500 (PRD lock held, item removed meanwhile) — the panel shows the new assignee until the user navigates away.\n\nEvidence: packages/web/src/viewer/components/prd-tree/task-detail.ts:1345-1354.\n\nFix (recommended): TaskDetail's onSave calls saveAssignee() (which throws the server's reason) and then refreshes through the existing onPrdChanged/refetch; leave handleItemUpdate alone (other callers)."
acceptanceCriteria:
  - "When the assignee PATCH fails in the detail panel, the picker shows the server's error and keeps showing the previous assignee"
  - "A test fails the PATCH and asserts the error and the unchanged label"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
