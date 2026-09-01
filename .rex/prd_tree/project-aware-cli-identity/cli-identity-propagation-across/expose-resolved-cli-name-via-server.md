---
id: "396910f4-1267-4cfb-ac6c-e9f6eef08b0f"
level: "task"
title: "Expose resolved CLI name via server API and inject into dashboard shared state"
status: "completed"
priority: "high"
tags:
  - "web"
  - "api"
  - "identity"
source: "smart-add"
startedAt: "2026-08-13T13:01:41.266Z"
completedAt: "2026-08-13T13:12:35.024Z"
endedAt: "2026-08-13T13:12:35.024Z"
acceptanceCriteria:
  - "The capabilities endpoint (or equivalent) returns a cliName field containing the resolved project CLI name"
  - "Dashboard loads cliName on startup and stores it in the top-level shared data state accessible to all components"
  - "No dashboard component reads cliName from localStorage, environment, or a hardcoded string — all reads go through shared state"
  - "Unit test confirms the endpoint returns 'ndx' when cli.name is absent from config and the configured value when present"
description: "Extend the existing capabilities or project-info server endpoint to return cliName from the resolved cli.name config field. Wire this into the dashboard's initial data load so all components can read the project CLI name from shared state without hardcoding. This is the prerequisite for all dashboard label substitutions."
---
