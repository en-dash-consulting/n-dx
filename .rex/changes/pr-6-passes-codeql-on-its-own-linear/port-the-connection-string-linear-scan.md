---
id: "756e1986-dfc7-4b55-8391-be5a8c734a22"
type: "task"
title: "Port the connection-string linear scan from 87292366a"
slug: "port-the-connection-string-linear-scan"
summary: "Brings the reviewed fix for a slow text pattern in connection-string reading into this part of the PHP work."
description: "Port from 87292366a (and the matching hunks of 58add3923):\n- the hunks in `packages/lang-php/src/php-outbound.ts`;\n- in `packages/lang-php/tests/unit/php-linear-scans.test.ts`, the `connectionKeyValues` describe block and its imports, placed where restack/pr11 has it.\nTests in packages/lang-php: `npx vitest run tests/unit/php-linear-scans.test.ts`, then the outbound tests (files named php-outbound*); `pnpm --filter @n-dx/lang-php exec tsc --noEmit`."
acceptanceCriteria:
  - "php-outbound.ts matches restack/pr11's hunks"
  - "Those tests and typecheck pass"
priority: "high"
run: {"tier":"standard","skipTestGate":true}
---
