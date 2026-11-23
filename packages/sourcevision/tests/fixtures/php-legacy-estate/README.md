# php-legacy-estate

An invented legacy PHP estate for `tests/e2e/cli-legacy-php-estate.test.ts`.
Every name, table, host and secret is made up.

- `tenant-copy/`: a PHP 5.4-style single-tenant copy of the invented
  "Hollowbrook ledger" app, with no Composer. It has:
  - an include chain four deep (`index.php` → `lib/bootstrap.inc` →
    `lib/db.inc` → `lib/ledger.inc` → `templates/ledger.phtml`);
  - a `custom/` override, included in place of its `lib/` file when present;
  - `mysql_*` calls with embedded SQL;
  - removed and deprecated constructs;
  - a short-tag template with an ASP-tag line;
  - a file with a syntax error;
  - secret-shaped values (`brk-*-pass`).
- `trunk/`: the PHP 8.1 line of the same app, with Composer PSR-4 autoloading
  and a committed `vendor/` holding one invented package.

The test writes the two non-UTF-8 files (latin-1 and invalid bytes) itself,
so no editor or checkout can rewrite their bytes.
