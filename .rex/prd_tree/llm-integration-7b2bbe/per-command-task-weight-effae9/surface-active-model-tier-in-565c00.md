---
id: "565c00fb-4271-4187-a75e-2a10c0cb060a"
level: "task"
title: "Surface active model tier in vendor header output and log task weight reasoning"
status: "completed"
priority: "medium"
tags:
  - "llm-client"
  - "cli-output"
  - "observability"
source: "smart-add"
startedAt: "2026-04-15T17:39:22.834Z"
completedAt: "2026-04-15T17:52:00.239Z"
acceptanceCriteria:
  - "Vendor header output includes tier label, e.g. 'Vendor: claude  Model: claude-haiku-4-5 (light tier)' for smart-add"
  - "Standard-tier commands show 'Vendor: claude  Model: claude-sonnet-4-6 (standard tier)' or omit tier label if desired for backward compatibility"
  - "When lightModel config override is active, header shows '(light tier, configured)' to distinguish from default"
  - "Tier label does not appear when --model flag is used (explicit model takes precedence over tier semantics)"
description: "Update printVendorModelHeader in vendor-header.ts to display the active tier alongside the resolved model, so operators can see at a glance whether a command is running on the light or standard tier and why. When a tier override is active (via config lightModel), show that it's a configured override. This makes the cost optimization visible and debuggable."
---
