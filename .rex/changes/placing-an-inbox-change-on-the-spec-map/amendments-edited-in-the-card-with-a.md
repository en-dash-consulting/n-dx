---
id: "fe39744e-059c-46ec-ad96-a04ce74cd1e4"
type: "task"
title: "Amendments edited in the card with a live dry run"
slug: "amendments-edited-in-the-card-with-a"
description: "WF5. With Amends chosen, the card becomes the editor: summary, optional replacement statement, and the criteria with add, replace and remove. Each edit re-checks through L2's read-only POST /api/rex/changes/:id/placement/check (from #946); the card shows the same dry-run line as the Sidecar's placement card (\"applies cleanly against <target> @ spec <hash>\" or rex's refusal kind) and Place stays disabled until the check returns. The selected block shows the pending criteria count (for example 12 → 13). The server computes the check; the viewer recomputes nothing."
acceptanceCriteria:
  - "Editing the statement or criteria re-runs /placement/check and shows its dry-run line"
  - "Place is disabled while a check is in flight and when the check refuses"
  - "A refusal shows rex's own message and kind"
  - "The selected block shows the pending criteria count"
priority: "medium"
source: "ndx-capture"
blockedBy:
  - "263b50eb-5ebc-4606-a207-f1f57d4a4127"
---
