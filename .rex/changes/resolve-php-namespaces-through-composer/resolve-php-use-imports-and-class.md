---
id: "461493c0-1b3c-46a2-bbe5-2d85163df8b7"
type: "task"
title: "Resolve PHP use imports and class references to files, with php: externals"
slug: "resolve-php-use-imports-and-class"
summary: "Turn PHP imports and class references into file-to-file links through Composer's mapping rules, so PHP code joins n-dx's dependency graph, and name everything outside the project consistently."
description: "In `@n-dx/lang-php`, add the namespace resolver and wire its edges into analyze through the same path Go, Java and Python edges use (`mergeGraph`).\n\n- Fully qualify names using the file's namespace and `use` aliases (class, function and const imports separately; PHP's fallback to global functions and constants).\n- Class references to resolve: `use` imports, `new X`, `X::`, `extends`, `implements`, trait `use` inside a class, type hints (parameters, returns, properties), `catch`, `instanceof`.\n- Resolution order: PSR-4 (longest prefix first), PSR-0 (namespace separators and underscores to directories), classmap (an index of classes declared under classmap paths), then same-repository declared classes when the name is unique.\n- Unresolved names become externals named per D5: `php:<first namespace segment>` (`php:Monolog` for `Monolog\\Logger`), or the PSR-0 prefix for un-namespaced names (`php:Zend` for `Zend_Db_Table`). Match the composer.lock package by autoload prefix into the in-memory `module` field. PHP's own built-in classes, interfaces and functions are not externals: keep a list in the pack with provenance to the php.net manual; extensions' functions are not externals either.\n- Add `packages/sourcevision/scripts/php-resolve-report.mjs`, mirroring python-resolve-report.mjs: internal resolution rate per corpus repository, unresolved names by count, and a random sample of 20 resolved and 20 unresolved references for hand-checking.\n\n**Operator note:** the operator runs the report on the corpus after the run and logs the numbers and the hand-checked sample with append_log."
acceptanceCriteria:
  - "Composer fixtures get file edges for use imports, extends/implements, trait use, new, static calls and type hints through PSR-4, PSR-0 and classmap"
  - "Unresolved names become php: externals per D5 with no built-in or extension names among them"
  - "PHP edges join the import graph only when the pack is installed; other output is byte-identical"
  - "The resolution report runs on the corpus and its numbers are logged"
priority: "high"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "lang-php"
  - "resolver"
blockedBy:
  - "a34d8b17-2c8d-49d8-8c29-d5ac378cfd0c"
---
