---
id: "43945df9-5aae-4bf6-a818-61ddc5cb259f"
type: "task"
title: "Placement search and propose areas say \"Loading…\" forever when the product map read fails"
slug: "placement-search-and-propose-areas-say"
description: "Verdict: should-fix (low), found by adversarial review of 083b030f (commit ed47745dc).\n\nScenario: an Inbox change's detail panel is open and GET /api/rex/product fails (a 500, or a read that lands while the PRD lock is held and has no earlier good read). PlacementForms in packages/web/src/viewer/components/prd-tree/change-placement.ts maps every non-ready load to `map = null`, so the search input stays disabled with the placeholder \"Loading the product map…\" and the proposal form's area select shows \"Loading…\". Neither ever shows the error, and Propose stays disabled because no area can be chosen. The person sees a hang and cannot tell that a retry or reload is needed.\n\nReachability: ndx start + Tasks, open an Inbox change while /api/rex/product errors. Edge path; the shortlist and Place still work.\n\nOptions:\n1. (Recommended) Pass the Load state down. On `error`, render the shared `Pending` or `StaleNotice` text (\"Could not load: …\") in place of the search and area list. Cost: a few lines plus one test; risk: none.\n2. Keep the placeholders and add an error line under the search only. Cheaper, but the propose form still hangs."
acceptanceCriteria:
  - "When GET /api/rex/product answers an error, the placement section shows the error message instead of \"Loading the product map…\" (asserted in change-placement.test.ts)"
  - "When the product map read fails, the proposal form's area field shows the error instead of \"Loading…\""
  - "A later successful read restores the search and the area list"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "inbox-placement"
  - "web"
source: "ndx-adversarial-review"
---
