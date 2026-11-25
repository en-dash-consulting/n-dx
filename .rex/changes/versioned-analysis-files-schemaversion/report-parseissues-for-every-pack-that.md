---
id: "6535016a-5b36-4c8a-a518-785882ab9263"
type: "task"
title: "Report parseIssues for every pack that ran, zero counts included"
slug: "report-parseissues-for-every-pack-that"
summary: "Make the analysis say \"every file parsed\" out loud, instead of saying nothing, so a reader can tell a clean result from a missing one."
description: "imports.json `summary.parseIssues` (ImportsSummary in packages/sourcevision/src/schema/v1.ts; written from analyzers/imports.ts and analyzers/pack-imports.ts) is omitted when every pack-parsed file parsed cleanly. Write an entry for every pack that ran, with zero counts and an empty file list when nothing failed, and no entry for a pack that did not run. Keep the field optional in the type for older analyses and update its doc comment: absent field means an older analysis; absent pack means the pack did not run; zero means it parsed every file."
acceptanceCriteria:
  - "An analysis of a fixture with one PHP file that parses gives parseIssues.php with zero counts"
  - "An analysis of a fixture with no PHP gives no php entry"
  - "A pack with a file that fails to parse still lists it as before"
  - "The ImportsSummary doc comment states the three readings (field absent, pack absent, zero)"
priority: "medium"
tags:
  - "sourcevision"
  - "schema"
  - "lang-packs"
source: "ndx-capture"
---
