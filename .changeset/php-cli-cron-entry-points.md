---
"@n-dx/lang-php": patch
"@n-dx/sourcevision": patch
"@n-dx/lang-kit": patch
---

With the PHP pack, `classifications.json` now marks a legacy PHP application's command-line and cron scripts as entry points.

A script is a CLI entry point when it starts with a `#!/usr/bin/env php` or `#!/usr/bin/php` shebang, or when it sits under `bin/`, `cli/`, `cron/`, `scripts/` or `jobs/` and checks `PHP_SAPI` / `php_sapi_name()` against `'cli'` or reads `$argv`. A script that a `crontab`, `*.cron` or `cron.d/` file in the repository runs with `php` is a cron entry point. Each one is classified `entrypoint`, and its evidence says why: the shebang or check with its line, or the cron schedule as written with the crontab line. A crontab job whose script is not in the repository is reported as a notice. Without the PHP pack, `classifications.json` is unchanged.
