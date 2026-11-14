---
id: "b67ec3b1-f881-4e4f-9096-394c6e41f57c"
type: "change"
title: "A PHP `use` of a project namespace (not a class) counts as an unresolved internal reference in the resolution report"
slug: "a-php-use-of-a-project-namespace-not-a"
summary: "The PHP resolution report understates how well n-dx links PHP code, because importing a namespace (rather than a class) is counted as a failure even when every class used through it is found."
intent: "Verdict: should-fix (low), from the adversarial review of task 461493c0 (PHP namespace resolver).\n\nScenario: `namespace App\\Controller; use App\\Entity; … new Entity\\User();` in a PSR-4 project. The `use App\\Entity` reference is looked up as a class (packages/lang-php/src/php-resolver.ts resolveReference / Index.findClass), finds no file, and because `App` is the project's own head it is an `unresolved internal-not-found` outcome. `Entity\\User` itself resolves. packages/sourcevision/scripts/php-resolve-report.mjs counts the namespace import in the internal denominator, so the per-repository internal resolution rate the operator logs is understated. No wrong edge or external results; only the measurement is skewed.\n\nReachability: the corpus report on any repository that imports namespaces; analyze output is unaffected.\n\nFix options:\n1. (Recommended) Classify a `use` import that resolves to no class but is a prefix of a declared namespace or of a resolved class name as a new outcome `namespace`, counted as resolved (like Python's namespace-package outcome). Cheap; needs the declared-namespace set already in the Index.\n2. Exclude `use` imports from the report's internal counts entirely. Cheaper but hides genuinely missing class imports."
acceptanceCriteria:
  - "A `use` of a namespace the project declares (or under which a referenced class resolves) is not an `unresolved` outcome, covered by a resolver test"
  - "A `use` of a missing project class is still `internal-not-found`"
touches:
  - "5e5d32b1-26ae-4594-a229-4b579038d053"
priority: "low"
discoveredFrom: {"item":"461493c0-1b3c-46a2-bbe5-2d85163df8b7","run":"9d846e7f-194b-4868-a951-bfaa0cded3eb"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "php"
  - "resolver"
source: "ndx-adversarial-review"
---
