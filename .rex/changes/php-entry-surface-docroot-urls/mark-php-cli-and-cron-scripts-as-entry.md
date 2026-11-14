---
id: "0971b4cc-4ea7-4af9-99ec-c4e14d1b90db"
type: "task"
title: "Mark PHP CLI and cron scripts as entry points"
slug: "mark-php-cli-and-cron-scripts-as-entry"
summary: "Find the PHP scripts that run from the command line or on a schedule, so they count as ways into the application alongside its web pages."
description: "In `@n-dx/lang-php` and through whatever entry-point mechanism sourcevision already uses for language configs (`entryPoints`) and inventory roles:\n\n- A `.php` file starting with a `#!/usr/bin/env php` or `#!/usr/bin/php` shebang is a CLI entry point.\n- Files under `bin/`, `cli/`, `cron/`, `scripts/` or `jobs/` that check `PHP_SAPI === 'cli'` / `php_sapi_name() == 'cli'` or read `$argv` are CLI entry points.\n- Files named in a crontab-like file in the repository (`crontab`, `*.cron`, `cron.d/*`, lines invoking `php path/to/file.php`) are cron entry points; record the schedule as written.\n- No new artifact: use existing fields. If none fits for the cron schedule, keep it in memory and say so in the code.\n\nFixtures: a shebang script, a `cron/` script with a `PHP_SAPI` check, and a `crontab` file."
acceptanceCriteria:
  - "Shebang PHP scripts and cli-checking scripts under bin/, cli/, cron/, scripts/ or jobs/ are marked as entry points"
  - "PHP files invoked from crontab files in the repository are marked as cron entry points"
  - "Non-PHP output is byte-identical"
priority: "medium"
run: {"tier":"standard","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":100}
tags:
  - "php"
  - "lang-php"
blockedBy:
  - "3a05f5ae-c70a-4380-af5d-2f0ff142d000"
---
