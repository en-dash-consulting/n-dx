---
id: "2bf98899-1738-4fea-a5b0-f1fd120823f9"
type: "task"
title: "Port the text-trim helper and the Composer and resolver trims from 87292366a"
slug: "port-the-text-trim-helper-and-the"
summary: "Brings the reviewed fix for two slow text patterns into this part of the PHP work."
description: "Port from 87292366a (and the matching hunks of its review repair 58add3923):\n- `packages/lang-kit/src/text-trim.ts` (new) and `packages/lang-kit/tests/unit/text-trim.test.ts` (new, with 58add3923's hunks);\n- the `export * from \"./text-trim.js\"` lines in `packages/lang-kit/src/index.ts`, and the `trimTrailing`/`trimLeading`/`trimChar` guidance lines in `packages/lang-kit/AGENTS.md`;\n- the hunks in `packages/lang-kit/src/php-composer.ts`, `packages/lang-kit/src/python-build.ts` and `packages/lang-php/src/php-resolver.ts`.\nNo changeset here: PR 7's port adds `.changeset/php-linear-config-scans.md` for the whole fix.\nTests: `npx vitest run tests/unit/text-trim.test.ts` in packages/lang-kit, then the lang-kit suite; `pnpm --filter @n-dx/lang-kit exec tsc --noEmit`; in packages/lang-php, `npx vitest run tests/integration/php-resolver.test.ts`."
acceptanceCriteria:
  - "The ported files' hunks are identical to restack/pr11's"
  - "lang-kit's suite and typecheck pass"
  - "php-resolver tests pass"
priority: "high"
run: {"tier":"standard","skipTestGate":true}
---
