---
id: "f49c3876-4fb7-45a0-8619-86b1cda30748"
type: "capability"
title: "PHP outbound calls and data access"
slug: "php-outbound-calls-and-data-access"
statement: "Sourcevision reports the HTTP, SOAP, database, cache and environment dependencies of PHP code in outbound.json, and the table names in its embedded SQL."
criteria: [{"id":"php-outbound","text":"PHP HTTP, SOAP, database, cache and env access appears in outbound.json"},{"id":"php-sql-tables","text":"Embedded SQL in PHP yields table names"}]
---

## History

- 2026-11-16 38abed61-45be-4181-a45c-5652878ad43c added: PHP outbound calls, database access and embedded SQL
