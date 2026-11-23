---
id: "01376afa-1f03-4da1-b42e-2baef55d2c9b"
type: "change"
title: "Legacy PHP estate readiness"
slug: "legacy-php-estate-readiness"
summary: "Make a static scan of a large legacy PHP estate safe: no model or network calls, no secret values written, no reading or writing outside each repository, and problem files reported instead of breaking the scan."
intent: "PR 12 of the PHP language-pack stack, stacked on PR 11 (#1082). Ryan will run `sv analyze` (and `ndx init` + `ndx analyze` through a batch wrapper) over a large legacy-PHP estate: hundreds of repositories, several GB, PHP 5 to 8, tenant forks with override files wired by include chains, no Composer in older copies, `.inc`/`.phtml` templates, embedded SQL and `mysql_*`, committed vendor folders, SQL dumps and binaries. The scan must be static-only, must degrade per file and never per repository, must stay inside each repository, and must never write a secret value.\n\nAn investigation on invented probe repositories (2026-11-16) found these gaps, one task each:\n- `--fast` still sends Jev judgment requests when a TypeSafe key is set, and leaves `claude_commands.log` at the project root;\n- `ndx init` always spawns `claude --version` and a live `claude -p` auth probe, with no way to skip them;\n- files tree-sitter parses with syntax errors, files skipped over the 1 MiB parser limit and files that are not valid UTF-8 are not reported anywhere;\n- `$HTTP_*_VARS` is not counted as a legacy construct;\n- zone sub-analysis discovery and `--deep` follow directory symlinks out of the project (merging another project's zones, and writing into it), and two self-referencing links hang analyze;\n- an HTTP target with `user:password@` is written whole to `outbound.json`;\n- minified bundles are parsed by the call graph (twenty 2.7 MB bundles gave 1.4 million functions and a 260 MB `callgraph.json`).\nThe last task adds an invented legacy-estate smoke fixture and an end-to-end CLI test over it.\n\nLane rules (PHP pack; decisions made 2026-11-12):\n- Every fixture is invented. No real project, company, repository name or code goes into a fixture, test, log or commit.\n- Analyze output stays byte-identical for repositories the fixes do not touch: a repository with no symlinks, no parse problems, no credentialed URL, analysed as before.\n- Agents cannot use the network, run `pnpm install`, read `~/.cache`, or write under `.claude/`. The operator does those steps.\n- Record measurements with append_log on the task.\n- Patch changesets with scoped package names, at the current fixed-group version.\n- Before finishing, run the six static root policy tests: tests/e2e/architecture-policy.test.js, domain-isolation.test.js, shell-spawn-inventory-policy.test.js, wall-clock-inventory-policy.test.js, layout-literal-policy.test.js, obfuscated-code-policy.test.js."
acceptanceCriteria:
  - "sv analyze --fast makes no model call and no network request, even with a TypeSafe key set, and writes no claude_commands.log"
  - "ndx init --no-llm initializes a repository with no model call"
  - "No analysis reads, writes or reports anything outside the project root through a symlink, and symlink loops cannot hang it"
  - "No secret value appears in any output file"
  - "Files that fail to parse cleanly are counted and listed, never fatal"
  - "An invented legacy-estate fixture is analysed end to end through the CLI in a test"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "high"
tags:
  - "php"
  - "lang-php"
  - "php-pr12"
  - "estate-readiness"
blockedBy:
  - "e2fb42b1-e547-4682-a2ef-176d0e7d7857"
---
