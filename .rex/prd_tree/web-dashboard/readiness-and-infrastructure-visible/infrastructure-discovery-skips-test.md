---
id: "0e544e97-efc8-456a-8951-15f30f9bfc18"
level: "task"
title: "Infrastructure discovery skips test fixtures"
status: "pending"
priority: "high"
source: "ndx-capture"
acceptanceCriteria:
  - "Files under test and fixture directories (e.g. tests/fixtures/**) are not reported as infrastructure resources"
  - "Analysing n-dx itself no longer lists aws_sqs_queue.order_events in infrastructure.json"
  - "A regression test covers a .tf file inside a fixture directory"
description: "n-dx's own .sourcevision/infrastructure.json lists aws_sqs_queue.order_events from packages/sourcevision/tests/fixtures/workspace-crossings/checkout-web/infra/main.tf: discovery in packages/sourcevision/src/analyzers/infrastructure.ts does not exclude test fixtures, so any view built on the artifact would show fake infrastructure."
lastModified: "2026-10-21T04:17:27.946Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
