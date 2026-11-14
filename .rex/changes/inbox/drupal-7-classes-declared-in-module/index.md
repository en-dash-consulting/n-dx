---
id: "f852a948-02c6-4077-a64f-db20075436cb"
type: "change"
title: "Drupal 7 classes declared in .module and .install files become php: externals"
slug: "drupal-7-classes-declared-in-module"
summary: "Drupal 7 keeps some classes in .module and .install files, which n-dx does not read as PHP, so references to them look like outside packages."
intent: "Seen in PR 3's php-resolve-report on drupal7 (2026-11-14): FieldException is declared in modules/field/field.module, but phpConfig.parseableExtensions (.php .phtml .php3 .php4 .php5 .inc) leaves .module out, so 22 references become the external php:FieldException (and 1 php:FieldUpdateForbiddenException). PR 2's corpus report showed .module/.install parse 186/186 clean. Options: add Drupal's .module, .install, .theme, .profile, .engine and .test to parseableExtensions (check the byte-identical rule for non-PHP repositories and the TypeScript fallback), or leave Drupal-specific extensions to the frameworks pack (PHP-8). Decision for the operator."
acceptanceCriteria:
  - "References to a class declared in a Drupal 7 .module file resolve to that file, or the decision to leave them out is recorded"
priority: "low"
discoveredFrom: {"item":"78cf4f7d-2b28-4263-bde2-bbc7995f7632"}
tags:
  - "php"
  - "lang-php"
source: "operator-hand-check"
---
