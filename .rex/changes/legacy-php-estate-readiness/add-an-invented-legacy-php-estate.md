---
id: "845a96b6-0a33-4fe6-96fb-03a9a6369299"
type: "task"
title: "Add an invented legacy PHP estate fixture and an end-to-end --fast CLI test"
slug: "add-an-invented-legacy-php-estate"
summary: "Add a small made-up repository shaped like an old multi-tenant PHP estate and a test that analyses it from the command line, so these fixes stay fixed."
description: "**Operator note (2026-11-16, machine under heavy load):** run targeted tests only: the specific test files for the code you change, or one package's affected tests. No full suites, no `run-all-tests`, no fuzzing, no large generated repositories; small invented fixtures built in the test are fine. The six static root policy tests from the change's conventions are small and still required.\n\nThe end-to-end test is a single targeted test file over the small invented fixture.\n\n**Goal.** One invented fixture shaped like a legacy PHP estate, analysed end to end through the CLI with `--fast` in a test, so a regression in any of this change's fixes, or in the pack, fails CI.\n\n**Fixture** (`packages/sourcevision/tests/fixtures/php-legacy-estate/` or wherever the existing PHP integration fixtures live; all names and code invented, nothing resembling a real product):\n- `tenant-copy/`: a PHP 5.4-style single-tenant copy of an invented shared app, no Composer:\n  - `index.php` with an include chain at least 4 deep (`dirname(__FILE__)`, `.inc` and `.phtml` includes);\n  - `custom/` override files layered over shared `lib/` files, included conditionally;\n  - embedded SQL in `mysql_query` calls naming at least three invented tables, plus `mysql_connect`;\n  - `ereg`, `each()`, `create_function`, `$HTTP_POST_VARS`, a PHP 4 constructor, `var` properties;\n  - a short-open-tag template (`<?`, `<?=`) and an ASP-tag line;\n  - a latin-1 encoded file (bytes, not UTF-8) and a file with invalid UTF-8 bytes;\n  - a file with a syntax error;\n  - secret-shaped values: `define('DB_PASS', '<invented>')`, `$config['db']['password'] = '<invented>'`, an ini file with `password=<invented>`, and a `curl_init('https://user:<invented>@…')`;\n- `trunk/`: a PHP 8.1 app with `composer.json` (PSR-4), a committed `vendor/` with one invented package, enums, readonly properties;\n- keep the fixture small (well under 100 KB); generate anything large in the test.\nUse distinctive invented secret strings so the test can grep for them.\n\n**Test** (integration or e2e, following how existing PHP pack integration tests require or skip on the built grammar; `SV_REQUIRE_GRAMMARS` if that is the convention): copy the fixture to a temp dir, run the core CLI as child processes (not the in-process API): first `ndx init --no-llm --provider=claude --no-commit --git <dir>` (`node packages/core/cli.js`), then `ndx analyze --fast <dir>`; this pins the batch path a scan wrapper uses (`ndx init --no-llm`, then `ndx analyze --fast`). Run both with `TYPESAFE_API_KEY` set to a dummy value and a fake `claude`/`codex` on `PATH` that record calls. Assert:\n- exit 0;\n- PHP is detected (inventory languages, project profile);\n- includes resolve: the chain's edges and the override edges are in `imports.json`;\n- the invented SQL tables appear where the pack reports embedded SQL / database facts;\n- the legacy constructs are counted in `sdlc-profile.json` `ecosystem.php.legacyConstructs` (each rule above, including `$HTTP_*_VARS`);\n- the syntax-error, latin-1 and invalid-UTF-8 files are reported in `imports.json` `summary.parseIssues`, and the run did not fail;\n- no model or network call in either command and in every analyze phase: the fake CLIs were never called, no fetch was made (if the existing tests have a way to observe it), and no `claude_commands.log` exists in the project;\n- no secret value appears in any file under the analysis output directory, and config reads name the keys only.\n\nRecord the test's wall time with append_log."
acceptanceCriteria:
  - "The fixture is invented and under 100 KB"
  - "The CLI test asserts PHP detection, resolved includes, SQL tables, legacy counts and reported parse problems with exit 0"
  - "The test asserts no model call, no claude_commands.log and no secret value in any output file"
priority: "high"
run: {"tier":"standard","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "sourcevision"
  - "lang-php"
  - "test"
  - "estate-readiness"
  - "php-pr12"
blockedBy:
  - "e8389da6-6103-4c66-9144-c21e3e98a55f"
---
