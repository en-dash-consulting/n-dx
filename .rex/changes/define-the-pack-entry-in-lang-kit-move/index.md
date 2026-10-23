---
id: "a195dc83-33b1-4dbd-a7c4-204b7608b8be"
type: "change"
title: "Define the pack entry in lang-kit, move Java and Go into their packs, and load packs at run time"
slug: "define-the-pack-entry-in-lang-kit-move"
intent: "The design-sensitive task of 12a: what a pack package hands sourcevision, and how sourcevision finds it. PR 13 (Terraform model) and the later TS/JS port build on this entry, so design it carefully.\n\n1. The pack entry, in @n-dx/lang-kit (next to pack-contract.ts, exported from the barrel). The one object a pack package exports (for example `export const pack: LanguagePackEntry`). It carries the package name, the language id, its LanguageConfig, the fact kinds it produces, and one project-level call: given the project directory and the project-relative paths of its files for this language (the inventory's), return FileFacts per parsed file, the paths it could not parse, and, when it could not run at all, a degraded notice. Everything a pack can fail on today (grammar missing or not loadable, a query that will not compile, build files that cannot be read) comes back as that notice; the pack never throws for them. Resolution needs the whole project, so the call is per project, not per file. No tree-sitter type appears in the entry. Document what each field means for a pack that is not tree-sitter based (a TS/JS pack on the TypeScript compiler, a SCIP tier).\n\n2. @n-dx/lang-java and @n-dx/lang-go (scaffolded; dependencies on lang-kit and lang-runtime already in place). git mv into each: the pack definition (java-pack.ts / go-pack.ts), the resolver (java-resolver.ts / go-resolver.ts), the embedded-SQL reader (java-sql.ts / go-sql.ts), the query directory (src/language/queries/java|go → packages/lang-*/queries/<lang>), the pack's symbol rules and (Java) anonymous-body rule from sourcevision's tables, and the pack's goldens, fixtures and tests (tests/fixtures/language-packs/java|go, java-pack-queries, java-resolver, go-pack-queries, go-resolver and the Java/Go parts of language-pack-goldens and pack.test.ts). Each pack builds its own grammar into its own build/grammars with lang-runtime's build script (a `build:grammars` script in the pack; CI and release build every pack's grammar before tests and publish) and finds its grammar and queries from its own package root (the way sourcevision's package-paths.ts does today, lazily, without the global URL constructor). java-sql and go-sql need sql-references.ts: move it to @n-dx/lang-kit (pure text) so no pack depends on another pack.\n\n3. sourcevision's loader (for example src/language/pack-loader.ts) replaces BUILTIN_PACKS: for each pack it knows by name (literal specifiers `@n-dx/lang-java`, `@n-dx/lang-go`, so the vitest aliases apply), it looks first in the per-user pack directory `<resolveNdxHome()>/packs/<sourcevision version>/node_modules/@n-dx/lang-<id>` (resolveNdxHome from @n-dx/llm-client), then in normal module resolution, and imports it dynamically. Before using a pack it compares the pack's package.json version with sourcevision's own: a mismatch is refused with a notice naming the pack, both versions and the command that fixes it (`npm install --prefix <that dir> @n-dx/lang-<id>@<sourcevision version>`). A missing pack degrades its language like a missing grammar does today, with one notice naming the same install command: Java gets inventory only; Go keeps today's regex fallback (analyzers/imports.ts's fallbacks map). Make the pack directory and the import function injectable so tests cover: found in the pack dir, found by resolution, missing, version mismatch. analyzers/pack-imports.ts consumes the entry's facts; the edges, externals, degraded list and notices stay byte-identical.\n\nKeep: the corpus and comparison scripts (java-corpus-report, go-corpus-report, java-scip-compare, database/sql reports) stay in packages/sourcevision/scripts and import the packs from the workspace. No dependency changes in any package.json (all are wired). sourcevision may still import @n-dx/lang-runtime for SQL until the next task. Do not touch rex, hench, core or web source.\n\nVerify: Java and Go corpus reports give PR 11's numbers; lang-java, lang-go, lang-kit, lang-runtime and sourcevision tests pass; root policy suites pass. Append the corpus numbers to this task's log."
acceptanceCriteria:
  - "@n-dx/lang-kit exports the pack entry type; `git grep -nEi \"tree-sitter|Capture\\b|GrammarLocator\" packages/lang-kit/src` finds nothing"
  - "packages/sourcevision/src/language has no java-*, go-pack, go-resolver or go-sql module and no queries/java or queries/go; packages/lang-java and packages/lang-go hold them and each exports one pack entry"
  - "`git grep -n \"BUILTIN_PACKS\" packages/sourcevision/src` finds nothing; the loader's tests cover pack dir, resolution, missing pack and version mismatch"
  - "Without the Java pack a Java fixture gets inventory and one notice naming the install command; without the Go pack Go edges come from the regex parser (tests)"
  - "The Java corpus report gives 99.93% clean and the Go corpus report 98.69% clean, import parity 3130/3131, edge parity pack 13077 edges / 11537 external pairs"
  - "`cd packages/lang-java && npx vitest run` and `cd packages/lang-go && npx vitest run` pass with the moved goldens unedited"
  - "No package.json dependency changes"
touches:
  - "2bc7ded9-e12e-4297-bdca-42355e4c7645"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "language-packs"
  - "lang-runtime"
  - "lang-java"
  - "lang-go"
  - "pack-contract"
  - "pr-12a"
source: "roadmap"
blockedBy:
  - "ca4bde1e-6f52-43b8-a8d1-d75ef044d56a"
---
