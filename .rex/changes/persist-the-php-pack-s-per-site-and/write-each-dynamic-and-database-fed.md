---
id: "e146caf5-d27d-48c2-9f6e-ade3dc48b511"
type: "task"
title: "Write each dynamic and database-fed PHP site, with include candidates and SQL names, to a versioned sites file"
slug: "write-each-dynamic-and-database-fed"
summary: "Save the location and details of every risky dynamic-code spot the PHP pack finds, instead of printing a few of them to the console."
description: "Add a pack fact for code sites through the lang-kit contract and have sourcevision write it to a new fact file (for example `sites.json`, registered in packages/sourcevision/src/schema/data-files.ts and typed in schema/v1.ts), keyed by pack id like legacy.json (follow analyzers/pack-legacy-files.ts: write nothing and remove a stale file when no pack reports sites). Per site: notice code (php-dynamic-include, php-host-include, php-dynamic-exec, php-dynamic-dispatch, php-db-exec, php-db-dispatch), file, line, column, construct; for includes, the resolver's candidate files capped at 50 with `truncated: true` and the total count past the cap (never a silent stop); for database-fed sites, the tables and `table.column` names (from php-database-flow.ts / php-sql.ts). Keep the console notices as they are. Sorted, canonical output with schemaVersion."
acceptanceCriteria:
  - "On a fixture with one dynamic include, one host include, one dynamic exec and one database-fed dispatch, the sites file lists all four with file and line matching the source"
  - "An include with more than 50 candidates lists 50, truncated: true and the total"
  - "The database-fed dispatch lists its table and table.column names and no row data or literal values"
  - "A repo with no PHP sites gets no sites file and a stale one is removed"
  - "The file carries schemaVersion and two runs give identical bytes"
priority: "medium"
tags:
  - "lang-php"
  - "lang-kit"
  - "sourcevision"
source: "ndx-capture"
blockedBy:
  - "7f4713b1-ab9e-4b67-bf59-19b5aa16284a"
---
