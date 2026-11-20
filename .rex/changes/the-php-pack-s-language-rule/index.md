---
id: "96a28a4f-35b0-4db4-b8c3-0ce1946593e7"
type: "change"
title: "The PHP pack's language-rule provenance cites php.net pages that were never checked"
slug: "the-php-pack-s-language-rule"
summary: "The PHP pack records where its rules about constructors, define(), includes and use imports come from, but nobody has yet read those pages to confirm the rules. An operator should check them so the recorded sources can be trusted."
intent: "Verdict: should-fix (low). Found by the adversarial review of task 5cd796e9 (PHP structure queries).\n\nScenario: packages/lang-php/src/php-pack.ts records provenance entries `constructors`, `define`, `includes` and `use-imports`, each with verifiedOn 2026-11-14 and a php.net source URL. The agent that wrote them had no network access and did not open those pages; verifiedAgainst lists only tree-sitter-php@0.25.1. The rules themselves (PHP 4-style same-name constructors only outside a namespace and without __construct; define() constants are global; the four include forms; use function/const/group use) were written from knowledge, which the lane rules (LS3/LS4, lang-php AGENTS.md: \"PHP versions and syntax rules come from cited sources, never from memory\") forbid without a check.\n\nReachable: no wrong output is known; the risk is an unverified rule (for example the namespace exception for same-name constructors) silently misclassifying symbols.\n\nFix: the operator opens each cited php.net page, confirms or corrects the rule in php-symbols.ts / php-imports.ts / guards.scm, and records what was checked (adding the manual page to verifiedAgainst). Cost: about half an hour. No code change if the rules hold."
acceptanceCriteria:
  - "Each php.net page cited in phpPack.provenance has been read by the operator and the outcome logged with append_log"
  - "verifiedAgainst for constructors, define, includes and use-imports names the manual page that was checked"
  - "Any rule the manual contradicts is corrected with a test"
touches:
  - "5e5d32b1-26ae-4594-a229-4b579038d053"
priority: "low"
discoveredFrom: {"item":"5cd796e9-6177-4d40-8439-b1678e700322","run":"27d70059-da72-4a36-a19c-19449c1a9513"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "php"
  - "lang-php"
source: "ndx-adversarial-review"
---
