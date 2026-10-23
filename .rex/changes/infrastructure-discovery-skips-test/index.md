---
id: "0e544e97-efc8-456a-8951-15f30f9bfc18"
type: "change"
title: "Infrastructure discovery skips test fixtures"
slug: "infrastructure-discovery-skips-test"
intent: "n-dx's own .sourcevision/infrastructure.json lists aws_sqs_queue.order_events from packages/sourcevision/tests/fixtures/workspace-crossings/checkout-web/infra/main.tf: discovery in packages/sourcevision/src/analyzers/infrastructure.ts does not exclude test fixtures, so any view built on the artifact would show fake infrastructure."
acceptanceCriteria:
  - "Files under test and fixture directories (e.g. tests/fixtures/**) are not reported as infrastructure resources"
  - "Analysing n-dx itself no longer lists aws_sqs_queue.order_events in infrastructure.json"
  - "A regression test covers a .tf file inside a fixture directory"
touches:
  - "26a42aed-6a93-471f-9ab4-259b97877d68"
priority: "high"
source: "ndx-capture"
---
