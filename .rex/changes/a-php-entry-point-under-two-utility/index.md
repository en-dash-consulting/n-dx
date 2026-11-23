---
id: "65c67435-23ed-42ed-85c7-aaaea00c1b14"
type: "change"
title: "A PHP entry point under two utility path segments is classified utility, not entrypoint"
slug: "a-php-entry-point-under-two-utility"
summary: "A command-line or cron PHP script whose folder path looks like a shared library (for example app/lib/core/) is still labelled a utility, so tools that treat entry points specially miss it."
intent: "Verdict: should-fix (low). Found by adversarial review of task 0971b4cc (PHP CLI and cron entry points).\n\nScenario: `app/lib/core/cleanup.php` is run by a repository `crontab`. The PHP pack's entryPoints fact becomes one `entrypoint` pack signal of weight 1 (`packages/sourcevision/src/analyzers/pack-framework-facts.ts`, ENTRY_POINT_WEIGHT). The utility archetype scores `/lib/` 0.6 + `/core/` 0.7 = 1.3 (`packages/sourcevision/src/analyzers/archetypes.ts`), so `classifyFile` (`packages/sourcevision/src/analyzers/classify.ts`) makes utility primary and entrypoint only secondary. Downstream readers of the primary archetype (`callgraph-findings.ts` isEntryPointFile, iso-map entry tile, zone naming) then miss the entry point.\n\nReachable: `ndx analyze` / `sv analyze` on a PHP repo with the pack, for a script under two utility-like directories. Rare.\n\nOptions: (a) treat pack signals as decisive: when a file has pack signals for an archetype, make it primary regardless of path scores (small change in classifyFile; risk: none for files without pack signals). (b) raise ENTRY_POINT_WEIGHT above the largest possible path sum (crude; couples to archetype table). Recommend (a)."
acceptanceCriteria:
  - "A file with an entrypoint pack signal whose path also scores above 1 for another archetype is classified with primary archetype entrypoint"
  - "A classify unit test covers app/lib/core/x.php with an entrypoint pack signal and fails on the current scoring"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "low"
discoveredFrom: {"item":"0971b4cc-4ea7-4af9-99ec-c4e14d1b90db","run":"949e8549-b4ec-4e88-8215-5445ce2a0fd0"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "php"
  - "sourcevision"
source: "ndx-adversarial-review"
---
