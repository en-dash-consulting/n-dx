---
id: "d6748b32-ddd0-4b21-95f8-98acc18cf7e2"
type: "change"
title: "Trust copy"
slug: "trust-copy"
intent: "An outside first-use review could not tell what zone, archetype, enrichment pass or guard rail meant, watched progress counters go backwards, and did not know the Files page had skipped a language. Ship copy-only fixes: one glossary file rendered as definition lines under the fields and columns that use each term; Next Steps and Problems titles in plain language before the metric ('7 zones are fragile' before 'cohesion < 0.4, coupling > 0.6'); a strip on the Files page stating which languages were analysed, inventoried only, or skipped, with counts; monotonic CLI progress with retries printed on their own line as 'retry 2/3' so the counter never appears to move backwards.\n\nGoal: A first-time user can read every dashboard field and every progress line without asking what it means."
acceptanceCriteria:
  - "Every glossary term shown in the dashboard has a definition line where it appears."
  - "The Files page shows analysed, inventoried-only and skipped language counts on a project that contains at least one skipped language."
  - "No CLI progress counter decreases during a run; retries print as separate lines."
  - "No new route, view id or config key; --format=json output is unchanged."
plannedRelease: "0.7.1"
priority: "medium"
tags:
  - "0.7.1"
  - "trust-copy"
source: "caos work management: feature ndx 0.7.1 - Trust copy"
---
