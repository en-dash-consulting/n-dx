---
id: "960d95c7-a802-44c4-9157-9dd88972f23c"
type: "task"
title: "Move visual covers only the Ask panel, not the Reorganize panel"
slug: "move-visual-covers-only-the-ask-panel"
summary: "The new before-and-after picture for moving an item appears in one place but not in the Reorganize panel, the other place moves are proposed. This narrows this change to what it covers and tracks the Reorganize panel separately."
description: "Verdict: should-fix (severity medium); user decision: descope here and track the Reorganize visual as its own follow-up change. From the adversarial review of feat/placement-visuals (571877412).\n\nAcceptance criterion 4 ('Moving or reparenting an item shows the same kind of source-to-target visual') is only partly met. The rex dashboard's Quick Actions → Reorganize panel (rex-dashboard.ts:752; components/prd-tree/reorganize-panel.ts:189-245, unchanged) lists structural move and LLM reparent proposals as icon, description and 'Affects: …' with 'Apply Selected (N)', with no source → target picture and no named action. Only the Ask panel's reparent card got the visual. The PRD tree has no other move control.\n\nFix here: reword criterion 4 on this change to 'the Ask panel's reparent proposals show the same kind of source-to-target visual' and note the Reorganize follow-up; drawing movePreview in Reorganize cards needs the server to add from/to parent titles to structural move proposals and is tracked separately."
acceptanceCriteria:
  - "Change 6a4b1ece's acceptance criterion 4 names the Ask panel's reparent proposals rather than every move surface"
  - "The change's intent points to the follow-up change for the Reorganize panel"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
