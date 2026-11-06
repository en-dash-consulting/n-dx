---
id: "2b4aa3de-2c1d-4ef7-b554-082334525f02"
type: "task"
title: "J/K in placement mode jump to the first Inbox change after a plain Place, not the one that followed"
slug: "j-k-in-placement-mode-jump-to-the"
description: "Verdict: should-fix (low). packages/web/src/viewer/views/placement-mode.ts useShortcuts -> neighbourChange(inbox.rows ids, changeId, delta). After a plain Place (or Propose) the change leaves inbox.rows, so neighbourChange sees index -1 and J opens others[0] (the first change) and K the last, rather than the change after or before the placed one's old slot. Scenario: Inbox [a, b, c, d], placing c with Place, then J opens a instead of d. The Inbox page avoids this by remembering the last index (inbox-triage.ts lastIndex). Fix: keep the change's last known index in placement mode (a ref updated while it is in the order) and step from it, as the Inbox page does; a small change with one test."
acceptanceCriteria:
  - "With Inbox [a, b, c, d], placing c with Place and then pressing J opens d in placement mode"
  - "Pressing K after the same Place opens b"
  - "A placement-mode test covers both"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
