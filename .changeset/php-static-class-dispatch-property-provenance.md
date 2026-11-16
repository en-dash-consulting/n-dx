---
"@n-dx/lang-php": patch
---

`ndx analyze` with the PHP pack now reports a static call on a class held in a variable, and no longer marks an object field as database-driven because a different field of the same object was.

`$class::run()` is now a dispatch site (construct `variable-static-class`), and it counts as database-driven when the class name comes from a query. This is the routing-table pattern, where a controller class is read from a row. Calls through `self::`, `static::`, `parent::` and `$this::` are still not reported.

Database provenance is now tracked separately for each element and property, one level deep (`$x->body`, `$a['k']`). Before, `$x->body = $row['body']; $x->handler = 'trim'; call_user_func($x->handler)` was reported as running code from `blocks.body`. Assigning a literal to a field now clears that field. A whole row assigned to a variable (`$obj = $row`) still carries its provenance to every element read from it. Writes through a key that is not a literal (`$items[$path] = $row`) still add provenance and never clear it, so Drupal 7's menu router dispatch is still found.
