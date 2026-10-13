---
id: "ca4bde1e-6f52-43b8-a8d1-d75ef044d56a"
level: "task"
title: "Move the tree-sitter runtime into @n-dx/lang-runtime"
status: "pending"
priority: "high"
tags:
  - "language-packs"
  - "lang-runtime"
  - "sourcevision"
  - "pr-12a"
source: "roadmap"
acceptanceCriteria:
  - "packages/sourcevision/src/language/runner.ts and pack-calls.ts no longer exist and packages/lang-runtime/src holds them; `git grep -n \"web-tree-sitter\" packages/sourcevision/src` finds nothing"
  - "`git grep -n \"sourcevision\" packages/lang-runtime/src packages/lang-runtime/scripts` finds no path into the sourcevision package other than the build script's default output directory"
  - "loadLanguagePacks takes the grammar directory from its caller, and its notices are byte-identical (existing notice tests pass unedited)"
  - "`node packages/lang-runtime/scripts/build-grammars.mjs` builds the four grammars into packages/sourcevision/build/grammars by default and into another directory when asked; ci.yml and release.yml call it"
  - "`cd packages/lang-runtime && npx vitest run` passes, and the Java, Go and SQL corpus reports give PR 11's numbers"
  - "No package.json dependency changes: `git diff HEAD~1 -- 'packages/*/package.json'` touches only the sourcevision build:grammars script line"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "Move sourcevision's language-neutral tree-sitter machinery into packages/lang-runtime (@n-dx/lang-runtime, already scaffolded with web-tree-sitter and @n-dx/lang-kit as dependencies). sourcevision then imports it from @n-dx/lang-runtime (already a devDependency). The packs themselves stay in sourcevision until the next tasks; nothing about which languages are analysed changes.\n\nMoves (git mv; replace the placeholder export in src/index.ts with a barrel):\n- packages/sourcevision/src/language/runner.ts.\n- From src/language/pack.ts, the tree-sitter pack shape and the grammar check: GrammarLocator, PackQuery, RuleProvenance, Capture, PackSourceFile, PackResolver, PreparedResolver, FrameworkPack, PreciseIndexSource, the LanguagePack interface, PackMode, PackStatus, LoadPacksOptions, inventoryOnlyOutcome and loadLanguagePacks. `BUILTIN_PACKS` and the imports of go-pack/java-pack stay in sourcevision (a small src/language/pack.ts or a builtin-packs module). loadLanguagePacks' `grammarDir` default and the missing-grammar step text read sourcevision's paths today: make the grammar directory a required option or a property the caller supplies, so the runtime holds no package path of sourcevision's, and keep the notice text byte-identical.\n- src/language/pack-calls.ts.\n- The language-neutral half of src/language/pack-facts.ts: the SymbolRule type and machinery, readSymbols, factGaps and readPackFacts. The rule tables (SYMBOL_RULES' java/go/sql entries, ANONYMOUS_BODIES) are pack data: pass them in (for example as a field on LanguagePack, or an argument) and keep the tables in sourcevision for now; the next tasks move each into its pack.\n- packages/sourcevision/scripts/build-grammars.mjs → packages/lang-runtime/scripts/build-grammars.mjs, keeping every pin and SHA. Give it an output-directory option (and per-grammar selection) so each pack can later build its own grammar into its own build/grammars; with no option it still writes packages/sourcevision/build/grammars, so nothing else changes in this task. sourcevision's `build:grammars` script calls it. Update .github/workflows/ci.yml and release.yml (the grammar cache key's hashFiles path and the build step) to the new path. `grammarWasmPath` and anything else the tests import from the script come along.\n- tests/helpers/grammar.ts (skipUnlessGrammar and friends) and tests/helpers/pack-golden.ts become exports of lang-runtime (src/testing.ts or similar, exported from the barrel) so the pack packages can use them; sourcevision's tests import them from @n-dx/lang-runtime. Move the unit tests of moved modules (runner.test.ts, pack-calls.test.ts, pack-golden.test.ts, the generic parts of pack.test.ts) to packages/lang-runtime/tests.\n\nKeep:\n- @n-dx/lang-kit stays free of tree-sitter types; the runtime imports only @n-dx/lang-kit from n-dx (the pack-tier boundary test enforces it).\n- sourcevision keeps its own web-tree-sitter dependency for now (removing it needs a lockfile change; the last task of this feature does that with the operator).\n- No dependency added or removed in any package.json.\n\nVerify: rebuild; lang-runtime and sourcevision tests pass; the root policy suites pass; the Java, Go and SQL corpus reports (packages/sourcevision/scripts) give PR 11's numbers."
lastModified: "2026-10-13T16:49:11.922Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
