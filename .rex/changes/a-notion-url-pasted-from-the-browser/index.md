---
id: "f0c6ea64-7a37-4826-bc2f-aff8bf813737"
type: "change"
title: "A Notion URL pasted from the browser reads back as no CAOS id, so its tracker move is refused and settled"
slug: "a-notion-url-pasted-from-the-browser"
intent: "Found by the adversarial review of 42a34384 (run 16a8b9d9). Verdict: should-fix. This is a gap the change left open, not a regression: before it, the whole URL was sent and refused the same way.\n\nScenario: an operator links a change by pasting the CAOS item's Notion URL from the browser, e.g. `https://www.notion.so/<workspace>/Some-Title-3b3a80b7192480f7b5fce8093ba5f7f0?pvs=4`. `trackerItemIdOfRef` (packages/web/src/server/tracker/server-profiles.ts) matches the template prefix `https://www.notion.so/`, takes everything after it, sees no bare 32-hex id, and returns `<workspace>/Some-Title-…?pvs=4`. `planTrackerEvent` (rules.ts) sends that as `workItemId`. CAOS refuses it, and a refusal settles the event (sync-engine.ts), so the run-started or pr-merged move is lost.\n\nReachable through the dashboard Link control and the Sidecar `propose_link` card.\n\nOptions:\n1. (Recommended) For `{compactId}`, read the id from the last path segment's trailing 32 hex characters, ignoring the query and the title slug. Small, local to `trackerItemIdOfRef`. Risk: a URL from another site that happens to end in 32 hex; the template's prefix check limits that.\n2. Normalise links at link time: when a pasted URL matches the template's host, rewrite it to the canonical built URL. Larger change; touches item-links.ts."
acceptanceCriteria:
  - "trackerItemIdOfRef on the CAOS mapping reads 3b3a80b7-1924-80f7-b5fc-e8093ba5f7f0 from https://www.notion.so/ws/Some-Title-3b3a80b7192480f7b5fce8093ba5f7f0?pvs=4"
  - "A run-started event whose ref is that browser URL plans a move_work_item with the dashed UUID as workItemId (unit test in rules or the sync-engine test)"
  - "A ref the template did not build is still returned unchanged"
touches:
  - "7df16224-db25-4a39-81d2-5c5c3904f4b9"
priority: "medium"
discoveredFrom: {"item":"42a34384-e328-4c95-8db3-0a96e385b874","run":"16a8b9d9-0ee8-42e5-b649-4e2f9602ea52"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
