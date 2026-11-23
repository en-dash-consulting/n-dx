---
id: "0facb205-d46c-46dc-b2d7-1701a6c69597"
type: "change"
title: "PHP names under a root namespace shared with a library count as missing project classes"
slug: "php-names-under-a-root-namespace"
summary: "When a project and an outside library share the same top-level namespace, n-dx counts the library's classes as missing project classes, so they appear neither as links nor as outside packages."
intent: "Follow-up to change 78cf4f7d (PR 3 of the PHP stack), found by the operator's hand-check of php-resolve-report on the corpus (run 9d846e7f; see the php_resolve_report log entry on task 461493c0). isOwn in packages/lang-php/src/php-resolver.ts compares only the first namespace segment, so on mediawiki 5436 references to wikimedia/* Composer packages are internal-not-found instead of php:Wikimedia externals. Delivered in PR 3."
acceptanceCriteria:
  - "References to a library under the project's root namespace become php: externals per D5"
touches:
  - "532cf1ec-2850-4771-9a9e-446e5a36234c"
priority: "high"
discoveredFrom: {"item":"78cf4f7d-2b28-4263-bde2-bbc7995f7632","run":"9d846e7f-194b-4868-a951-bfaa0cded3eb"}
tags:
  - "php"
  - "lang-php"
  - "php-pr3"
source: "operator-hand-check"
---
