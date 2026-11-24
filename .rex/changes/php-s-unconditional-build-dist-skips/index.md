---
id: "b392e0e8-ac54-4dc3-a57c-b787af1a190f"
type: "change"
title: "PHP's unconditional build/dist skips override Python's and Java's conditional rules when their configs merge"
slug: "php-s-unconditional-build-dist-skips"
summary: "In a repository that is both PHP and Python or Java, some real Python or Java code inside folders named build or dist is now left out of the analysis. Keeping the other language's rule in force keeps that code counted."
intent: "Found by the adversarial review of A6 (dcd473b7, PHP config reuses the TypeScript skip directories). Severity low, verdict should-fix.\n\nScenario: phpConfig.skipDirectories is now TYPESCRIPT_SKIP_DIRECTORIES, which includes `build` and `dist` unconditionally. mergeLanguageConfigs (packages/lang-kit/src/detect.ts:680) unions skipDirectories, and skipsDirectory (packages/lang-kit/src/registry.ts:154) returns true for an unconditional name before reading skipUnlessContains / skipBesideMarker. So:\n- In a Python + PHP repository (pyproject.toml beside composer.json), a `build/` or `dist/` package holding `__init__.py` is now skipped. Python alone keeps it (skipUnlessContains).\n- In a Java + PHP repository (pom.xml beside composer.json), `src/main/java/com/acme/build/Foo.java` is now skipped. Java alone keeps it (skipBesideMarker never skips below src/).\nBefore A6 a PHP merge left these to the other config's conditional rule. A TypeScript merge already behaves this way (language-registry.test.ts asserts it for Python + TypeScript), so the defect is new only for PHP merges without TypeScript.\n\nReachable: `ndx analyze` on a repository whose root holds composer.json beside pyproject.toml or pom.xml, with such a directory. Rare.\n\nOptions:\n1. In mergeLanguageConfigs, drop a name from the merged skipDirectories when another merged config gives it a conditional rule, so the conditional rule decides. This also changes Python + TypeScript and Java + TypeScript output, so it needs a decision against the \"non-PHP output byte-identical\" lane rule.\n2. Give PHP its own skip set: TYPESCRIPT_SKIP_DIRECTORIES minus `build` (and `dist`), with `dist` as a skipUnlessContains `*.php` entry. That changes only PHP repositories, but `node_modules/` and `dist/` under a PHP theme must stay skipped (A6's tests).\nRecommend 2 for `build` only, keeping `dist` unconditional: built theme output is common in PHP sites, and a Python `dist/` package is rare."
acceptanceCriteria:
  - "mergeLanguageConfigs([pythonConfig, phpConfig]) keeps a build/ directory that holds __init__.py"
  - "mergeLanguageConfigs([javaConfig, phpConfig]) keeps src/main/java/com/acme/build/"
  - "A PHP-only repository still skips web/themes/t/node_modules/ and web/themes/t/dist/"
  - "A unit test in lang-kit's language-registry tests covers both merges and fails on the current behaviour"
  - "`packages/sourcevision/tests/e2e/cli-analyze-third-party.test.ts` passes (copied-in libraries under a PHP project's `build/` are inventoried and marked third-party, not skipped)"
touches:
  - "956b7119-989e-41f1-ba0e-3e8d26494fee"
priority: "high"
discoveredFrom: {"item":"dcd473b7-2b77-42f1-8720-e1cd223a4562","run":"ba81723e-7f3d-49d7-b1fd-656e546c7a2c"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "php"
  - "lang-kit"
source: "ndx-adversarial-review"
---
