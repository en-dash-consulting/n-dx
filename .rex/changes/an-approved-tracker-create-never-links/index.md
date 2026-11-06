---
id: "57bf05e3-a8f3-4d56-a411-244eb842492e"
type: "change"
title: "An approved tracker create never links the change to the work item it created"
slug: "an-approved-tracker-create-never-links"
intent: "Verdict out-of-scope (pre-existing in C2, high). executeTrackerCall (packages/web/src/server/tracker/sync-engine.ts) reads the created work item's id from the create reply, confirms it with the profile's read tool, and then discards it: decideTrackerCard records only the result. So approving a create card (Live's Tracker activity, or Plan's new Create in tracker) makes a work item in the tracker but leaves the rex change unlinked: no issues entry, so later move rules (run-started, pr-opened, pr-merged) skip the change (\"links to no work item\") and tracker sync stops at creation. SP8 now chips such a change as created (state from the log, no ref) so Create is not offered twice, but the link itself is missing. Fix: return the confirmed id from executeTrackerCall and, for a create, write it with changeItemLink (tracker/item-links.ts) in the same decision, recording it on the activity entry; cost one PRD write under the existing lock, risk a lock refusal that must leave the entry recorded and say the link failed."
acceptanceCriteria:
  - "Approving a create card whose call succeeds links the rex change to the created work item's key"
  - "A later run-started event for that change plans a move instead of skipping it"
  - "If the link write fails the activity entry still records the created item and names the link failure"
  - "A sync-engine test against the fake CAOS server covers the link-back"
touches:
  - "7df16224-db25-4a39-81d2-5c5c3904f4b9"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
