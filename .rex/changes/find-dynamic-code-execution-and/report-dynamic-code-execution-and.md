---
id: "3ce7b963-e6e2-4593-a830-8cf46fcce425"
type: "task"
title: "Report dynamic code execution and dynamic dispatch sites in PHP"
slug: "report-dynamic-code-execution-and"
summary: "Flag every place a PHP app runs a string as code or picks the function, class or file to run from a variable, so reviewers can see what reading the files alone can't explain."
description: "In `@n-dx/lang-php`, add `php-dynamic-code.ts` (with queries as needed) that reports two kinds of site, with file, position, the expression as written, and the enclosing function or method (or top level).\n\n**Execution:** code run from a string.\n- `eval(...)`;\n- `assert(...)` with a string argument;\n- `preg_replace` called with a literal pattern whose modifiers include `e`;\n- `create_function(...)`.\n\nLiteral-only arguments, for example `eval('return 1;')`, are still reported, marked `literal`.\n\n**Dispatch:** what runs is chosen by a value.\n- `call_user_func` / `call_user_func_array` / `forward_static_call(_array)` with a non-literal callable;\n- variable functions `$f(...)`;\n- `new $class(...)`, `$obj->$method(...)`, `$obj->{$expr}(...)`, `$class::$method(...)` and `$class::{$expr}(...)`;\n- `array_map`, `usort`, `array_filter` and similar built-ins only when the callback argument is a variable.\n\nIncludes with non-computable paths are already reported by `php-include-notices.ts` (PHP_DYNAMIC_INCLUDE / PHP_HOST_INCLUDE). Reference them by counting them in the same per-repository totals, without duplicating their notices.\n\nPersistence:\n- Per-site notices with their own codes (for example `php-dynamic-exec` and `php-dynamic-dispatch`), with locations, following `php-include-notices.ts`.\n- Per-repository counts by kind as an optional `dynamicCode` field in the PHP ecosystem section of sdlc-profile, beside `versionFloors` and `legacyConstructs` (`packages/sourcevision/src/analyzers/pack-ecosystem.ts`, carried through readiness like them). Absent when a repository has no site.\n- Document the new codes and field in the pack's AGENTS.md and in sourcevision's docs where `legacyConstructs` is documented. Note in the PR body that Hal reviews the field names.\n\nFixtures: one file per kind, including a literal-only eval, a callback array `[$this, $name]`, and a static `$class::$m()`; plus a file with no sites. Goldens updated through `test:update-goldens`."
acceptanceCriteria:
  - "eval, string assert, /e preg_replace and create_function sites are reported as execution sites with location, expression and enclosing scope"
  - "Non-literal call_user_func(_array), variable functions, new $class, $obj->$method() and $class::$method() are reported as dispatch sites"
  - "Per-repository counts by kind appear as an optional dynamicCode field in the PHP ecosystem section of readiness, absent when there are none"
  - "Non-PHP output and PHP output without the pack are byte-identical"
priority: "high"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "lang-php"
---
