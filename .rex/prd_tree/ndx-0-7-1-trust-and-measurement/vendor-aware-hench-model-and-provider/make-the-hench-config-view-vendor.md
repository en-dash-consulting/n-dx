---
id: "94acd4e9-e113-461f-af0e-769c7c357996"
level: "task"
title: "Make the hench Config view vendor-aware: provider choices and an agent-model picker for the active vendor"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "vendor-aware-hench-config"
  - "pr-n"
source: "2026-09-23 H-lane test session (feat/071-h-glossary-and-plain-language-titles)"
acceptanceCriteria:
  - "For each vendor (claude, codex, google, local) the Provider field offers exactly the providers hench accepts, and the server rejects any other value."
  - "The Model picker lists the active vendor's models, marks the project default, and saves to the per-vendor agent override; 'Use project default' removes it."
  - "Switching the active vendor in the LLM Provider view changes what the hench Config view offers without a reload of stale options."
  - "Unit tests cover the four vendors for both fields."
description: "In packages/web/src/server/hench-config-fields.ts and packages/web/src/viewer/views/hench-config.ts: show the active vendor (from llm config) at the top of the Execution category; limit the Provider field to what that vendor supports (claude: cli or api; codex: cli; google and local: api, shown as fixed) with a description that names the vendor; replace the free-text Model field with a picker over the active vendor's models from the catalog (N1), plus 'Use project default' (clears the override) and free entry; save to the per-vendor override (N2). Keep the save path's validation in step: the server must reject a provider the active vendor does not support. Note PR M also edits hench-config-fields.ts (prune fields) and owns CONFIG_GROUP_DEFAULTS; add any nested group through that mirror in coordination.\n\nConstraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-23T23:40:54.599Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
