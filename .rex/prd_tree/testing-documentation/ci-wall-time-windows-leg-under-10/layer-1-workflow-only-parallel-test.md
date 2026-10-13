---
id: "4453363f-ee02-402f-b3bd-e668afe5b2dd"
level: "task"
title: "Layer 1 · Workflow only: parallel test jobs per OS, Defender exclusion, Node compile cache"
status: "pending"
priority: "high"
source: "ndx-capture"
acceptanceCriteria:
  - "Three test jobs per OS run in parallel and each Windows job finishes under 15 minutes"
  - "Smoke legs keep their exact check names and smoke-parity still consumes both artifacts"
  - "Windows leg has a Defender exclusion step before install"
description: "ci.yml only. Keep the three matrix legs for install, build, Linux policy steps and smoke collect; move the two test steps into a test matrix job over os x suite group (root,llm-client / rex,sourcevision / hench,web) via run-all-tests.mjs labels. Add a Windows-only Add-MpPreference step excluding the workspace, RUNNER_TEMP, TEMP, the pnpm store and the node and git processes. Set NODE_COMPILE_CACHE on the test jobs. Check names CLI Smoke (macOS) and CLI Smoke (Windows) stay on the smoke legs; branch protection must add the new test job names."
lastModified: "2026-10-12T14:51:34.500Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
