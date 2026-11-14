---
id: "51f69a22-5717-4c8c-a0eb-3b3dd33e3ab7"
type: "change"
title: "PHP index.php under www/ or public_html/ is detected as PHP but not marked an entry point"
slug: "php-index-php-under-www-or-public-html"
summary: "Older PHP sites keep their front page in a www or public_html folder. n-dx now recognises these sites as PHP but does not mark that front page as a starting point, so their analysis is less complete than it should be."
intent: "Found by the adversarial review of 6af46475 (docroot PHP detection, run 1123a421). Severity low, verdict out-of-scope: the gap is in phpConfig, which commit 9177365f9 added, not in this task's change.\n\nScenario: a repository with `www/index.php` (or `public_html/index.php`) and no other marker is detected as PHP, because `hasWeakPhpMarker` (packages/lang-kit/src/detect.ts) consults `PHP_DOCROOT_DIRECTORIES` (packages/lang-kit/src/php.ts:26), which lists public, web, htdocs, www and public_html. But `phpConfig.entryPointPatterns` (packages/lang-kit/src/php.ts) lists only `index.php`, `public/`, `web/` and `htdocs/` `index.php`, so the site's front controller never gets the entry-point treatment that `htdocs/index.php` gets.\n\nReachable through `ndx analyze` on such a repository.\n\nOptions:\n(a) Build the docroot entry patterns from `PHP_DOCROOT_DIRECTORIES` so detection and entry points cannot drift. This is a one-line change and is recommended. It changes analyze output only for PHP repositories whose index.php sits under www/ or public_html/.\n(b) Leave it for the PR 5 docroot route work (3a05f5ae). That work reports routes through the pack, not entry points, so it does not cover this gap."
acceptanceCriteria:
  - "phpConfig.entryPointPatterns match www/index.php and public_html/index.php"
  - "Every directory in PHP_DOCROOT_DIRECTORIES has a matching index.php entry-point pattern, checked by a test"
touches:
  - "956b7119-989e-41f1-ba0e-3e8d26494fee"
priority: "low"
discoveredFrom: {"item":"6af46475-e55a-465d-8d91-f0e91136ab1b","run":"1123a421-0aa7-4ad7-a68b-5f8ccfd28983"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "php"
  - "lang-kit"
source: "ndx-adversarial-review"
---
