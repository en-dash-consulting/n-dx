---
id: "6e479fe4-4139-41b7-b55c-c2382bebee43"
type: "change"
title: "PHP skip rules drop a cache/ directory whose PHP sits in subdirectories, and inventory a Composer app's public/vendor assets as source"
slug: "php-skip-rules-drop-a-cache-directory"
summary: "The rules that decide which PHP folders to ignore look one level deep, so some real PHP code gets left out and some downloaded front-end libraries get counted as the project's own code. Tightening them keeps PHP analysis accurate."
intent: "Found by the adversarial review of 94b212f6 (php language config). Severity medium, verdict should-fix.\n\n1. `cache/`, `tmp/` and `.phpunit.cache/` are kept only when they directly hold a `.php` file (phpConfig.skipUnlessContains with `*.php`; `directoryHolds` in packages/sourcevision/src/util/project-walk.ts checks direct children only). A legacy `includes/cache/drivers/file.php`, with no `.php` directly in `includes/cache/`, is silently dropped from the inventory. Direct-only is right for Symfony 2's `app/cache/prod/*.php` (generated), so a fix must tell the two apart, for example by skipping only beside a framework marker or depth-limiting the look-ahead.\n2. `vendor/` is skipped only beside `composer.json` (skipOnlyBeside). In a Composer app, `public/vendor/` (Laravel's published package assets: minified JS/CSS) has no composer.json beside it, so it is inventoried as JavaScript source and skews language stats and zones. Before this change `vendor/` was skipped everywhere.\n\nReachable: `ndx analyze` on a PHP repository with those layouts.\n\nOptions: (1) look one more level into cache/tmp for `.php`, or keep the direct rule and add a `skipBesideMarker`-style exception for framework cache roots; (2) also skip a `vendor/` holding no `.php` file at any shallow depth, or skip `vendor/` anywhere in a repository whose root has composer.json. Recommend (2b), because hand-copied libraries come from repositories without Composer."
acceptanceCriteria:
  - "In a PHP repository, includes/cache/drivers/file.php (no .php directly in includes/cache/) is inventoried"
  - "Symfony-style app/cache/prod/container.php stays out of the inventory"
  - "In a repository with a root composer.json, public/vendor/horizon/app.js is not inventoried"
  - "In a PHP repository without composer.json, vendor/smarty/Smarty.class.php is still inventoried"
touches:
  - "956b7119-989e-41f1-ba0e-3e8d26494fee"
priority: "medium"
discoveredFrom: {"item":"94b212f6-fac0-4adb-8a12-814d38e792f9","run":"707f8067-b5a4-4a96-810f-a55acbf2c4a4"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "php"
  - "lang-kit"
source: "ndx-adversarial-review"
---
