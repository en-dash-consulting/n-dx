---
id: "aac5fad8-89d8-4cd4-8e2e-d1edf328c2ad"
type: "task"
title: "Scaffold @n-dx/lang-php with the pinned tree-sitter-php grammar and register it as an opt-in pack"
slug: "scaffold-n-dx-lang-php-with-the-pinned"
summary: "Create the PHP language pack package, build its PHP parser from a pinned release, and register it everywhere n-dx lists its language packs, so users can install it with one command."
description: "1. **Grammar subdirectory support.** tree-sitter-php keeps two grammars in one repository, under `php/` (PHP mixed with HTML) and `php_only/`. `packages/lang-runtime/scripts/build-grammars.mjs` assumes `src/parser.c` at the archive root. Add an optional `subdir` field to a `GRAMMARS` entry that points the build (and the parser.c / generate check) at that subdirectory, with a unit test. Add a `tree-sitter-php` entry using the `php/` subdirectory, with the version and SHA-256 given in the operator note below (never a value from memory).\n2. **Package.** Create `packages/lang-php` laid out like `packages/lang-python`: package.json (name `@n-dx/lang-php`, version equal to the other fixed-group packages, license, repository directory, exports, `files` including `queries` and `build/grammars/*.wasm`, scripts incl. `build:grammars` naming `tree-sitter-php`), tsconfig, vitest config, `AGENTS.md` with the pack's rules plus a one-line `CLAUDE.md` containing `@AGENTS.md`, README, `src/index.ts`, `src/pack.ts` and a `php-pack.ts` that loads the grammar and parses a file, but produces no facts yet. Dependencies: `@n-dx/lang-kit` and `@n-dx/lang-runtime` only.\n3. **Registration as an opt-in pack** — every place `lang-python` is registered: `KNOWN_PACKS` in packages/sourcevision/src/language/pack-loader.ts (no fallback parser; PHP files get inventory only without the pack), sourcevision's devDependency, `.changeset/config.json` fixed group, both `.github/workflows/release.yml` package lists, the `.github/workflows/ci.yml` suite group, `scripts/backfill-release-tags.mjs`, `tests/e2e/architecture-policy.test.js` `PACK_TIER`, `tests/e2e/domain-isolation.test.js`, packages/sourcevision/tests/e2e/packed-tarball.test.ts grammars, packages/sourcevision/tests/integration/optional-packs-hint.test.ts, and OPEN_SOURCE_SCOPE.md's package list. Add a patch changeset for the touched packages and the new one.\n\nThe pack must load and parse a PHP 5 fixture with inline HTML (`<?php … ?>` blocks between HTML) and a PHP 8 fixture. Without the pack installed, analyze output is unchanged.\n\n**Operator note:** the agent cannot install packages or download. The operator fills in the tree-sitter-php version and SHA-256 here before the run, runs `pnpm install` after the run and commits the lockfile change, then builds the grammar with `pnpm --filter @n-dx/lang-php build:grammars`. Grammar tests that need the WASM skip when it is absent, as lang-python's do."
acceptanceCriteria:
  - "build-grammars.mjs builds a grammar from a subdirectory of its release archive, covered by a unit test"
  - "@n-dx/lang-php exists, depends only on lang-kit and lang-runtime, and is registered in every list lang-python is registered in"
  - "With the grammar built, the pack parses a PHP 5 file with inline HTML and a PHP 8 file"
  - "Without the pack, analyze output is unchanged"
priority: "high"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "lang-php"
  - "lang-runtime"
---
