---
"@n-dx/lang-kit": patch
"@n-dx/lang-php": patch
"@n-dx/sourcevision": patch
---

With the PHP pack, `sv analyze` marks dynamic-code sites that run or dispatch on database data and names the tables and columns they read.

A site is database-driven when the code `eval` runs, or the callable `call_user_func`, `$f()`, `new $class` or `$obj->$method()` uses, comes from a query result: in the same function or top-level scope (`mysql_fetch_assoc`, `$wpdb->get_results`, `PDOStatement::fetch`, `db_query_range(…)->fetchAssoc()`, `foreach` over a result), or through repository functions and methods that return one, so Drupal 7's menu router dispatch from `menu_router` is found. Each such site lists its tables, `table.column` for a literal SELECT list (`SELECT *` gives the table alone) and the query calls the value comes from, in the new `[php-db-exec]` and `[php-db-dispatch]` notices. A parameter-fed site is never marked, and a flow the analysis cannot decide is left unmarked rather than guessed. Names and locations only, never row data.

The profile's optional `ecosystem.php.dynamicCode.database` counts those sites by kind, table and column; `readiness.json` carries it. The lang-kit `DynamicCodeFact` gains an optional `database`. WordPress's `get_var`, `get_row`, `get_col` and `get_results` now count as embedded-SQL calls. A repository without the PHP pack, or without such a site, writes the same files as before.
