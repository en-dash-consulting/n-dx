---
id: "396910f4-1267-4cfb-ac6c-e9f6eef08b0f"
type: "change"
title: "Expose resolved CLI name via server API and inject into dashboard shared state"
slug: "expose-resolved-cli-name-via-server"
intent: "Extend the existing capabilities or project-info server endpoint to return cliName from the resolved cli.name config field. Wire this into the dashboard's initial data load so all components can read the project CLI name from shared state without hardcoding. This is the prerequisite for all dashboard label substitutions."
acceptanceCriteria:
  - "The capabilities endpoint (or equivalent) returns a cliName field containing the resolved project CLI name"
  - "Dashboard loads cliName on startup and stores it in the top-level shared data state accessible to all components"
  - "No dashboard component reads cliName from localStorage, environment, or a hardcoded string — all reads go through shared state"
  - "Unit test confirms the endpoint returns 'ndx' when cli.name is absent from config and the configured value when present"
amends: [{"target":"24f931c4-2411-44c9-9325-d82e06558159","delta":"modified","summary":"Expose resolved CLI name via server API and inject into dashboard shared state","base":"c2992df5a43b2b6a13a4f352e367449b5b0651c8e552ee324d724310e3d1b418"}]
priority: "high"
tags:
  - "web"
  - "api"
  - "identity"
source: "smart-add"
---
