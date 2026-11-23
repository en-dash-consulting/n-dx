---
"@n-dx/lang-php": patch
---

With the PHP pack, `sv analyze` writes `config.json`, which lists feature-flag checks with the lines each one gates, and records where code reads configuration.

Flag checks: flag-like or boolean constants and `defined()` checks, `$config['features'][…]` and registry reads (`Config::get`, CodeIgniter's `$this->config->item`), `getenv`/`$_ENV` flags, flag helper calls, and LaunchDarkly, Unleash and Flagsmith SDK calls. Config reads: settings files (`return [ … ]`, `$config[…] =`) and the files that include them and read their keys, `parse_ini_file`/YAML/XML loads, `define()` constants in settings files and each place they are read, and the per-tenant files an include chooses by the request's host name. Keys, names, files and positions only, never a value. Repositories without the PHP pack get no `config.json`.
