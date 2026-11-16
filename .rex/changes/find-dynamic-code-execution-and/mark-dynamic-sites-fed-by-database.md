---
id: "a5be0950-1068-442a-b018-ec76d52b5348"
type: "task"
title: "Mark dynamic sites fed by database query results, with their tables and columns"
slug: "mark-dynamic-sites-fed-by-database"
summary: "Trace database query results into the dynamic sites from the previous task, so the report says which tables and columns hold routes or stored code. That tells the migration exactly which rows to inspect."
description: "Builds on the previous task's sites and PR 6's database facts (`php-outbound.ts` database calls, `php-sql.ts` table names from literal SQL).\n\n**Sources.** A value is database-derived when it comes from any of these:\n- a fetch on a query result: `mysql_fetch_*`, `mysql_result`, `mysqli_fetch_*`, `mysqli_result::fetch_*`, `PDOStatement::fetch*`, `pg_fetch_*`, `oci_fetch_*`;\n- a direct result accessor on a known database client (`->fetchColumn`, `->fetchAll`, `->get_var` / `->get_row` / `->get_results` / `->get_col` on a variable that holds a database client);\n- a call to a repository function or method whose return value is database-derived. Compute these summaries across the repository by resolved name, iterating to a fixed point with a bound. Precedent for cross-file resolution: `php-resolver.ts`.\n\n**Flow.** Within one function, method or top-level scope:\n- assignment, array access (`$row['handler']`), `foreach` over a result, `list()` / `[...]` destructuring, string concatenation and interpolation;\n- parameters of the enclosing function are not sources.\nKeep it a simple forward pass. When a variable can't be decided, prefer missing a flow over guessing one.\n\n**Output.** Each execution or dispatch site fed by a database-derived value is reported as database-driven:\n- a notice code such as `php-db-dispatch` / `php-db-exec`;\n- the source position;\n- the tables and, when the SELECT list is literal, the columns. `SELECT handler FROM pages` gives `pages.handler`; `SELECT *` gives the table only.\n\nAdd database-driven counts to the per-repository `dynamicCode` field.\n\nFixtures, modelled on a custom app with WordPress-like patterns:\n- a `pages` table whose `handler` column is dispatched with `call_user_func`;\n- a `blocks.body` column passed to `eval`;\n- a router that loads a row in one function (`get_route($path)`) and dispatches it in another;\n- a parameter-fed eval, which must not be marked database-driven.\n\n**Operator note:** after the run, analyze the Drupal 7 corpus app with the worktree CLI and `--fast`, then reset its checkout (`git checkout -- .gitignore`, and clean `.sourcevision/`). Confirm and log with append_log:\n- `menu_execute_active_handler`'s `call_user_func_array` on the router item from `menu_get_item` (`menu_router`) is reported as database-driven;\n- `php_eval` is reported as an execution site.\nAlso log the database-driven and total site counts for osCommerce 2, WordPress and CodeIgniter 3."
acceptanceCriteria:
  - "Dispatch and execution sites fed by query results in the same scope, or through repository functions that return query results, are reported as database-driven with source position, tables and literal columns"
  - "Parameter-fed sites are not marked database-driven, and undecidable flows are not guessed"
  - "Drupal 7's menu_execute_active_handler dispatch from menu_router is reported as database-driven on the corpus app, and the corpus counts are logged"
  - "Non-PHP output and PHP output without the pack are byte-identical"
priority: "high"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "lang-php"
blockedBy:
  - "3ce7b963-e6e2-4593-a830-8cf46fcce425"
---
