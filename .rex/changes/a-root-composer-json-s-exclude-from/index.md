---
id: "bbb65665-94e0-43ec-9518-7add80432e35"
type: "change"
title: "A root composer.json's `exclude-from-classmap` written with a leading slash (`\"/Tests/\"`) excludes nothing"
slug: "a-root-composer-json-s-exclude-from"
summary: "Composer's own documented way to keep test folders out of a project's class map is ignored by n-dx for the main project, so those classes can still be picked up when resolving PHP names."
intent: "Verdict: out-of-scope (low), from the adversarial review of task 461493c0 (PHP namespace resolver). Pre-existing in the Composer reader from task a34d8b17.\n\nScenario: a root composer.json with `\"autoload\": {\"classmap\": [\"src/\"], \"exclude-from-classmap\": [\"/Tests/\"]}` (the form Composer's schema documentation shows). lang-kit's `normalize(\"\", \"/Tests/\")` (packages/lang-kit/src/php-composer.ts:325) keeps the leading slash, giving `/Tests`, which is not repository-relative. The PHP resolver's `excludePattern` (packages/lang-php/src/php-resolver.ts) anchors it at the start of a repository-relative path, so it matches nothing and classes under `src/Tests/` stay in the classmap index. A nested project (`base` non-empty) is unaffected: `posix.join(\"pkg\", \"/Tests/\")` drops the slash.\n\nComposer resolves these paths relative to the package root (AutoloadGenerator joins them to the install path), so a leading slash means the package root, not the filesystem root.\n\nReachability: `ndx analyze` with the PHP pack on a Composer project using this form. Impact is small: exclusion only changes which file wins when a class name is declared in more than one classmap file.\n\nFix (recommended, cheap): in the reader's `normalize`, strip leading slashes from a path before joining it to the base, for autoload paths and exclude patterns alike, with a unit test."
acceptanceCriteria:
  - "readComposerProjects on a root composer.json with \"exclude-from-classmap\": [\"/Tests/\"] yields excludeFromClassmap [\"Tests\"], covered by a unit test"
  - "The PHP resolver does not map a class declared under an excluded classmap directory written with a leading slash, covered by a resolver test"
touches:
  - "5e5d32b1-26ae-4594-a229-4b579038d053"
priority: "low"
discoveredFrom: {"item":"461493c0-1b3c-46a2-bbe5-2d85163df8b7","run":"9d846e7f-194b-4868-a951-bfaa0cded3eb"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "php"
  - "composer"
source: "ndx-adversarial-review"
---
