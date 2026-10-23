---
id: "b6ca93d3-fcf8-4965-9418-5ead8f5a96df"
type: "change"
title: "Build the tree-sitter grammars in CI's test job so grammar-gated tests run"
slug: "build-the-tree-sitter-grammars-in-ci-s"
intent: "Stack review (#762, must-fix): ci.yml builds grammars, caches them and exports SV_REQUIRE_GRAMMARS=1 in the build job, but the suites run in the separate test matrix job, which only installs, builds and runs scripts/run-all-tests.mjs. A GITHUB_ENV export reaches only later steps of the same job, so every skipUnlessGrammar test (pack goldens, java-pack-queries, runner tests, the grammar test) skips in CI. Move the grammar cache, the grammar build and the SV_REQUIRE_GRAMMARS=1 step into the test job, after its Build step and before the suites run, on every leg that runs the sourcevision suite (at least Linux; the other legs if the grammar build works there, else say why in the log). Keep the build job's copy only if a later step in that job needs grammars. Change only .github/workflows/ci.yml (and its comments); the session verifies a CI run shows the grammar tests executing."
acceptanceCriteria:
  - "ci.yml's test job builds the grammars and sets SV_REQUIRE_GRAMMARS=1 before the suites run"
  - "No grammar-gated test can skip in CI on a leg that runs the sourcevision suite"
touches:
  - "55f064ef-c74a-4c5f-b006-5286ce0f42cf"
priority: "high"
source: "review"
---
