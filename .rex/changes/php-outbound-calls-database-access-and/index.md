---
id: "38abed61-45be-4181-a45c-5652878ad43c"
type: "change"
title: "PHP outbound calls, database access and embedded SQL"
slug: "php-outbound-calls-database-access-and"
summary: "Find where PHP code talks to other systems: HTTP calls, SOAP services, databases and caches, plus the environment variables it reads and the database tables its SQL touches. This shows which legacy repositories share data and services before they are merged."
intent: "PR 6 of the PHP language-pack stack, stacked on PR 5. The pack produces `outboundCalls` facts (existing kinds http, database, cache, env; packages/lang-kit/src/pack-contract.ts `OutboundCallFact`) that sourcevision writes to outbound.json, and hands embedded SQL string literals to lang-kit's SQL reference extractor (packages/lang-kit/src/sql-references.ts) so table names join the existing in-memory database signals.\n\nLane rules (PHP pack; decisions made 2026-11-12):\n- Use only the existing OutboundCallFact kinds; do not add kinds in this change.\n- Analyze output stays byte-identical for every repository without PHP files, and for PHP repositories without the pack.\n- Agents cannot use the network, run `pnpm install`, read `~/.cache`, or write under `.claude/`. The operator does those steps.\n- Record measurements with append_log on the task.\n- Patch changesets with scoped package names.\n- Before finishing, run the six static root policy tests: tests/e2e/architecture-policy.test.js, domain-isolation.test.js, shell-spawn-inventory-policy.test.js, wall-clock-inventory-policy.test.js, layout-literal-policy.test.js, obfuscated-code-policy.test.js."
acceptanceCriteria:
  - "curl, file_get_contents/fopen on http(s) literals, SoapClient and Guzzle calls appear in outbound.json for PHP repositories with the pack"
  - "mysql_*, mysqli, PDO and similar database access appears as database outbound calls, and embedded SQL yields table names"
  - "getenv, $_ENV and non-request $_SERVER reads appear as env outbound calls"
amends: [{"target":"f49c3876-4fb7-45a0-8619-86b1cda30748","delta":"added","summary":"PHP outbound calls, database access and embedded SQL","criteria":{"add":[{"id":"php-outbound","text":"PHP HTTP, SOAP, database, cache and env access appears in outbound.json"},{"id":"php-sql-tables","text":"Embedded SQL in PHP yields table names"}]},"proposed":"Sourcevision reports the HTTP, SOAP, database, cache and environment dependencies of PHP code in outbound.json, and the table names in its embedded SQL.","under":"58f0468b-33ce-46ee-b507-c95261f152b6","title":"PHP outbound calls and data access","type":"capability"}]
priority: "medium"
tags:
  - "php"
  - "lang-php"
  - "php-pr6"
blockedBy:
  - "238cd947-069f-4b9f-980c-9c800c2cafae"
---
