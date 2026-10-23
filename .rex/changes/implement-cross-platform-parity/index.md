---
id: "e1319df0-a11c-47c5-b4a2-840ea087160f"
type: "change"
title: "Implement cross-platform parity assertions for deterministic CLI responses"
slug: "implement-cross-platform-parity"
intent: "Add an additive validation step that compares the MacOS and Windows smoke-run artifacts against each other and against the existing static expected responses and error codes, ensuring platform consistency without expanding the contract to nondeterministic model output."
acceptanceCriteria:
  - "Pipeline collects normalized result artifacts from both MacOS and Windows stages in a format suitable for automated comparison"
  - "A parity check verifies that both platforms return matching deterministic responses and matching expected exit codes for the covered smoke commands"
  - "The assertion set is explicitly limited to known static responses and existing error codes already treated as stable by the test suite"
  - "The parity check ignores generated code diffs, model-produced text bodies, and other nondeterministic output fields"
  - "The new validation is additive only and does not require modification of existing production command logic to pass"
amends: [{"target":"08464700-9955-4338-87b6-afea0646a6f8","delta":"modified","summary":"Implement cross-platform parity assertions for deterministic CLI responses","base":"eab1a62fc4e92eccf421c87d8bc87b9c55212cabe15a6c4bbdab17ec557c64e4"}]
priority: "critical"
tags:
  - "ci"
  - "parity"
  - "cross-platform"
  - "cli"
  - "test-harness"
source: "smart-add"
---
