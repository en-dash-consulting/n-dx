---
id: "f3198e15-a42e-4e05-9917-a6be8ff68d36"
type: "task"
title: "Capture only path-shaped assignment right-hand sides in the PHP pack"
slug: "capture-only-path-shaped-assignment"
summary: "The PHP pack copies the right-hand side of every variable assignment in a project, which can double analysis memory on large legacy codebases. Only assignments that can build a file path matter, so capture only those."
description: "Review finding from run 06524a47 (task 973d69dd), should-fix, medium.\n\nThe defect: `packages/lang-php/queries/php/imports.scm` captures `@include.assign` / `@include.assign_value` for every `assignment_expression` and `augmented_assignment_expression` in every file. Each Capture carries its node text, and the resolver holds the captures of all files at once (`preparePhpImports`). A file with `$config = array(...5000 lines...)` or `$x = function () {...}` duplicates that whole text into the captures. `php-autoloaders.ts` reads these captures only inside autoloader bodies, where the right-hand sides are path expressions; the dynamic-include work (task fd220c20) also reads them for path variables.\n\nFix: restrict `right:` in the query to node types a path can be built from: binary_expression, string, encapsed_string, function_call_expression, variable_name, name, parenthesized_expression, class_constant_access_expression (keep any other path-shaped type the dynamic-include task relies on). Array literals, closures, arrow functions and object creation produce no include.assign capture. Regenerate the php goldens and check that only the dropped assign captures change.\n\n**Operator note:** the operator measures peak memory of php-resolve-report on the largest legacy corpus repository before and after this run and records both with append_log. The agent cannot read ~/.cache and does not run the report."
acceptanceCriteria:
  - "An assignment whose right-hand side is an array literal, closure or object creation produces no include.assign capture (the golden shows none for such assignments)"
  - "Autoloader patterns, path variables and dynamic-include candidates still resolve: the php-legacy-autoload, php-legacy-includes and dynamic-include integration tests pass unchanged"
  - "Non-PHP output is byte-identical"
priority: "medium"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":100}
tags:
  - "php"
  - "lang-php"
  - "resolver"
blockedBy:
  - "fd220c20-0191-4388-b858-0a1454884daa"
---
