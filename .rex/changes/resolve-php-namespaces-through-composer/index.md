---
id: "78cf4f7d-2b28-4263-bde2-bbc7995f7632"
type: "change"
title: "Resolve PHP namespaces through Composer"
slug: "resolve-php-namespaces-through-composer"
summary: "Connect PHP files to each other the way Composer's autoloader does, so modern PHP projects get a real dependency graph, and name outside libraries consistently. This turns parsed PHP into the import edges zones and findings rely on."
intent: "PR 3 of the PHP language-pack stack, stacked on PR 2. Adds a Composer reader to lang-kit (beside the Maven, Gradle and pyproject readers, read as text per LS16) and the namespace resolver in `@n-dx/lang-php`: `use` imports and class references resolve through PSR-4, PSR-0 and classmap to file edges that join the import graph through the same path as Go, Java and Python. Unresolved names become externals named per D5.\n\nLane rules (PHP pack; decisions made 2026-11-12):\n- D5: externals are named as written: `php:<first namespace segment>`, or the PSR-0 prefix for un-namespaced classes (`php:Zend` from `Zend_Db_Table`). The Composer package (from composer.lock autoload prefixes) goes in the in-memory `module` field. PHP extensions and PHP's own built-in classes and functions are not externals.\n- Analyze output stays byte-identical for every repository without PHP files, and for PHP repositories without the pack.\n- LS16: no PHP toolchain and no `composer install`; composer.json and composer.lock are read as text. LS3/LS4: no versions from memory.\n- Agents cannot use the network, run `pnpm install`, read `~/.cache`, or write under `.claude/`. The operator does those steps.\n- Record measurements with append_log on the task.\n- Patch changesets with scoped package names.\n- Before finishing, run the six static root policy tests: tests/e2e/architecture-policy.test.js, domain-isolation.test.js, shell-spawn-inventory-policy.test.js, wall-clock-inventory-policy.test.js, layout-literal-policy.test.js, obfuscated-code-policy.test.js."
acceptanceCriteria:
  - "Composer projects get file-to-file import edges from use imports and class references through PSR-4, PSR-0 and classmap"
  - "Unresolved PHP names appear as php:-namespaced externals per D5, with no extension or built-in names among them"
  - "A resolution report gives the internal resolution rate per Composer corpus repository"
amends: [{"target":"532cf1ec-2850-4771-9a9e-446e5a36234c","delta":"added","summary":"Resolve PHP namespaces through Composer","criteria":{"add":[{"id":"php-composer-edges","text":"Composer projects get file edges from use imports and class references"},{"id":"php-externals","text":"Unresolved names become php: externals named as written, never PHP built-ins or extensions"}]},"proposed":"Sourcevision resolves PHP use imports and class references through Composer's PSR-4, PSR-0 and classmap rules into file-to-file import edges, and names unresolved packages as php:-namespaced externals.","under":"58f0468b-33ce-46ee-b507-c95261f152b6","title":"Resolve PHP namespaces through Composer","type":"capability"}]
priority: "high"
tags:
  - "php"
  - "lang-php"
  - "php-pr3"
blockedBy:
  - "fd04acac-099e-4ea0-8364-84298a85678a"
---
