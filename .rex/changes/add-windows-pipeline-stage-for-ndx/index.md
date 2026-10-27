---
id: "1a72b5c1-bc52-42f6-8918-402065d6e324"
type: "change"
title: "Add Windows pipeline stage for ndx install-and-run smoke validation"
slug: "add-windows-pipeline-stage-for-ndx"
intent: "Introduce a second CI stage that starts the requested Windows-based container environment, runs the same install and smoke-command workflow using Windows-native commands, and captures deterministic outputs and exit codes using the same assertion scope as the MacOS stage."
acceptanceCriteria:
  - "Pipeline includes a distinct Windows validation stage parallel to the MacOS validation stage"
  - "The stage executes the same logical install-and-run smoke flow as MacOS, translated to Windows command syntax where required"
  - "The Windows stage captures the same set of deterministic response fields and exit codes as the MacOS stage"
  - "The stage excludes assertions on generated code, model-generated prose, and any nondeterministic text output"
  - "A mismatch against expected static responses or exit codes causes the Windows stage to fail with platform-specific diagnostics"
touches:
  - "08464700-9955-4338-87b6-afea0646a6f8"
priority: "high"
tags:
  - "ci"
  - "pipeline"
  - "windows"
  - "cli"
  - "regression"
source: "smart-add"
---
