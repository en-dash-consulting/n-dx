---
id: "132dbb84-f95a-4c01-98e7-bb0fdfd395d6"
type: "task"
title: "P11: label a partial database or URL host as unknown, not as a literal target"
slug: "p11-label-a-partial-database-or-url"
summary: "Stops half-built database and web addresses from being reported as if they were the real address."
description: "#1082 review P11 (medium), `packages/lang-php/src/php-outbound.ts` (`OPEN_HOST_KEY` and the literal-target reading).\n\nTriggers: `new PDO('mysql:host=db-' . $env . '.internal;…')` gives target `\"db-\"`; `\"mysql:host=db{$n}.internal\"` gives `\"db\"`; `pg_connect('host=pg-' . $region . ' …')` gives `\"pg-\"`; `'http' . ($s ? 's' : '') . '://x'` gives `\"http\"`. `OPEN_HOST_KEY` only catches `host=` followed by nothing; 7708ea9f2 fixed only the mysqli form.\n\nFix: when the literal part of a concatenation or interpolation ends inside the host (no host terminator such as `;`, space, `/`, `:` or the string's end after it) or inside the scheme, the target is not literal: keep it as written under the as-written rule from PR 13 (`targetSource` `unknown`), as the outbound code already does for unresolved arguments.\n\nTests (invented code): the four triggers give `targetSource` `unknown` with the expression as written; a full literal host stays literal; constant- and config-resolved hosts are unchanged."
acceptanceCriteria:
  - "The four partial-host triggers are no longer literal targets"
  - "Full literal and resolved hosts are unchanged"
priority: "medium"
run: {"tier":"light","review":true,"skipTestGate":true}
tags:
  - "lang-php"
  - "outbound"
---
