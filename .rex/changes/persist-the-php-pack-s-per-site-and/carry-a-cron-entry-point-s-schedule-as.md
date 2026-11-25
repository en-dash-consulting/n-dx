---
id: "8d49a2a6-38c9-439e-85fb-536f6988090b"
type: "task"
title: "Carry a cron entry point's schedule as a structured field"
slug: "carry-a-cron-entry-point-s-schedule-as"
summary: "Save when each scheduled script runs as data, not buried in a sentence."
description: "php-entry-points.ts adds cron entry points with `schedule: job.schedule` (from php-cron.ts), but in the written analysis the schedule only appears inside a classifications.json evidence `detail` string. Add an optional structured field (for example `schedule` on the entry-point evidence, or on the file's entrypoint classification) to the schema in packages/sourcevision/src/schema/v1.ts, written as the crontab spells it, plus the crontab file and line it came from. CLI entry points get no schedule. Keep the detail text as it is."
acceptanceCriteria:
  - "A fixture with a crontab line `*/5 * * * * php /app/bin/sync.php` gives bin/sync.php an entrypoint classification whose structured schedule is `*/5 * * * *` with the crontab path and line"
  - "A PHP CLI script with no crontab line has no schedule"
  - "The evidence detail text is unchanged"
  - "Schema and validator accept the field and older files without it"
priority: "low"
tags:
  - "lang-php"
  - "sourcevision"
source: "ndx-capture"
---
