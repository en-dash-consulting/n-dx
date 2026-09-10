---
id: "810ab64b-174e-4a8c-83a5-0af8770f2c15"
level: "task"
title: "Run summary omits cache tokens, understating input ~65,000x"
status: "completed"
priority: "high"
startedAt: "2026-09-04T22:23:29.881Z"
completedAt: "2026-09-04T22:23:29.881Z"
endedAt: "2026-09-04T22:23:29.881Z"
acceptanceCriteria: []
description: "formatTokenReport (packages/hench/src/cli/token-logging.ts) printed only tokens_in and tokens_out. tokens_in counts uncached input only, so a measured 83-turn run reported 534 against 34.1M cache reads and 876K cache writes - a ~65,000x understatement that priced a ~24 dollar run near zero. Same defect class as the completed 'Token rollups and cost estimate exclude cache tokens' item, which fixed rex usage, hench show and the dashboard but missed the run-complete summary in hench run.ts:827. Fixed: cache_write/cache_read lines appended after tokens_out (never interleaved, so line offsets stay stable), the headline labelled (uncached), shared field width widened to the largest value, and getTokenAvailability no longer reports a cache-only run as missing data. show.ts's bespoke Cache line removed as now redundant."
lastModified: "2026-09-04T22:23:29.892Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
