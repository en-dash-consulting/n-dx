---
id: "a34d8b17-2c8d-49d8-8c29-d5ac378cfd0c"
type: "task"
title: "Composer reader in lang-kit"
slug: "composer-reader-in-lang-kit"
summary: "Read a PHP project's Composer files as plain text to learn how its classes map to folders and which outside packages it uses, without installing anything."
description: "Add `packages/lang-kit/src/php-composer.ts` beside the other build readers (python-build.ts, go-build.ts), read as text per LS16, never running Composer.\n\n- `composer.json`: `name`, `require`, `require-dev` (names and constraints as written), `autoload` and `autoload-dev` (`psr-4`, `psr-0` with string or array paths, `classmap`, `files`, `exclude-from-classmap`), `repositories` (`path` and `vcs` with url as written), `config.vendor-dir`.\n- `composer.lock`: each package's `name`, `version` (in memory only, never persisted), and its `autoload` block, so a namespace prefix can be matched to a package (decision D5's `module` field).\n- Several `composer.json` files in one repository (path repositories, monorepos): return one model per manifest with its directory.\n- Malformed JSON yields a notice and an empty model, never a throw.\n- Export through lang-kit's index like the other readers.\n\nUnit tests with fixtures for PSR-4 with multiple paths, PSR-0 with underscore-era prefixes (`Zend_`), classmap and files, a path repository, a lock file, and malformed JSON."
acceptanceCriteria:
  - "composer.json and composer.lock are read into a typed model covering require, autoload (psr-4, psr-0, classmap, files), repositories and vendor-dir"
  - "Several manifests in one repository each get their own model"
  - "Malformed files produce a notice instead of an exception"
priority: "high"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":120}
tags:
  - "php"
  - "lang-kit"
  - "composer"
---
