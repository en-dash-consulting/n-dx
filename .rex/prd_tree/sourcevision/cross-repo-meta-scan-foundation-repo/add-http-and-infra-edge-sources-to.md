---
id: "c28d2b18-f2ba-4fec-9d70-759d31effa19"
level: "task"
title: "Add http and infra edge sources to workspace crossings"
status: "pending"
priority: "medium"
blockedBy:
  - "3122b944-2521-4559-8c40-ef066e5319fa"
  - "21c17d38-c771-4e30-9db4-281733055adc"
source: "ndx-capture"
acceptanceCriteria:
  - "`ZoneCrossing` carries `source: \"npm\" | \"http\" | \"infra\"` and an evidence field; existing npm crossings are tagged `\"npm\"` and otherwise unchanged."
  - "An outbound http dependency whose target host matches another member's `serverRoutes` produces an `http` crossing with evidence naming both sides."
  - "An outbound dependency whose `targetSource` is `env` matches against another member's declared base URL in config and produces an `http` crossing, or is withheld with a stated reason when the match is below the agreed confidence threshold."
  - "Two members referencing the same infrastructure resource id, or the same queue/topic/bucket name, produce an `infra` crossing with evidence from both members' `infrastructure.json`."
  - "`sv workspace --status` prints edge counts broken down by source."
  - "A fixture of two tiny members under `packages/sourcevision/tests/fixtures/` — A calling B over HTTP via an env var, both reading one Terraform SQS queue — yields all three edge sources with evidence, asserted in a test beside `workspace-*.test.ts`."
  - "No second aggregator is introduced; all edge derivation stays in `workspace-crossings.ts`."
description: "`analyzers/workspace-crossings.ts` today derives cross-repo `ZoneCrossing`s from one signal: an npm import matching a sibling member's package name. Add two more edge sources beside it, in the same aggregator:\n\n(a) **http** — an outbound http target whose host, or whose env-var name, matches another member's `serverRoutes` or its declared base URL in config.\n(b) **infra** — two members referencing the same infrastructure resource id, or the same queue/topic/bucket name.\n\nEvery crossing carries `source: \"npm\" | \"http\" | \"infra\"` plus the evidence that produced it. `sv workspace --status` prints edge counts broken down by source.\n\nOpen questions to settle here: how to match env-var names to producers reliably (name conventions differ between caller and callee), and what confidence threshold a crossing must clear before it is emitted at all."
assignee: "Sterling H <sterling.h@endash.us>"
lastModified: "2026-10-06T22:01:02.234Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
