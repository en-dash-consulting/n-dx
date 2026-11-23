---
id: "4f846759-1990-4f95-9e83-7139f04a9ec5"
type: "change"
title: "PHP ODBC connection string naming only a DSN= gives an unknown database target"
slug: "php-odbc-connection-string-naming-only"
summary: "When legacy PHP connects to a database through a named ODBC data source, the analysis records the connection without saying which data source, so shared databases across repositories are missed."
intent: "Verdict: should-fix (severity low). Found by the adversarial review of task 5f583e76 (run 5ab8edd7).\n\nDefect: packages/lang-php/src/php-outbound.ts, connectionTarget(): a `key=value` string's target is its host/server/hostaddr (with port), else unix_socket, else dbname, else unknown. An ODBC connection string that names a data source, `odbc_connect('DSN=LegacyHR;UID=u;PWD=p', ...)` or `new PDO('odbc:DSN=LegacyHR')`, has none of those keys, so the database outbound call is reported with target \"\" (unknown) although the DSN name is written out. A bare `odbc_connect('LegacyHR', ...)` already reports `LegacyHR`, so the two spellings of the same connection disagree.\n\nReachability: ndx analyze with the PHP pack on any repository using ODBC with a DSN= string (common in legacy Windows PHP talking to SQL Server or Access).\n\nOptions: (a) recommended: add `dsn` (and `data source`, which ADO-style strings use for the server) to the fallback chain after the host keys; one line plus a unit case. (b) leave as unknown (loses the shared-database signal the PHP consolidation work needs)."
acceptanceCriteria:
  - "connectionTarget('DSN=LegacyHR;UID=u;PWD=p', 'pairs') gives target 'LegacyHR' (literal), and 'odbc:DSN=LegacyHR' as a PDO DSN gives client pdo_odbc with target 'LegacyHR'"
  - "No credential key (UID, PWD, password, user) is ever chosen as a target, checked by a unit test"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "low"
discoveredFrom: {"item":"5f583e76-168b-40b6-b8a0-d42faa7e1fa3","run":"5ab8edd7-bd0e-4dbc-9154-e42849aaa59b"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "php"
  - "lang-php"
  - "outbound"
source: "ndx-adversarial-review"
---
