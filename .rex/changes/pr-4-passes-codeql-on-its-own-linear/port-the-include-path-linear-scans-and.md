---
id: "f6c4b312-9c16-4a69-8339-caa40512a98d"
type: "task"
title: "Port the include-path linear scans and the config line cap from 87292366a"
slug: "port-the-include-path-linear-scans-and"
summary: "Brings the reviewed fix for four slow text patterns in include-path reading into this part of the PHP work."
description: "Port from 87292366a (and the matching hunks of 58add3923):\n- `packages/lang-php/src/php-line-cap.ts` (new);\n- the hunks in `packages/lang-php/src/php-includes.ts` and `packages/lang-php/tests/unit/php-include-config.test.ts`;\n- `packages/lang-php/tests/unit/php-linear-scans.test.ts` (new): only its `parsePhpIncludeConfig` describe block and the imports that block needs. Later PRs add the other blocks.\nTests in packages/lang-php: `npx vitest run tests/unit/php-linear-scans.test.ts tests/unit/php-include-config.test.ts`, then `npx vitest run tests/integration` for includes; `pnpm --filter @n-dx/lang-php exec tsc --noEmit`."
acceptanceCriteria:
  - "php-includes.ts and php-line-cap.ts match restack/pr11's hunks"
  - "The include tests and typecheck pass"
priority: "high"
run: {"tier":"standard","skipTestGate":true}
---
