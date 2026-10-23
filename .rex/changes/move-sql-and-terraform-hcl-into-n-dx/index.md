---
id: "b782c83c-46f4-4610-b000-a12864198aa5"
type: "change"
title: "Move SQL and Terraform (HCL) into @n-dx/lang-sql and @n-dx/lang-terraform"
slug: "move-sql-and-terraform-hcl-into-n-dx"
intent: "After this task no grammar is built into sourcevision. Follow the pattern the Java and Go packs set in the previous task (pack entry from @n-dx/lang-kit, grammar and queries found from the pack's own root, `build:grammars` through lang-runtime's script, goldens and tests inside the pack).\n\n@n-dx/lang-sql (opt-in): git mv src/language/sql-pack.ts, src/language/sql-schema.ts, src/language/queries/sql, the SQL symbol rules (table names as symbols of kind \"table\"), and the tests that parse SQL with the grammar (sql-schema tests, the SQL parts of the goldens and pack-facts tests, the spring-petclinic-sql fixture if only they use it). Export a pack entry that produces \"symbols\". sql-dialects.ts, sql-migrations.ts and database-engines.ts are pure text and stay in sourcevision; if one of them needs table names from the grammar, it receives them through lang-kit facts, not by importing the pack. The SQL tables the analysis pipeline does not use today stay unused: nothing new is wired into analyze.\n\n@n-dx/lang-terraform (opt-in, structure only): the HCL grammar pin and its build move to this pack's build/grammars; the tests that load tree-sitter-hcl (grammar and Terraform structure tests) move here. Export a pack entry that produces no fact kinds yet; PR 13 adds the Terraform model and its resources facts. Terraform detection, inventory and the Terraform file set stay in @n-dx/lang-kit and sourcevision as they are; infrastructure.ts and IAC_KINDS are untouched.\n\nThe corpus scripts (sql-corpus-report.mjs, tf-corpus-report.mjs, database-corpus-report.mjs) stay in packages/sourcevision/scripts and import the packs from the workspace. lang-runtime's build script with no arguments now builds nothing into sourcevision: each grammar belongs to exactly one pack. CI and release build every pack's grammar.\n\nNo package.json dependency changes. Do not touch rex, hench, core or web source, or analyzers/infrastructure.ts.\n\nVerify: the SQL and Terraform corpus reports and database-corpus-report give the same output as before this task (diff them, ignoring timing lines); lang-sql, lang-terraform and sourcevision tests pass; root policy suites pass."
acceptanceCriteria:
  - "packages/sourcevision/src/language has no sql-pack.ts, sql-schema.ts or queries/ directory; packages/lang-sql and packages/lang-terraform hold the SQL and HCL grammar code, queries and tests"
  - "`ls packages/sourcevision/build/grammars 2>/dev/null` is empty after a clean `pnpm -r run build:grammars`, and each of lang-java, lang-go, lang-sql, lang-terraform has its own build/grammars/*.wasm"
  - "sql-corpus-report, tf-corpus-report and database-corpus-report output is identical to the previous task's apart from timing lines"
  - "`cd packages/lang-sql && npx vitest run` and `cd packages/lang-terraform && npx vitest run` pass with moved goldens unedited"
  - "`git diff HEAD~1 -- packages/sourcevision/src/analyzers/infrastructure.ts` is empty and no package.json dependency changes"
touches:
  - "2bc7ded9-e12e-4297-bdca-42355e4c7645"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "language-packs"
  - "lang-sql"
  - "lang-terraform"
  - "pr-12a"
source: "roadmap"
blockedBy:
  - "a195dc83-33b1-4dbd-a7c4-204b7608b8be"
---
