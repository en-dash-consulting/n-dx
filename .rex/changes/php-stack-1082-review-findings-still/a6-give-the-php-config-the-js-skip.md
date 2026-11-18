---
id: "dcd473b7-2b77-42f1-8720-e1cd223a4562"
type: "task"
title: "A6: give the PHP config the JS skip directories and generated-file patterns"
slug: "a6-give-the-php-config-the-js-skip"
summary: "Keeps installed packages, build output and compressed scripts out of the code map in PHP projects, as they already are in JavaScript projects."
description: "#1082 review A6 (medium), `packages/lang-kit/src/php.ts` (skip directories and generated patterns).\n\nTrigger: a root `composer.json` site has `web/themes/t/node_modules/**` and `dist/**` walked as source, and `js/jquery.min.js` labelled source instead of generated. Only the root `.gitignore` is read, so a theme's own `.gitignore` does not help.\n\nFix: give the PHP config the JS/TS config's skip directories (`node_modules`, `dist`, and the rest) and generated-file patterns (`*.min.js`, and the rest), reusing the TypeScript config's lists rather than copying them. Keep PHP's own conditional skips (`vendor/` beside `composer.json`, `cache/`, `tmp/`) as they are.\n\nTests in lang-kit's registry/detect tests: a PHP site's nested `node_modules/` and `dist/` are skipped, `js/jquery.min.js` is generated; a PHP site's first-party `.js` stays source."
acceptanceCriteria:
  - "node_modules and dist under a PHP site are skipped"
  - "Minified JS in a PHP site is labelled generated"
  - "The PHP config reuses the TypeScript lists instead of copying them"
priority: "medium"
run: {"tier":"light","review":true,"skipTestGate":true}
tags:
  - "lang-kit"
  - "detection"
---
