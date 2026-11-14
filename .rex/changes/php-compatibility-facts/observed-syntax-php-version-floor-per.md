---
id: "4d498f89-3213-4ad4-a8ff-ca343af7a626"
type: "task"
title: "Observed-syntax PHP version floor per file"
slug: "observed-syntax-php-version-floor-per"
summary: "Work out the oldest PHP version each file can run on from the language features it uses, so a migration knows which repositories are truly PHP 5 code."
description: "In `@n-dx/lang-php`, compute for each file the minimum PHP version its syntax requires, from tree-sitter nodes, with each rule citing its php.net migration guide page (https://www.php.net/manual/en/migrationXY.new-features.php and similar) as provenance. No version numbers or dates from memory beyond the boundaries the rule cites; state the URL in each rule.\n\nRules (minimum version → constructs): 5.3 namespaces, closures, `__DIR__`, `static::`, `goto`, nowdoc, `?:`; 5.4 traits, short array `[]`, `$this` in closures, `<?=` always on, `(new X)->m()`; 5.5 generators/`yield`, `finally`, `::class`, `list()` in `foreach`; 5.6 variadics/`...`, `**`, `use function`/`use const`, constant expressions; 7.0 scalar and return type declarations, `??`, `<=>`, anonymous classes, group use; 7.1 nullable types, `void`, `iterable`, `[a, b] = …`, class constant visibility, multi-catch; 7.2 `object` type; 7.3 trailing comma in calls, flexible heredoc; 7.4 typed properties, arrow functions, `??=`, spread in arrays; 8.0 `match`, attributes, named arguments, nullsafe `?->`, union types, constructor promotion, `mixed`, `static` return; 8.1 enums, `readonly`, `never`, first-class callables, `new` in initializers, pure intersection types; 8.2 `readonly` classes, DNF types; 8.3 typed class constants.\n\nOutput: per-file floor and the construct that set it (in memory and on the file's facts as an optional field), plus a per-repository histogram. Persist the per-repository histogram into readiness as an optional ecosystem fact (follow how readiness already carries ecosystem facts; optional fields only).\n\nFixtures exercising each boundary."
acceptanceCriteria:
  - "Each PHP file gets a version floor and the construct that set it, with php.net provenance per rule"
  - "A per-repository histogram of floors appears in readiness as an optional field"
  - "Fixtures cover every listed boundary"
priority: "medium"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "lang-php"
  - "compatibility"
---
