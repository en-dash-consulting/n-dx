---
id: "13723ac9-aac4-489a-abbd-4cc56f518ece"
type: "task"
title: "A config save during a run is reported honestly, and the concurrency docs say the backstop reverts it"
slug: "a-config-save-during-a-run-is-reported"
description: "Second short adversarial re-review of #816 + #817 (the 20 fix commits since abf90b308; two parallel passes, trust/config and child-env/spawn/backstop; fix/security-child-env at 9b60c492e), 2026-10-28, child-env pass finding 3 (medium; a regression from bfb205e4; read from the code).\n\nFailure scenario: `ndx start` is documented as safe alongside `ndx work`, and its settings routes write .n-dx.json (routes-project-settings.ts, routes-cli-timeout.ts, routes-llm.ts, routes-features.ts) or the local file (routes-config.ts). If the user saves a dashboard setting mid-run, the backstop's next restore puts the old file back. The run fails with \"The agent changed n-dx's own config\" (config-backstop.ts ~line 270), and the user's change is lost.\n\nCoordinating n-dx's own writers with an active run is a design decision: any file marker in the checkout or the home directory is forgeable by the agent's shell. It is captured separately as a backlog change. This task is the honest minimum. (1) The finding says the file changed during the run, by the agent or by another writer, and names the path. It never claims the agent did it. It tells the user to save the setting again after the run if it was theirs. (2) The concurrency contract (docs/architecture/overview.md, the root guidance's concurrency paragraph through packages/core/assistant-assets/project-guidance.md, and docs/guide) says that a config change saved while `ndx work` runs is reverted at the run's next restore point. (3) The dashboard's settings save shows a warning when a run is active, if the server already knows that cheaply."
acceptanceCriteria:
  - "The backstop's run finding no longer says the agent made the change; it names the path, says it changed during the run, and tells the user how to re-apply their own change"
  - "The concurrency docs (overview and the generated assistant guidance, kept in step by re-running the generator) say config saves during `ndx work` are reverted"
  - "Test: the finding text for a changed file; instruction-alignment and the AGENTS.md size budget still pass"
priority: "medium"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
