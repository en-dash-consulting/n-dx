---
id: "2116a61e-04a6-4ad9-a5f3-09eb29f47dff"
type: "task"
title: "A1: a PHP marker one folder down adds PHP beside the TypeScript fallback, not instead of it"
slug: "a1-a-php-marker-one-folder-down-adds"
summary: "Stops a mixed project with a web front end and a PHP back end in separate folders from being treated as PHP only, which loses the front end's handling."
description: "#1082 review A1 (high), `packages/lang-kit/src/detect.ts` (child-marker handling, `readRootMarkers` / `rankMarkedLanguages` and the one-folder-down PHP check).\n\nTrigger: no root `package.json`, with `frontend/package.json` (+ 40 `.tsx` files) and `backend/composer.json`. Main: `[typescript]`. Stack: `[php]`. Effect: TypeScript skips and patterns are lost: `frontend/node_modules/**` and `frontend/dist/**` are inventoried as source, `App.test.tsx` is source not test, `types.d.ts` source not generated. Same with `app/package.json` beside `api/index.php`, and a Rust repo with `tools/composer.json`.\n\nCause: a child `composer.json` or `index.php` counts as a marker but a child `package.json` does not, and the marker decides before any file count.\n\nFix: a child PHP marker adds PHP beside the TypeScript fallback instead of replacing it (or count child markers the same way for every language; choose and say why). A PHP-only site whose app sits one folder down (the case the child marker was added for) must still be detected as PHP.\n\nTests in `packages/lang-kit/tests/unit/detect.test.ts`: the three triggers give TypeScript plus PHP (or TypeScript, if that is the chosen rule) and keep TypeScript's skips and patterns; a PHP-only site one folder down is still PHP."
acceptanceCriteria:
  - "frontend/package.json beside backend/composer.json keeps TypeScript detection, skips and patterns"
  - "A PHP-only app one folder down is still detected as PHP"
priority: "high"
run: {"tier":"standard","review":true,"skipTestGate":true}
tags:
  - "lang-kit"
  - "detection"
---
