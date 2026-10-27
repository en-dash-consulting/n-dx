---
id: "6dceff60-d0b6-4d6e-894e-f6117d039cf3"
type: "change"
title: "CI never builds the Java grammar, so every grammar-dependent runner and grammar test skips there and the runner's acceptance criteria are unverified in CI"
slug: "ci-never-builds-the-java-grammar-so"
intent: "Verdict: should-fix. Found by the adversarial review of task 6b72bf55 (tree-sitter runner).\n\n**Failure scenario.** `.github/workflows/` never runs `scripts/build-grammars.mjs`, so `build/grammars/tree-sitter-java.wasm` does not exist on any CI runner. Both test files skip with `ctx.skip(NOT_BUILT)` when the grammar is missing:\n- `packages/sourcevision/tests/unit/language/runner.test.ts` skips 11 of its 13 tests;\n- `tests/integration/tree-sitter-java-grammar.test.ts` skips as well.\n\nUnaffected: only the two size-limit tests run.\n\nUntested in CI: captures, ERROR/MISSING reporting, init-once, freeing trees and queries, and dispose safety. A regression in any of these goes green on all three OSes, and it is caught only on a developer machine that happens to have built the grammar.\n\n**Reachability.** Every PR that touches `src/language/runner.ts` is affected, and so is any future pack query.\n\n**In scope?** The skip-when-unbuilt pattern predates this change (the grammar build task). The runner change relies on it for nearly all its coverage.\n\n**Options.**\n1. Add a CI step that runs `node packages/sourcevision/scripts/build-grammars.mjs`, caching `packages/sourcevision/build/cache`, on one OS (linux-x64), and set an env flag such as `SV_REQUIRE_GRAMMARS=1` that turns `ctx.skip` into a failure. Cost: one workflow step, plus a first-run download of the pinned CLI and the wasi-sdk. Risk: a network dependency in CI, which the SHA pins and the cache mitigate. **Recommended.**\n2. Fold this into the sibling task \"Published sourcevision has no grammars\": if prepublish builds grammars, CI could reuse that step. Cost: couples a test-coverage fix to a release decision that is still open."
acceptanceCriteria:
  - "CI (.github/workflows/ci.yml) builds tree-sitter-java.wasm with packages/sourcevision/scripts/build-grammars.mjs before the sourcevision suite on at least one OS, using the verified download cache"
  - "On that CI job, tests/unit/language/runner.test.ts reports 0 skipped tests"
  - "On that CI job, tests/integration/tree-sitter-java-grammar.test.ts reports 0 skipped tests"
  - "A grammar-dependent test that skips on a CI job meant to have the grammar fails the job instead of passing silently"
touches:
  - "55f064ef-c74a-4c5f-b006-5286ce0f42cf"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "language-packs"
  - "sourcevision"
source: "ndx-adversarial-review"
---
