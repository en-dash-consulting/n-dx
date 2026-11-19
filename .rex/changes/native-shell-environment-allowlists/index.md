---
id: "47e8d81d-b0ac-49b5-8be4-a9d7c6f7de78"
type: "change"
title: "Native shell environment allowlists can remove the private Codex temporary directory"
slug: "native-shell-environment-allowlists"
summary: "A Codex run can start successfully but fail as soon as a command creates a temporary file, even though the run allocated a private directory."
intent: "Medium, should-fix. A supported native shell_environment_policy.include_only setting containing only PATH filters TMPDIR, TMP and TEMP after the provider's set overrides. Fresh, resumed and forked POSIX commands then resolve os.tmpdir() to /tmp, which the workspace policy excludes. The fixtures at packages/hench/tests/integration/codex-scratch.test.ts and packages/llm-client/tests/unit/codex-cli-provider.test.ts observe the vendor process environment, before Codex applies shell filters. The compiler at packages/llm-client/src/codex-cli-provider.ts:240 does not resolve the effective filter. Preserve an operator's restrictive filter and either deliver the private temp variables safely or diagnose the incompatible configuration before execution. Checking effective native configuration across supported versions merits a separate change. The documented filtering order is at https://learn.chatgpt.com/docs/config-file/config-advanced#shell-environment-policy."
acceptanceCriteria:
  - "With an effective PATH-only shell allowlist, fresh and continuation workspace-write invocations deliver usable private temp storage to a real child command or report the filtering conflict before work starts."
  - "A regression exercises the effective shell environment, keeps unrelated excluded environment variables excluded, and confirms that no broad host temp grant was added."
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "medium"
discoveredFrom: {"item":"83b0a2a3-1f01-4f64-8e93-920b6a685b7e","run":"25b4277e-1b02-4a99-960e-a2d72e008fcc"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
