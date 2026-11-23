---
id: "ce7224ec-beb6-4cac-8350-0e9e10f3bebd"
type: "change"
title: "PHP version floor dates PHP 5 files 8.0 from parser error recovery and one-line attributes"
slug: "php-version-floor-dates-php-5-files-8"
summary: "The PHP version report says some PHP 5 files need PHP 8, because the parser misreads old string syntax and because some old apps add PHP 8 markers written as comments that older PHP ignores. A migration would then misjudge which repositories are really PHP 5 code."
intent: "Found by the operator's corpus check of PR 8 of the PHP stack (change a6e82740, task 4d498f89), 2026-11-16: 2 wordpress files (named-arguments from error recovery) and 5 drupal7 files (one-line #[...] attributes) get floor 8.0. Ships in PR 8."
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "medium"
discoveredFrom: {"item":"4d498f89-3213-4ad4-a8ff-ca343af7a626","run":"825f00a9-8622-4b4e-806d-2214d5166915"}
tags:
  - "php"
  - "lang-php"
  - "compatibility"
---
