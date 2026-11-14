---
id: "5fac5b23-077d-40dd-a1d7-c9d1d9b7c20c"
type: "task"
title: "Split CI's hench+web test group into separate hench and web jobs"
slug: "split-ci-s-hench-web-test-group-into"
summary: "The Windows job that runs hench's and the web dashboard's tests together keeps hitting its 20-minute limit and showing red, though the tests pass. Running the two suites as separate jobs ends those false failures and finishes sooner."
description: "CI on the validation gate stack, 2026-11-13: \"Tests (Windows, hench+web)\" was cancelled at its 20-minute timeout on #1030, #1034 and #1035. On every one of those runs all hench tests passed. The hench suite took 703–711 s on Windows (about 569 s on main), and the web suite (~400 s) then ran past the limit. On main this job already takes 13–19 minutes.\n\nChange `.github/workflows/ci.yml`'s `test` job matrix:\n- Replace the `hench+web` group with two groups: `hench` (suites `hench`) and `web` (suites `web`). Leave `root+llm-client` and `rex+sourcevision` unchanged. Job names become \"Tests (<runner>, hench)\" and \"Tests (<runner>, web)\".\n- Update the comments that count the legs (\"nine\" → twelve) and the Windows timeout comment so they stay accurate. Keep the Windows timeout at 20.\n- Make the same split in `.github/workflows/release.yml`'s test matrix (around lines 65–70) so release and CI agree.\n- Check `scripts/grammar-suites.mjs`, `tests/e2e/ci-grammar-steps.test.js` and any other test that parses the workflow matrices, and update them so they pass with the new groups. Search tests for `hench+web` and for parsing of `matrix.group`.\n\nDo not touch branch protection or rulesets: the operator updates the required checks (`Tests (… , hench+web)` → `Tests (…, hench)` and `Tests (…, web)`) when this merges. Say in the summary that this is needed.\n\nOperator notes: no workflow can run locally. Validate the YAML by parsing it, for example with node and a YAML parser already in the repo. Run the root e2e tests that read the workflows and the static root policy tests. No changeset."
acceptanceCriteria:
  - "ci.yml and release.yml run hench and web as separate matrix groups on every OS; the other groups are unchanged"
  - "Workflow-reading tests (ci-grammar-steps and any matrix checks) pass with the new groups; comments counting legs are accurate"
  - "The summary names the required-check renames the operator must make in the main ruleset"
priority: "high"
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-1-worker-cap"
  - "ci"
source: "ndx-capture"
---
