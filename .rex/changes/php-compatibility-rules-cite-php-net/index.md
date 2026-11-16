---
id: "c2532cdb-90eb-4d98-b626-f42f2900578d"
type: "change"
title: "PHP compatibility rules cite php.net migration guides for 5.3-5.5 that php.net no longer hosts"
slug: "php-compatibility-rules-cite-php-net"
summary: "Several PHP compatibility rules link to php.net pages for PHP 5.3 to 5.5 that php.net has taken down, so their sources cannot be opened. Found by the operator's link check of PR 8 of the PHP stack."
intent: "Found by the operator's link check of PR 8 of the PHP stack (change a6e82740, runs 825f00a9 and bb8c57cf), 2026-11-16. The six migration53/54/55 pages the rules cite answer 404; every 5.6+ page answers 200. Ships in PR 8."
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "medium"
discoveredFrom: {"item":"a6e82740-8767-4eba-86f9-e53327fdfc9a","run":"bb8c57cf-353d-43e5-9720-05b94c0de0f5"}
tags:
  - "php"
  - "lang-php"
  - "compatibility"
---
