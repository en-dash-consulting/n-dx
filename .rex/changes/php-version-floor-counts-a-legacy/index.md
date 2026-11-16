---
id: "1d9793bc-4325-4966-a3f4-cdf70e6f836a"
type: "change"
title: "PHP version floor counts a legacy class named String, Object or Int as a modern type declaration"
slug: "php-version-floor-counts-a-legacy"
summary: "Old PHP projects sometimes define their own class called String or Object. The version report reads type hints to those classes as newer PHP features, so it can say such a file needs PHP 7 when it actually cannot run on PHP 7 at all."
intent: "Severity: low. Verdict: should-fix (found by the adversarial review of task 4d498f89, run 825f00a9).\n\nScenario: a PHP 5 repository declares `class String {}` (or Object, Int, Float, Bool, Iterable, Mixed, Void) and writes `function f(String $s)`. The php-compat rules (packages/lang-php/src/php-compat.ts, TYPE_KEYWORDS; queries/php-compat/compat.scm @compat.primitive-type) read the type name case-insensitively, so the file's floor is 7.0 (or 7.1, 7.2, 8.0) with rule `scalar-type-declarations`. In PHP 5 that hint named the user class; PHP 7.0+ reserves those names, so the file cannot run on 7.0. The floor is therefore not a lower bound for such a file, and the readiness histogram counts it as PHP 7 code.\n\nReachable: `sv analyze` with the PHP pack on a legacy repository declaring such a class (CakePHP 1.x declares `class Object`). Not covered by any test.\n\nOptions:\n1. (Recommended) When the repository declares a class whose name is one of the type keywords (case-insensitive), do not count that name as a type keyword in any file; report it instead through the removed/deprecated-constructs rules (reserved class names, migration70 incompatible changes). Cost: a project-wide pass over symbol declarations before floors; low risk.\n2. Leave the floor as is and only add a notice naming the conflicting class. Cheaper, but the histogram stays wrong."
acceptanceCriteria:
  - "A fixture repository declaring `class String` with a file using `function f(String $s)` gives that file no 7.0 floor from the type hint (fails today: floor 7.0 scalar-type-declarations)"
  - "The same type hint in a repository that declares no such class still gives floor 7.0"
  - "A test in packages/lang-php/tests/integration/php-compat.test.ts covers both cases"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "low"
discoveredFrom: {"item":"4d498f89-3213-4ad4-a8ff-ca343af7a626","run":"825f00a9-8622-4b4e-806d-2214d5166915"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "php"
  - "lang-php"
  - "compatibility"
source: "ndx-adversarial-review"
---
