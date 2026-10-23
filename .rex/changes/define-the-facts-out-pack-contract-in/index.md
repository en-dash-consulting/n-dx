---
id: "8fab5dc4-b075-413f-ac9d-04f6d8ce812f"
type: "change"
title: "Define the facts-out pack contract in lang-kit and adapt the Java, Go and SQL packs through a sourcevision adapter"
slug: "define-the-facts-out-pack-contract-in"
intent: "Decision 2 with Sterling H: a pack's contract is facts out. Define in @n-dx/lang-kit the types a pack returns, and make sourcevision's existing tree-sitter packs (Java, Go, SQL) produce them through a sourcevision-side adapter. PR 12 (parser runtime, per-language pack packages) and PR 13 (the Terraform model) build on this contract and must be able to fill it without changing it, so design it carefully. Analysis output stays byte-identical.\n\nThe contract (a new lang-kit module, for example src/pack-contract.ts, exported from the barrel):\n- Per-file facts for one project-relative, forward-slash path. Produced fact kinds today: imports (file references and external references: move `FileReference`, `ExternalReference`, `ExternalModule` and `FileReferences` from sourcevision's src/language/pack.ts into lang-kit unchanged, and re-export or import them back in pack.ts), symbols (declared types, functions, methods: name, kind, position), and calls (callee, receiver and string arguments, matching what `groupCalls` in pack-calls.ts yields today, without tree-sitter node data).\n- Declared but not yet produced fact kinds: routes, components, outbound calls and resources. Define their types now (minimal, documented, optional on the per-file facts) so PR 12 and PR 13 fill them without a contract change.\n- A list of fact kinds, split into produced and declared, as data (for example `PRODUCED_FACT_KINDS` and `DECLARED_FACT_KINDS`), and a way for a pack to say which kinds it produces.\n- Positions use lang-kit's own `{ line, column }` type with the meaning documented in pack.ts's `SourcePosition` (one-based line, zero-based UTF-16 column).\n- No tree-sitter type in the contract: no `Capture`, node type, query name, grammar locator or anything from web-tree-sitter. Tree-sitter stays a helper inside sourcevision.\n- Keep `BuildFileReader` and `DeclaredDependency` out of the contract. Nothing uses them today (`git grep BuildFileReader` finds only pack.ts): remove them and the `buildReaders` slot from `LanguagePack`. `ModuleBuildModel` (already in lang-kit from task 2) is the one build-model shape; the contract may reference it for build facts.\n\nThe adapter (sourcevision, for example src/language/pack-facts.ts): runs a pack's captures (and, for imports, its resolver's `FileReferences`) into the per-file facts. Resolvers, runner.ts, pack.ts's loader, the *-pack.ts files, queries and grammars stay in sourcevision unchanged.\n- src/analyzers/pack-imports.ts consumes facts: `buildPackImportGraph` builds edges and externals from the imports facts the adapter returns, not from `PreparedResolver.resolve` directly. Same edges, same order, same externals, same symbols, same degradation notices.\n- Java and Go produce imports, symbols and calls facts. SQL produces the facts its table query supports; choose and document the mapping (for example table names as symbols of kind \"table\") so sql-schema.ts output is unchanged.\n- java-sql.ts and go-sql.ts may switch to the calls facts if it is a straight swap; otherwise they keep reading captures in this PR. Either way their output is byte-identical.\n\nVerify: Java, Go and SQL goldens and fixtures pass unedited; the Java, Go and SQL corpus reports give PR 10's numbers (Java 99.93% clean; Go on gitea 98.69% clean, import parity 3130/3131, edge parity pack 13077 edges / 11537 external pairs; the SQL report as before this task). Append the numbers to this task's log. Add lang-kit tests for the contract data and sourcevision tests for the adapter (facts for a small Java, Go and SQL source equal the captures' meaning)."
acceptanceCriteria:
  - "A lang-kit module exports the per-file facts type and PRODUCED/DECLARED fact-kind lists naming imports, symbols and calls as produced and routes, components, outbound calls and resources as declared"
  - "`grep -rnEi \"tree-sitter|Capture\\b|nodeType|GrammarLocator\" packages/lang-kit/src` finds nothing in the contract"
  - "`git grep -n \"BuildFileReader\\|DeclaredDependency\" packages` finds nothing"
  - "packages/sourcevision/src/analyzers/pack-imports.ts builds edges and externals from facts the adapter returns and no longer calls a PreparedResolver's resolve directly"
  - "`cd packages/sourcevision && SV_REQUIRE_GRAMMARS=1 npx vitest run` passes with no golden or fixture file edited (`git diff --stat HEAD~1 -- packages/sourcevision/tests/fixtures '*golden*'` empty)"
  - "The Java corpus report gives 99.93% clean and the Go corpus report gives 98.69% clean, import parity 3130/3131, edge parity pack 13077 edges / 11537 external pairs"
  - "`cd packages/lang-kit && npx vitest run` and the root policy suites in the feature description pass"
touches:
  - "62f9bb19-c606-422d-b643-a4877b6dfcfd"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "language-packs"
  - "lang-kit"
  - "pack-contract"
  - "sourcevision"
  - "pr-11"
source: "roadmap"
blockedBy:
  - "4a1a2c31-7f1c-49fc-bfd8-2c8355893b53"
---
