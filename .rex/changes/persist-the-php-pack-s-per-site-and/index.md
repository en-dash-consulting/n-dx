---
id: "cb9f00d6-30d7-4397-a7e4-e9fcb6916aff"
type: "change"
title: "Persist the PHP pack's per-site and per-file facts: dynamic and database-fed sites, declared symbols, cron schedules"
slug: "persist-the-php-pack-s-per-site-and"
summary: "The PHP language pack finds risky dynamic code, the database tables that drive it, the classes each file declares and when scheduled scripts run, but most of that is only printed to the console or counted. Save it in the analysis so a reviewer can see where each site is and which page reaches it."
intent: "Reported by a downstream review of legacy PHP estates (checked against 0.10.5).\n\nWhat reaches the analysis today: histograms and counts, legacy.json (per-file version floor and legacy constructs with line and column, #1090), and `ecosystem.php.dynamicCode` in sdlc-profile.json / readiness.json (counts, kinds, and `database.tables` / `database.columns` name totals, #1081).\n\nWhat stays in memory or on the console only:\n- **Sites.** The coded notices php-dynamic-include, php-host-include, php-dynamic-exec, php-dynamic-dispatch, php-db-exec and php-db-dispatch are passed to warn() (at most five locations each). The site's file, line, construct, its dynamic-include candidates and the tables and `table.column` names a database-fed site reads are never written. A reviewer cannot tell which entry point reaches which site.\n- **Declared symbols.** php-symbols.ts reads each file's namespace and declarations, but no fact file lists what a PHP file declares; imports.json only shows symbols that something imports, so an unreferenced class is invisible. callgraph.json may hold it but can be very large.\n- **Cron schedules.** php-entry-points.ts records a cron entry point's `schedule`, but it reaches classifications.json only inside evidence detail text.\n\nRules: facts flow through the lang-kit pack contract, and sourcevision stays language-neutral (it writes what packs report, keyed by pack id). Names and positions only: never row data or literal values, and the existing credential redaction applies. Each new file carries schemaVersion (see the versioned analysis files change). Patch changesets for @n-dx/lang-php, @n-dx/lang-kit and @n-dx/sourcevision as touched."
acceptanceCriteria:
  - "Every dynamic and database-fed PHP site the pack detects is written to an analysis file with its code, file, line and construct"
  - "A database-fed site lists the tables and table.column names it reads"
  - "Each PHP file's namespace and declared classes, interfaces, traits and enums are written with their lines"
  - "A cron entry point carries its schedule as a structured field"
  - "Analysis output for repos without PHP does not change"
touches:
  - "30dec248-87be-46ef-b244-8eff20c67026"
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
  - "461f9855-cb81-4dd4-a457-7d58841a7502"
priority: "medium"
tags:
  - "lang-php"
  - "sourcevision"
  - "lang-packs"
source: "ndx-capture"
---
