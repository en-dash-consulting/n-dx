---
id: "a7015572-b3ea-4072-b172-09fe4c2ef285"
type: "change"
title: "hench's php -l guard skips changed .module and .install files"
slug: "hench-s-php-l-guard-skips-changed"
summary: "When the agent edits a Drupal module file in a PHP project, the PHP syntax check never runs on it, so a broken module can be marked done. The analyzer already treats these files as PHP."
intent: "Verdict: out-of-scope (pre-existing), severity low. Found by the adversarial review of f7febe6f, which made the PHP pack parse .module and .install.\n\nScenario: in a repository detected as PHP, `ndx work` changes `modules/field/field.module` and leaves a syntax error. `PHP_LINT_EXTENSIONS` (packages/hench/src/tools/php-guards.ts:31) is `.php .phtml .inc`, so `php -l` never runs on it and the run passes its guard. sourcevision now reads the same file as PHP (lang-kit `phpConfig.parseableExtensions` includes `PHP_REPOSITORY_ONLY_EXTENSIONS`).\n\nReachable: any hench run in a Drupal 7 checkout that edits a module or install file.\n\nOptions: (1) recommended — add `.module` and `.install` to `PHP_LINT_EXTENSIONS` (cheap; they are linted only in a project hench already detected as PHP, so a non-PHP repository is unaffected; risk: a non-PHP `.module` inside a PHP repository would be linted and fail). (2) derive the list from lang-kit's `PHP_REPOSITORY_ONLY_EXTENSIONS` plus the plain PHP extensions, through hench's gateway, so the two lists cannot drift; costs a gateway export, which the gateway cap makes a deliberate choice."
acceptanceCriteria:
  - "In a project hench detects as PHP, a changed .module or .install file is checked with php -l before the test gate"
  - "A hench php-guards unit test covers a changed .module file and fails while .module is missing from the lint extensions"
touches:
  - "4edba59e-0cee-495d-960c-7b2c42fe7939"
priority: "low"
discoveredFrom: {"item":"f7febe6f-fa48-4a0e-b7b4-f24da7f33539","run":"866329c7-3491-4f76-9270-694bba6d8843"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "php"
  - "hench"
source: "ndx-adversarial-review"
---
