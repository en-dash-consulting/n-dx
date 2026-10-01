---
id: "d73809a3-5bfd-4e9d-9aba-86d43db0898d"
level: "task"
title: "Read hench overrides from .n-dx.json in the effective block, and check the contract through hench's own config loader"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "settings-consolidation"
  - "pr-24"
source: "Gap found by the B6a sidecar after c3894349 (run 2a6b63c9): the effective block ignores the hench overrides in .n-dx.json that hench's own help points hench.models.<vendor> at."
acceptanceCriteria:
  - "`resolveEffectiveAgentConfig` reads `provider` and `models` from `.hench/config.json` merged with the `hench` sections of `.n-dx.json` and `.n-dx.local.json` (local wins), using llm-client's `loadProjectOverrideSources` and `mergeWithOverrides`. An invalid merged field reverts to the `.hench/config.json` value, as hench's `loadConfig` does (packages/hench/src/store/config.ts:93)."
  - "In tests/integration/effective-agent-config-contract.test.js, hench's side gets `provider` and `models` from hench's own `loadConfig` (`onInvalid: \"use-defaults\"`), reached through the `./dist/*` subpath as the schema import already is, instead of a `models` literal."
  - "The matrix adds, for each vendor: `hench.models.<vendor>` only in `.n-dx.json`; `hench.models.<vendor>` only in `.n-dx.local.json`; set in both `.hench/config.json` and `.n-dx.json` (the override wins); `hench.provider` only in `.n-dx.json`; an invalid `.n-dx.json` `models` override, which reverts to the `.hench/config.json` value."
  - "A patch changeset bumps @n-dx/web."
description: "c3894349 added `effective: { vendor, provider, model, modelSource }` to GET /api/llm/config (packages/web/src/server/effective-agent-config.ts). Its `readHenchAgentSettings` reads `provider` and `models` from `.hench/config.json` only. hench itself merges `.hench/config.json` with the `hench` sections of `.n-dx.json` and `.n-dx.local.json` (local wins), re-validates the result, and reverts an invalid merged field to its `.hench/config.json` value (packages/hench/src/store/config.ts, `loadConfig`, from line 93). hench's own help tells users to set `hench.models.<vendor>` in `.n-dx.json` (packages/hench/src/cli/commands/config.ts:62, packages/hench/src/cli/help.ts:285), and 94acd4e9 will save it there from the dashboard, so the effective block misreports exactly the documented location.\n\nThe contract test (tests/integration/effective-agent-config-contract.test.js) cannot see this: it seeds `hench.models` only in `.hench/config.json` and hands hench's `resolveAgentModel` a `models` literal instead of running hench's config loader, so both sides skip the file layer.\n\nImplementation notes: in effective-agent-config.ts, merge the override sections with llm-client's exported `loadProjectOverrideSources` and `mergeWithOverrides` (packages/llm-client/src/public.ts), then apply the existing `readAgentModels` and provider rules to the merged value, falling back per field to the `.hench/config.json` value when the merged field is invalid. Keep the legacy layout only; the `.ndx/` layout is GitHub issue #463. Web must not import hench at runtime; the contract test may reach hench's `loadConfig` through the `./dist/*` subpath, as it already does for `HenchConfigSchema`. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-10-01T00:03:55.117Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
