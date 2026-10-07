---
id: "e8f15eb8-b4e7-4467-a53e-84db583fac00"
level: "task"
title: "ZONES.md points at a \"Confirmed zone-level cycles\" section that exists in no file"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "documentation"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Every quoted section name in ZONES.md resolves to a heading that exists in the file it names"
  - "The web-viewer-search-overlay entry states the zone cycle it refers to, or links to where confirmed cycles are actually recorded"
description: "Pre-existing; surfaced by an adversarial review of commit 7e7ef5666 (task b88dba61), which retargeted the pointer from CLAUDE.md to the root AGENTS.md without noticing the section is missing from both. Verdict: out-of-scope for that change.\n\nScenario: ZONES.md:169 (the web-viewer-search-overlay zone entry) says the component \"participates in a confirmed zone-level cycle with web-viewer; see \\\"Confirmed zone-level cycles\\\" in the root AGENTS.md\". A search of every Markdown file in the repository finds that heading nowhere - it was presumably removed when zone metrics were taken out of the generated instruction files. A reader following the pointer finds nothing, and there is no record of which zone cycles are confirmed or accepted.\n\nReachable: anyone reading ZONES.md's zone-pin rationale.\n\nOptions:\n(a) Recommended. Find where the cycle list went (git log -S \"Confirmed zone-level cycles\"), and either restore the list in ZONES.md (repo-internal, so measured data is allowed there) or replace the pointer with the cycle itself and how architecture-policy.test.js treats it.\n(b) Delete the pointer sentence. Cheapest, but loses the rationale for the pin."
lastModified: "2026-10-06T23:18:00.286Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
