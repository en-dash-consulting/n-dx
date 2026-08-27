---
id: "34021b4f-f6b5-4e78-b590-9f6980f7cdb8"
level: "task"
title: "Make MODEL_ALIASES.opus track the heavy tier instead of diverging from it"
status: "pending"
priority: "low"
tags:
  - "e2e-finding"
  - "model-resolution"
  - "severity:low"
source: "ndx-capture"
acceptanceCriteria:
  - "A decision is recorded on whether MODEL_ALIASES.opus should track the heavy tier or deliberately lag it"
  - "config.ts no longer yields two different answers for the current Opus without an explanatory comment"
  - "MODEL_ALIASES.haiku is reviewed for the same hardcoded-literal drift"
  - "A test covers alias resolution for opus and haiku against whatever invariant is chosen"
description: "Introduced by task 85923733's heavy-tier repoint. config.ts now gives two different answers for \"the current Opus\": TIER_MODELS.claude.heavy is \"claude-opus-5\" (config.ts:75) while MODEL_ALIASES.opus is still \"claude-opus-4-8\" (config.ts:188).\n\nTrigger: a .n-dx.json with llm.claude.model = \"opus\" resolves through resolveVendorModel(\"claude\", cfg) at standard weight to resolveModel(\"opus\") to \"claude-opus-4-8\". A user who asked for Opus runs on the older Opus while the codebase's own heavy tier declares opus-5 current.\n\nMechanism of the drift: MODEL_ALIASES.sonnet is derived (NEWEST_MODELS.claude) whereas opus and haiku are hardcoded literals, so the alias table does not follow tier changes.\n\nLow severity, as the reviewer noted: both IDs are valid, both price identically at 5.00/25.00, nothing crashes. The cost is capability, not correctness.\n\nTwo options — point MODEL_ALIASES.opus at TIER_MODELS.claude.heavy so it tracks automatically (cheap, matches how sonnet already derives), or pin it deliberately with a comment saying the alias intentionally lags. Which Opus \"opus\" should mean is a maintainer decision, not something to change silently."
lastModified: "2026-08-27T16:49:55.647Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
