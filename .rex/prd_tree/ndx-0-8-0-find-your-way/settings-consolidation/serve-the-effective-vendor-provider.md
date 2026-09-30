---
id: "c3894349-7a44-4556-85cd-fb9aa14af91f"
level: "task"
title: "Serve the effective vendor, provider and model ndx work will use from GET /api/llm/config"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "settings-consolidation"
  - "pr-24"
source: "Split out of 11e17f5e (Robot Wrangler) during implementation — the effective-resolution block and its cross-package fixture matrix are a self-contained server change."
acceptanceCriteria:
  - "GET /api/llm/config returns `effective: { vendor, provider, model, modelSource }` describing what `ndx work` runs with no flags."
  - "A fixture matrix builds real project directories across vendors (claude, codex, google, local) and config shapes (legacy keys only, modern only, both, `llm.model` set, `hench.models.<vendor>` set) on the legacy layout, and asserts the route's effective block equals hench's `resolveAgentModel` and `isProviderSupported` for each."
  - "The provider reported is `hench.provider` switched to a supported one when the active vendor does not accept it, matching hench's own behaviour."
  - "modelSource distinguishes `hench-override` from `configured` from `default`, using llm-client's exported `ModelSource` union rather than restated string literals."
  - "Web does not import hench. Any new hench export needed by the contract test is added to hench's public API and stays within the gateway export ceiling."
  - "Patch changesets cover @n-dx/web, and @n-dx/hench if its exports change."
description: "Robot Wrangler must show what `ndx work` will actually do with no flags. That answer is assembled from three places and is currently nowhere: the dashboard shows configured keys, not the resolution over them.\n\nAdd `effective: { vendor, provider, model, modelSource }` to `GET /api/llm/config` (packages/web/src/server/routes-llm.ts):\n- **vendor** — `llm.vendor`, defaulting to claude.\n- **provider** — `hench.provider` after the same unsupported-provider switch hench applies (claude cli or api, codex cli only, google api, local api). Web already keeps the table as `VENDOR_PROVIDERS` in `packages/web/src/server/hench-config-fields.ts`.\n- **model** — `hench.models.<vendor>`, then llm-client's `resolveTaskModel(\"agent.execute\", llmConfig, { vendor })`, then the vendor default.\n- **modelSource** — which rung won. llm-client exports the `ModelSource` union (`cli-override` | `hench-override` | `configured` | `default`); the route can never see a CLI flag, so it emits the last three.\n\nWeb must not import hench, so this is a second separately-maintained twin of hench's `resolveAgentModel` (packages/hench/src/cli/commands/agent-model.ts) and `isProviderSupported` (provider-support.ts), pinned by a contract test.\n\n**Note on where the contract test goes.** The acceptance criterion inherited from 11e17f5e names `tests/integration/cross-package-contracts.test.js`, but that file is deliberately dist-import-only — its header says fixture work belongs elsewhere, and it has no mkdtemp/tmpdir harness. `tests/integration/llm-routing-config-roundtrip.test.js` is the existing fixture-based analogue (CLI write → .n-dx.json → loadLLMConfig → resolveTaskModel) and is the better host for the matrix. Keep the pure symbol/value pin in cross-package-contracts.test.js and put the fixture matrix in a sibling of the roundtrip test. Decide deliberately rather than forcing fixtures into the dist-only file.\n\n`resolveAgentModel` is NOT currently exported from hench's public.ts — only `VENDOR_PROVIDERS` and `isProviderSupported` are. If the contract test needs it, add it to hench's public API (and note the gateway export-ceiling check in tests/e2e/architecture-policy.test.js).\n\nThe `.ndx/` layout is out of scope here (GitHub issue #463).\n\nConstraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-30T21:56:19.951Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
