---
id: "dacfee82-cf45-4790-8878-0f1d2e189ed4"
type: "task"
title: "Port the .htaccess and entry-point linear scans from 87292366a"
slug: "port-the-htaccess-and-entry-point"
summary: "Brings the reviewed fix for three slow text patterns into this part of the PHP work."
description: "Port from 87292366a (and the matching hunks of 58add3923):\n- the hunks in `packages/lang-php/src/php-htaccess.ts` and `packages/lang-php/src/php-entry-points.ts`;\n- in `packages/lang-php/tests/unit/php-linear-scans.test.ts`, the `htaccessWords`, `parseHtaccess` and `splitComparison` describe blocks and their imports, placed where restack/pr11 has them.\nTests in packages/lang-php: `npx vitest run tests/unit/php-linear-scans.test.ts`, then the docroot, htaccess and entry-point tests (`npx vitest run -t htaccess`, and the files named php-docroot*, php-htaccess*, php-entry-points*); `pnpm --filter @n-dx/lang-php exec tsc --noEmit`."
acceptanceCriteria:
  - "php-htaccess.ts and php-entry-points.ts match restack/pr11's hunks"
  - "Those tests and typecheck pass"
priority: "high"
run: {"tier":"standard","skipTestGate":true}
---
