---
id: "94acd4e9-e113-461f-af0e-769c7c357996"
level: "task"
title: "Show provider limits per vendor and a per-vendor agent model picker on Robot Wrangler"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "settings-consolidation"
  - "pr-24"
blockedBy:
  - "11e17f5e-2453-4984-bd6e-776dc1dca5f3"
  - "69848346-1828-42d3-b62d-833648d4274b"
  - "70ac46e4-b114-48bb-bfcc-d341535309c0"
  - "22226abd-53df-411b-803a-4f96e0325356"
  - "c3894349-7a44-4556-85cd-fb9aa14af91f"
  - "8aedb5db-c87b-4483-8c82-d6e64ad42a79"
source: "2026-09-23 H-lane test session (feat/071-h-glossary-and-plain-language-titles)"
acceptanceCriteria:
  - "For each vendor (claude, codex, google, local), Robot Wrangler's provider field offers exactly the providers in GET /api/llm/catalog; a single choice is shown as fixed. It saves through PUT /api/hench/config, which already rejects an unsupported provider (69848346)."
  - "The per-vendor agent model picker lists that vendor's models from GET /api/llm/catalog and marks the project default (the effective llm.* model from 11e17f5e's effective block). It offers \"Use project default\" and free entry. It saves through PUT /api/llm/config as hench.models.<vendor> into the project config file: a new writable path, with null deleting the key, and non-local values checked with isModelCompatibleWithVendor. Nothing writes hench.model."
  - "Switching the active vendor changes what the page offers without stale options and without a reload. Vendor, provider and model share the page's single SettingsFrame."
  - "MODEL_SUGGESTIONS is removed; no model list in the viewer is hard-coded."
  - "The Workflow page (views/workflow.ts, 22226abd) renders no provider or model field; Robot Wrangler is their only editor."
  - "Unit tests in packages/web/tests/unit/viewer/robot-wrangler-vendor.test.ts and packages/web/tests/unit/server/routes-llm-hench-models.test.ts cover the four vendors for both fields, and a changeset bumps @n-dx/web as patch."
description: "Robot Wrangler (11e17f5e) replaces the LLM Provider view and the hench Config view's provider and model fields. On that page, for each vendor offer only the providers hench accepts (claude: cli or api; codex: cli; google and local: api, shown as fixed), taken from the catalog route 69848346 serves. Replace free-text model entry with a per-vendor agent model picker over that vendor's models from the same catalog, marking the project default, with \"Use project default\" (clears hench.models.<vendor>) and free entry; save to the override 70ac46e4 adds. Remove MODEL_SUGGESTIONS so every viewer model list comes from the server catalog. Moved from 0.7.1 PR N, where it targeted the hench Config view (now replaced by the Workflow page and Robot Wrangler); also takes \"surface it on Robot Wrangler\" from 70ac46e4 and the viewer half of 8559090f.\n\nConstraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-30T22:44:05.509Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
