---
id: "adfd7ecb-74f8-400d-9a48-09dad42e9a48"
type: "change"
title: "PHP database flow misses values passed through explode(), object wrappers and dispatch helpers"
slug: "php-database-flow-misses-values-passed"
summary: "The database-driven report misses osCommerce's stored use_function and set_function code, because the value passes through a string split, an object copy or a helper function before it runs."
intent: "Seen on the PR 10 operator corpus check (2026-11-16, osCommerce 2, `sv analyze --fast`). osCommerce keeps code in its `configuration` table: `use_function` and `set_function`. The database flow (`packages/lang-php/src/php-database-flow.ts`) misses both, as task a5be0950 specified (\"prefer missing a flow over guessing one\"):\n- `catalog/admin/configuration.php:65`: `$use_function = $configuration['use_function']` (database-derived through `tep_db_fetch_array`), then `$class_method = explode('->', $use_function)`, then `new $class_method[0]()`. Values don't flow through `explode()`.\n- `catalog/admin/configuration.php:106`: `eval('$value_field = ' . $cInfo->set_function . ...)`, where `$cInfo = new objectInfo($configuration)` copies the row into properties. Values don't flow into a constructor and out of a property.\n- `tep_call_function($use_function, ...)` dispatches inside a repository helper on its parameter. A database-derived argument to a function whose parameter reaches a dispatch site is not traced.\n- The two osCommerce sites that are found name no table: `TABLE_*` constants are defined in both catalog/ and admin/, so the SQL is not literal.\nOptions: (1) let the value pass through a short allow-list of string built-ins (`explode`, `trim`, `strtolower`, `str_replace`, ...); (2) summarize repository functions whose parameter reaches a dispatch or exec site, and mark calls that pass database-derived arguments; (3) leave these to the private runtime trace. Decision for Ryan; relevant to the client estate."
acceptanceCriteria:
  - "osCommerce 2's configuration.php use_function and set_function sites are reported as database-driven, or the decision to leave them to the runtime trace is recorded"
priority: "low"
source: "operator-corpus-check"
---
