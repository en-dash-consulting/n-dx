---
id: "30758b33-8939-42e9-bbce-5730d622e190"
type: "task"
title: "A PHP marker one folder down still makes a manifest-less Python or JavaScript repository PHP alone"
slug: "a-php-marker-one-folder-down-still"
summary: "A project written mostly in Python or plain JavaScript, with a small PHP tool in a subfolder, is still treated as a PHP-only project. Its own language's rules for skipped folders and test files are then lost, so the analysis lists the wrong files."
description: "Found by the adversarial review of A1 (2116a61e, commit 8f5960af3). Verdict: should-fix. Severity: medium.\n\nScenario (reproduced against the built lang-kit with invented fixtures, no root marker in either):\n- `src/*.py` x50 + `tools/composer.json` + `tools/0.php` -> `detectLanguages` = `[php]`. Without the child composer.json the same tree is `[python]` (markerless majority).\n- `src/*.js` x40, no package.json anywhere + `tools/composer.json` + one .php -> `[php]`. Without the marker it is `[typescript]`.\n\nEvidence: `packages/lang-kit/src/detect.ts`, `phpOneDownLanguages`: the fallback is kept beside PHP only when a direct child holds `package.json` or `countSourceFiles().other > 0` (languages with no config). Source of a configured language (py, go, cs, swift) and JS/TS without a child package.json are not weighed, so the child marker still decides before any file count. `detectLanguage` and `detectLanguages` both return through it (`phpOneDown`, and the child `index.php` branch).\n\nReachability: `sv analyze` on any such repository (sourcevision `src/language/detect.ts` calls both detectors). Effect: Python's skip rules (`venv`, `__pycache__`, `env`/`build`/`dist` without `__init__.py`) and test patterns, or TypeScript's `node_modules`/`dist` skips, are not applied. This behaviour predates A1 (the tree was `[php]` before it too); A1 fixed the three listed triggers only.\n\nOptions:\n1. (recommended) In `phpOneDownLanguages`, weigh PHP against the markerless majority: when another configured language or JS/TS has more counted source than PHP, return that language first with PHP beside it; PHP alone only when PHP has the most. Cost: a few lines plus tests; risk: a PHP site one folder down with more authored .js than .php files (phpBB-shaped fixtures have 4 .js vs 2 .php) would gain TypeScript beside or ahead of PHP, so the phpBB and osCommerce tests need a rule that keeps them PHP (for example, JS/TS counts only outside the directory holding the marker).\n2. Count JS/TS and configured-language source only outside the child directory that holds the PHP marker. Cost: a second bounded walk or a per-top-level-directory count; risk: an app and its PHP living in the same child directory.\nDecision for the owner: whether a PHP app folder's own .js files may ever outrank its PHP."
acceptanceCriteria:
  - "A markerless tree of 50 .py files under src/ with tools/composer.json and one .php file is detected with Python first and PHP beside it, in detectLanguage and detectLanguages (new test in packages/lang-kit/tests/unit/detect.test.ts)"
  - "A tree of 40 .js files under src/ with no package.json and tools/composer.json keeps TypeScript, with its node_modules and dist skips, beside PHP (new test)"
  - "The phpBB-shaped and osCommerce-shaped tests in detect.test.ts still give PHP alone"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "lang-kit"
  - "detection"
source: "ndx-adversarial-review"
---
