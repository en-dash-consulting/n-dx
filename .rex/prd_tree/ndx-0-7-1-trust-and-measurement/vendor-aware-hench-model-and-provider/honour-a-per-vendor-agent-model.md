---
id: "d2981476-a9f4-4b8d-b6b4-7c360ff9e077"
level: "task"
title: "Honour a per-vendor agent model override in ndx work"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "vendor-aware-hench-config"
  - "pr-n"
source: "2026-09-23 H-lane test session (feat/071-h-glossary-and-plain-language-titles)"
acceptanceCriteria:
  - "With hench.models.<active vendor> set, ndx work runs that model and prints its source; --model still wins."
  - "An override for a different vendor than the active one is ignored."
  - "An override incompatible with the active vendor fails with the same actionable error the configured model gets."
  - "With no override, the resolved model and its source are unchanged (regression test)."
  - "hench.model is documented as deprecated and still ignored."
description: "Add an optional per-vendor agent model to hench config (for example hench.models.<vendor>) and resolve it in run.ts after the --model flag and before llm.model / llm.<vendor>.model, only for the active vendor, with the same vendor-compatibility check the configured model already gets. Existing hench.model values (the schema default is 'sonnet') stay ignored as today, so no project changes behaviour on upgrade; document hench.model as deprecated in the config help and the Config view. Record the model source on the run as today (a new 'hench-override' source, or equivalent).\n\nConstraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-23T23:40:53.070Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
