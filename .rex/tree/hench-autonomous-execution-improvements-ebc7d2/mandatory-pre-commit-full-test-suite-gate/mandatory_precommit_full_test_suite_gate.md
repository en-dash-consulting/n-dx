---
id: "dde6d1c4-a1bd-4dfe-9af8-0ec057addf16"
level: "feature"
title: "Mandatory Pre-Commit Full Test Suite Gate"
status: "pending"
source: "smart-add"
acceptanceCriteria: []
description: "Introduce a distinct, mandatory step in the hench run lifecycle that executes the project's entire test suite before allowing a commit, regardless of whether failing tests are related to the current task. The gate is only bypassable via an explicit opt-out flag, and prompts the user when the test command is unknown or inaccessible."
---

## Children

| Title | Status |
|-------|--------|
| [Add distinct full-test-suite gate step to hench run lifecycle before commit](./add-distinct-full-test-suite-gate-step-to-hench-run-3b422b/index.md) | completed |
| [Resolve test command via project config with interactive prompt fallback for unknown or inaccessible suites](./resolve-test-command-via-project-config-with-fd409d/index.md) | pending |
