---
id: "081b727c-3280-4ec4-a1dd-a5abf3af1c41"
type: "task"
title: "A run verdict follows the cold retry's own signals, and a gate failure in unedited tests is not asserted pre-existing"
slug: "a-run-verdict-follows-the-cold-retry-s"
description: "Review findings F1 (https://github.com/en-dash-consulting/n-dx/pull/907#discussion_r4469225508) and F3 (https://github.com/en-dash-consulting/n-dx/pull/907#discussion_r4469225537) in packages/hench/src/agent/analysis/run-verdict.ts. F1: claimLost returns claim-lost whenever run.readOnlyRefusal is set, but cli-loop.ts sets that field when the forked attempt made no edits and re-spawns cold, and never clears it, so it overrides what the retry did (real runs 02e157c5 and dbb2a4ef). Drop that branch and keep the refusal as one evidence line on whichever class wins. F3: testGate falls through to test-gate-preexisting for any digest that names no changed path, though a run usually breaks a test by changing the source under it (runs 14a88ed9, 49c62bfa, 4547c974). Take option (a): stop asserting pre-existing without a baseline check."
acceptanceCriteria:
  - "A run with readOnlyRefusal and a failed gate naming a file the run changed is classed test-gate-new, not claim-lost (tested)"
  - "No rule returns a class from readOnlyRefusal alone; when present it is one evidence line on the class the rest of the record gives (tested)"
  - "claim-lost still comes from run.claimLost with the release-claim and re-run actions (existing tests pass)"
  - "A gate failure naming only test files the run did not edit keeps class test-gate-preexisting, says it failed in tests this run did not edit and was not checked on main, and offers only verify-on-main (tested)"
  - "The docs and the changeset describe the reworded pre-existing verdict; class ids are unchanged"
priority: "high"
---
