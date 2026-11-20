---
id: "5cd796e9-6177-4d40-8439-b1678e700322"
type: "task"
title: "PHP structure queries: includes, namespaces, use imports, symbols and calls"
slug: "php-structure-queries-includes"
summary: "Make the PHP pack report what each PHP file includes, which namespace it is in, what it imports, what it declares and what it calls, checked against committed expected outputs."
description: "Write `packages/lang-php/queries/php/*.scm` and the pack code that turns captures into lang-kit facts, with provenance per rule as the other packs do.\n\n- **Imports (written):** `include`, `include_once`, `require`, `require_once` with the argument as written (literal, `__DIR__ . '/x.php'`, `dirname(__FILE__) . '/x.php'`, concatenations, variables); `use` imports for classes, `use function`, `use const`, group use (`use A\\{B, C as D}`), aliases; namespace declarations (bracketed and unbracketed). Set guard `conditional` for includes inside `if`/`else`/`switch`/loops, inside a function or method body, or behind `function_exists`/`class_exists`/`defined` (decision D3).\n- **Symbols:** class, interface, trait, enum (8.1), function, method, constructor (`__construct` and PHP 4 style same-name constructors), namespace, constant (namespace `const`, class constants, `define()` with a literal name), with positions.\n- **Calls:** function calls, method calls, static calls, `new` expressions, with receiver/class names as written.\n- Inline HTML regions are ignored for facts.\n- Nothing is resolved into edges in this task.\n\nGoldens: committed fixtures and goldens under packages/lang-php/tests, covering PHP 5.2-style code (no namespaces, `dirname(__FILE__)`, PEAR-style class names, PHP 4 constructors, `<?php` blocks between HTML), PHP 5.3–5.6 (namespaces, closures, traits, `::class`), and PHP 8 (enums, attributes, match). Use `test:update-goldens` as lang-python does. Grammar-dependent tests skip when the WASM is absent.\n\n**Operator note, 2026-11-14:** the operator has built the grammar, so `packages/lang-php/build/grammars/tree-sitter-php.wasm` is present for generating and checking goldens. Never commit anything under `packages/lang-php/build/`. The scaffold task left out the package's `.gitignore`: add `packages/lang-php/.gitignore` the same as `packages/lang-python/.gitignore` (it ignores `/build/`) and commit it with this task."
acceptanceCriteria:
  - "Import, symbol and call facts match committed goldens for PHP 5.2, 5.3-5.6 and 8.x fixtures"
  - "Includes in conditional positions carry the conditional guard"
  - "No import edges are produced yet, and non-PHP output is byte-identical"
priority: "high"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "lang-php"
blockedBy:
  - "aac5fad8-89d8-4cd4-8e2e-d1edf328c2ad"
---
