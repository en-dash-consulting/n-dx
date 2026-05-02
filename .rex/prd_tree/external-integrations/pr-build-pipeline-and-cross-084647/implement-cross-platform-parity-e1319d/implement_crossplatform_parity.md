---
id: "e1319df0-a11c-47c5-b4a2-840ea087160f"
level: "task"
title: "Implement cross-platform parity assertions for deterministic CLI responses"
status: "completed"
priority: "critical"
tags:
  - "ci"
  - "parity"
  - "cross-platform"
  - "cli"
  - "test-harness"
source: "smart-add"
startedAt: "2026-04-06T18:34:06.588Z"
completedAt: "2026-04-06T18:39:35.822Z"
acceptanceCriteria:
  - "Pipeline collects normalized result artifacts from both MacOS and Windows stages in a format suitable for automated comparison"
  - "A parity check verifies that both platforms return matching deterministic responses and matching expected exit codes for the covered smoke commands"
  - "The assertion set is explicitly limited to known static responses and existing error codes already treated as stable by the test suite"
  - "The parity check ignores generated code diffs, model-produced text bodies, and other nondeterministic output fields"
  - "The new validation is additive only and does not require modification of existing production command logic to pass"
description: "Add an additive validation step that compares the MacOS and Windows smoke-run artifacts against each other and against the existing static expected responses and error codes, ensuring platform consistency without expanding the contract to nondeterministic model output."
---
