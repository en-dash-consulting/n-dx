---
id: "dc63cd09-8563-4fc0-a4ff-ef26e184d2a5"
type: "task"
title: "Run verdicts read vendor failures from run.error, and no-changes needs an agent that acted"
slug: "run-verdicts-read-vendor-failures-from"
description: "Review finding F2 (https://github.com/en-dash-consulting/n-dx/pull/907#discussion_r4469225523) in packages/hench/src/agent/analysis/run-verdict.ts. A run that dies on turn 1 from a vendor or CLI error (turns 1, no tool calls, commits []) is classed no-changes with 'tighten the done-when' (runs dfc5edd4 'does not support this model', 6ffcb5b8 'You've hit your session limit'). vendorFailureCategories reads run.events, filled only when hench useEventPipeline is on (default off), so vendor-transient fired 0 times over 75 real failed runs. Fix (a) noChanges requires the agent to have made a tool call; (b) vendorTransient also classifies run.error with classifyVendorError, exported through packages/hench/src/prd/llm-gateway.ts; (c) auth is not transient. llm-client's VENDOR_ERROR_PATTERNS (packages/llm-client/src/runtime-contract.ts) has no pattern for a session limit; add one as rate_limit."
acceptanceCriteria:
  - "noChanges needs at least one tool call; a failure with no tool calls and no commits is not no-changes (tested with turns 1, toolCallsTotal 0, commits [])"
  - "With the event pipeline off, a run.error that classifyVendorError maps to auth, rate_limit or transient_exhausted is classed vendor-transient, reached through llm-gateway (tested with 401, 429 and overloaded messages)"
  - "classifyVendorError maps \"You've hit your session limit\" to rate_limit (llm-client test), so that run is classed vendor-transient"
  - "An auth failure's action is to re-authenticate the vendor CLI and re-run, not retry later (tested)"
  - "The 'does not support this model' run is not classed no-changes (tested); the patch changeset names @n-dx/llm-client when its patterns change"
priority: "high"
---
