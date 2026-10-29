---
id: "4eff15bb-269f-40f0-bc34-cee4ee243b17"
type: "task"
title: "diagnoseTaskRun's ndx argv is untested, so a wrong spawn reads as a timeout gap"
slug: "diagnosetaskrun-s-ndx-argv-is-untested"
description: "Verdict: should-fix (medium). diagnoseTaskRun (packages/web/src/server/routes-hench-prep.ts) spawns `ndx hench runs diagnose <id> --format=json <dir>`. No test pins that argv or its JSON parse: routes-hench-prep.test.ts mocks exec only for args containing \"work\", and the Sidecar tests fake SpawnedReads.diagnose. Scenario: a typo in the argv, or hench renaming the subcommand, makes every spawn fail. The packet then shows \"failed or timed out\" for every unclassified run, and no test fails. Reachable from every Diagnose run packet built for a run that has no recorded verdict. Fix: widen the exec mock filter to cover `runs diagnose`, then assert the argv, the parse of a valid object, the non-JSON failure, and the PREP_MAX_IN_FLIGHT refusal. Cost: a few test cases. Risk: none."
acceptanceCriteria:
  - "A routes-hench-prep test asserts diagnoseTaskRun spawns ndx with [\"hench\",\"runs\",\"diagnose\",<id>,\"--format=json\",<projectDir>]"
  - "A test asserts diagnoseTaskRun returns {ok:false} for non-JSON stdout and for a non-zero exit, and {ok:true, diagnosis} for a JSON object"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
