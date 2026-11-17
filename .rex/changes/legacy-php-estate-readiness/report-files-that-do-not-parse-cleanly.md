---
id: "7ffab98a-95f7-4d90-86df-e3aad31a3a3c"
type: "task"
title: "Report files that do not parse cleanly, per language pack"
slug: "report-files-that-do-not-parse-cleanly"
summary: "Tell the user which files the parser could not read properly, with counts and examples, instead of silently using partial results or skipping them."
description: "**Problem.** A legacy estate has files tree-sitter cannot parse cleanly, and the scan has to say which, per repository. Today:\n- a file with syntax errors parses with ERROR/MISSING nodes and is counted as parsed (`packages/lang-runtime/src/pack-entry.ts`; `runner.ts` already computes `hasErrorNodes`/`hasMissingNodes`); facts are read from the partial tree and nothing records the problem;\n- a file over the runner's 1 MiB limit (`DEFAULT_MAX_FILE_BYTES`) is skipped into `unparsed`, and only Go uses `unparsed` downstream (`analyzers/imports.ts`); nothing in the output names it;\n- an unreadable file goes to `unparsed` silently;\n- files are read as UTF-8, so latin-1 or mixed-encoding PHP decodes with replacement characters; that never throws (good) but is not counted.\n`sdlc-profile.json` `parseFailures` covers CI definitions only.\n\n**Fix.** For every tree-sitter pack (generic in lang-runtime and sourcevision, not PHP-only), report parse outcomes per language:\n- counts: files parsed cleanly, parsed with syntax errors, skipped over the size limit, unreadable, and not valid UTF-8 (still parsed);\n- up to 50 example paths per non-clean kind, sorted, with the total;\n- written to `imports.json` `summary.parseIssues`, keyed by pack id, present **only when at least one file is not clean**, so a repository whose files all parse cleanly keeps byte-identical output;\n- one notice line per language through the existing pack-notice channel, e.g. `[php-parse] 3 of 1,204 files have syntax errors; 2 over 1 MiB not parsed; 5 not UTF-8`;\n- never fatal: facts from error-node files are still used, as today.\n\nName the field in the change log for Hal's contract review (new artifact field).\n\n**Tests:** an invented PHP fixture with a syntax-error file, a file over the limit (generate it in the test rather than committing 1 MiB), a latin-1 file, invalid UTF-8 bytes and a clean file; assert the counts, the example paths, the notice, exit 0, and that a clean-only fixture's `imports.json` has no `parseIssues`. Check one existing Go or Java golden stays identical."
acceptanceCriteria:
  - "imports.json summary.parseIssues counts syntax-error, oversized, unreadable and non-UTF-8 files per pack, with up to 50 example paths"
  - "The field is absent when every file parses cleanly"
  - "One notice line per language reports the counts"
  - "Parse problems are never fatal"
priority: "high"
run: {"tier":"standard","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "lang-runtime"
  - "sourcevision"
  - "estate-readiness"
  - "php-pr12"
blockedBy:
  - "0db6172b-4827-4226-98b5-60ca5841656c"
---
