---
id: "1e3ec2bb-b5fd-4ed2-b004-ead39600b218"
level: "task"
title: "llm-client: resolveTaskModel + DEFAULT_ROUTES registry and routing config types"
status: "completed"
priority: "high"
tags:
  - "llm-client"
  - "model-routing"
source: "ndx-work"
startedAt: "2026-08-28T19:23:17.788Z"
completedAt: "2026-08-28T19:28:25.503Z"
endedAt: "2026-08-28T19:28:25.503Z"
acceptanceCriteria:
  - "resolveTaskModel(taskClass, config) returns {model, tier, effort?} and is exported from @n-dx/llm-client"
  - "DEFAULT_ROUTES covers the design §04 classes; agent.execute defaults to standard and llm.routes['agent.execute']='heavy' reaches TIER_MODELS.<vendor>.heavy with no code change"
  - "Resolution precedence is explicit model, then llm.routes exact match, then longest glob-prefix match, then registry default, then standard"
  - "llm.tiers.<vendor>.<tier> overrides the tier's default model; unknown tiers and vendors resolve to the nearest available model rather than throwing"
  - "llm.effort.<class> is matched with the same exact-then-glob rules and returned in the resolution"
  - "Unit tests cover precedence, glob matching, tier overrides, and vendor fallbacks"
description: "Foundation layer for class→tier→model resolution. Add resolveTaskModel(taskClass, config, opts) → {model, tier, effort?} to packages/llm-client/src/config.ts wrapping resolveVendorModel; ship DEFAULT_ROUTES (design §04 registry — agent.execute defaults to standard, heavy reachable via config); route matching precedence: explicit model → llm.routes exact → glob-prefix (longest wins) → registry default → standard; new LLMConfig fields tiers (per-vendor tier→model override consulted between routes and TIER_MODELS), routes, effort (class-matched), escalation (types only). A tier the vendor cannot distinguish resolves to the nearest available model, never an error. Export via public.ts; unit tests for precedence, glob matching, and per-vendor fallbacks."
lastModified: "2026-08-28T19:28:25.508Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
