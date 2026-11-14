---
id: "2de61a9f-a479-4873-b203-9f38169e7401"
type: "change"
title: "Resolve legacy PHP includes"
slug: "resolve-legacy-php-includes"
summary: "Follow the include and require statements that old PHP 5 code uses instead of Composer, including include paths and old-style autoloaders, and report the includes that are built at run time instead of guessing. Most of the client's legacy repositories are wired this way."
intent: "PR 4 of the PHP language-pack stack, stacked on PR 3. Resolves `include`/`require` (and `_once`) through the legacy resolution ladder: literal paths and `__DIR__`/`dirname(__FILE__)` forms, include-path roots, docroot- and repo-relative lookups, a declared-type index for un-namespaced classes (precedent: packages/sourcevision/src/analyzers/csharp-imports.ts), literal patterns in `spl_autoload_register`/`__autoload` bodies, and dynamic includes reported as notices with literal-prefix candidates (D3).\n\nLane rules (PHP pack; decisions made 2026-11-12):\n- D3: ImportGuard `conditional` marks includes inside `if`/`else`/`switch`, inside a function or method body, or behind `function_exists`/`class_exists`/`defined` checks. Dynamic includes with a literal prefix carry candidate files that NEVER become import edges, so zones do not change because of them.\n- Anything built from variables is counted with its location, never guessed.\n- Analyze output stays byte-identical for every repository without PHP files, and for PHP repositories without the pack.\n- LS16: no PHP toolchain; php.ini and .htaccess are read as text.\n- Agents cannot use the network, run `pnpm install`, read `~/.cache`, or write under `.claude/`. The operator does those steps.\n- Record measurements with append_log on the task.\n- Patch changesets with scoped package names.\n- Before finishing, run the six static root policy tests: tests/e2e/architecture-policy.test.js, domain-isolation.test.js, shell-spawn-inventory-policy.test.js, wall-clock-inventory-policy.test.js, layout-literal-policy.test.js, obfuscated-code-policy.test.js."
acceptanceCriteria:
  - "Literal and __DIR__/dirname(__FILE__) includes, include-path roots and PSR-0 style class names resolve to file edges in PHP 5 code without Composer"
  - "Dynamic includes are reported as notices with locations, and literal-prefix ones carry candidate files that are not import edges"
  - "A resolution report gives the include resolution rate per legacy corpus repository, with a hand-checked sample logged"
amends: [{"target":"76778b68-080b-4c18-83e7-f4c4e0407291","delta":"added","summary":"Resolve legacy PHP includes","criteria":{"add":[{"id":"php-include-edges","text":"Computable includes and legacy class names resolve to file edges"},{"id":"php-dynamic-includes","text":"Dynamic includes are counted with locations, never guessed"}]},"proposed":"Sourcevision resolves include and require statements in PHP code without Composer through literal paths, include-path roots, PSR-0 style class names and literal autoloader patterns, and reports dynamic includes as notices with literal-prefix candidates that are never import edges.","under":"58f0468b-33ce-46ee-b507-c95261f152b6","title":"Resolve legacy PHP includes","type":"capability"}]
priority: "high"
tags:
  - "php"
  - "lang-php"
  - "php-pr4"
blockedBy:
  - "78cf4f7d-2b28-4263-bde2-bbc7995f7632"
---
