---
id: "efe48f01-7714-4ac4-b3fa-2092d64a046d"
type: "task"
title: "routes-workflow.ts uses the shared guarded path helpers"
slug: "routes-workflow-ts-uses-the-shared"
description: "packages/web/src/server/routes-workflow.ts keeps its own setNestedValue/getNestedValue (~521-545) and a FORBIDDEN_PATH_SEGMENTS Set (~489), byte-equivalent to setConfigValue/getConfigValue and FORBIDDEN_CONFIG_SEGMENTS in hench-config-fields.ts, which the file already imports from. Layer 2 of stack #855 deduped routes-features the same way and left this twin. Pure deletion plus import; routes-workflow.test.ts already covers the behaviour."
acceptanceCriteria:
  - "routes-workflow.ts defines no path walker or forbidden-segment set of its own and imports the shared ones"
  - "routes-workflow.test.ts passes unchanged, including the prototype-pollution cases"
priority: "low"
source: "codeql-triage"
---
