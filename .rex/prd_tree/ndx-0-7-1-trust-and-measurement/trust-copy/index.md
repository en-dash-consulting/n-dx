---
id: "d6748b32-ddd0-4b21-95f8-98acc18cf7e2"
level: "feature"
title: "Trust copy"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "trust-copy"
source: "caos work management: feature ndx 0.7.1 - Trust copy"
acceptanceCriteria:
  - "Every glossary term shown in the dashboard has a definition line where it appears."
  - "The Files page shows analysed, inventoried-only and skipped language counts on a project that contains at least one skipped language."
  - "No CLI progress counter decreases during a run; retries print as separate lines."
  - "No new route, view id or config key; --format=json output is unchanged."
description: "An outside first-use review could not tell what zone, archetype, enrichment pass or guard rail meant, watched progress counters go backwards, and did not know the Files page had skipped a language. Ship copy-only fixes: one glossary file rendered as definition lines under the fields and columns that use each term; Next Steps and Problems titles in plain language before the metric ('7 zones are fragile' before 'cohesion < 0.4, coupling > 0.6'); a strip on the Files page stating which languages were analysed, inventoried only, or skipped, with counts; monotonic CLI progress with retries printed on their own line as 'retry 2/3' so the counter never appears to move backwards.\n\nGoal: A first-time user can read every dashboard field and every progress line without asking what it means."
lastModified: "2026-09-21T17:24:07.117Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add a glossary source and render definition lines under the dashboard fields that use its terms](./add-a-glossary-source-and-render.md) | pending |
| [Lead Next Steps and Problems titles with plain language before the metric](./lead-next-steps-and-problems-titles.md) | pending |
| [Make CLI progress monotonic and print retries on their own line](./make-cli-progress-monotonic-and-print.md) | pending |
| [Print how to stop the server on the ndx start success block](./print-how-to-stop-the-server-on-the.md) | pending |
| [Show analysed, inventoried-only and skipped languages with counts on the Files page](./show-analysed-inventoried-only-and.md) | pending |
