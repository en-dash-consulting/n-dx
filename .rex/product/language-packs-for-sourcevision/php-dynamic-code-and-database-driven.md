---
id: "30dec248-87be-46ef-b244-8eff20c67026"
type: "capability"
title: "PHP dynamic code and database-driven dispatch"
slug: "php-dynamic-code-and-database-driven"
statement: "Sourcevision reports where PHP code runs strings as code or chooses what to run from a value, and marks the sites fed by database query results with the tables and columns they read, so routes and code stored in a database can be located without reading the data."
criteria: [{"id":"php-dynamic-sites","text":"Dynamic execution and dispatch sites are reported with location and kind, with per-repository counts in readiness"},{"id":"php-db-dispatch","text":"Sites fed by database query results are marked database-driven with their tables and literal columns"}]
---

## History

- 2026-11-16 ec248078-5c99-4dd6-b4a8-b7d4311313f6 added: Find dynamic code execution and database-driven dispatch in PHP
