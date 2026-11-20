---
id: "ade83643-ab73-4d8b-8068-bc6e9f5bf2d8"
type: "change"
title: "A PHP DSN whose host comes from a variable reports its database name as the connection target"
slug: "a-php-dsn-whose-host-comes-from-a"
summary: "When legacy PHP builds a database connection string with the server name filled in from a variable, the analysis names the database instead of the server, so the map of which systems share a database server is wrong."
intent: "Verdict: out-of-scope (pre-existing; severity low). Found by the adversarial review of task 132dbb84 (P11, run 61220448).\n\nDefect: packages/lang-php/src/php-outbound.ts, TargetReader.connection(): when the computable text ends right after a host key but an earlier key gives a fallback, e.g. `new PDO('mysql:dbname=shop;host=' . $h)` or `pg_connect('dbname=warehouse host=' . getenv('PG_HOST'))`, connectionTarget() reads host as empty and falls back to dbname, so `parsed` is the literal `shop` / `warehouse`. The loop returns `parsed` whenever it is not unknown, so the open-host branch (which would give env `PG_HOST`, or unknown for `$h`) never runs. Result: target `shop` (literal) instead of the host's source. With the key order `host=` first (`'mysql:host=' . $h . ';dbname=shop'`) the same connection reports correctly, so the two spellings disagree.\n\nReachability: ndx analyze with the PHP pack on any repository that writes dbname before host in a concatenated or interpolated DSN.\n\nOptions: (a) recommended: in connection(), check openHostValue(written) === \"\" before accepting a literal `parsed`, and take the filling part's target (never literal) as the existing open-host branch does; a few lines plus a test. (b) leave: the dbname is a real fact but is labelled as the host target."
acceptanceCriteria:
  - "`new PDO('mysql:dbname=shop;host=' . getenv('DB_HOST'))` reports target DB_HOST (env), not shop (literal), checked by a test over invented code"
  - "`pg_connect('dbname=warehouse host=' . $h)` with $h not computable reports an unknown target, not warehouse (literal)"
  - "A DSN with no host key at all (`mysql:dbname=shop`) still reports its dbname as before"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "low"
discoveredFrom: {"item":"132dbb84-f95a-4c01-98e7-bb0fdfd395d6","run":"61220448-9386-4b4b-8923-e7345b00c3b4"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "php"
  - "lang-php"
  - "outbound"
source: "ndx-adversarial-review"
---
