---
id: "f8f5ff79-c71a-492a-9198-df944def761e"
level: "task"
title: "Vendor CLI environments always carry the project's policy, from one per-vendor table"
status: "pending"
priority: "high"
source: "ndx-capture"
acceptanceCriteria:
  - "createCliClient and createCodexCliClient no longer take an envPolicy option, and README.md (and the changeset) name exactly the paths the project's guard.env policy applies to: hench runs and the cross-vendor reviewer (D1 option b: rex, sourcevision and web one-shot completions use the default filter)"
  - "No spawn of a vendor CLI can omit its environment (type-level: the parameter is required)"
  - "resolveVendorCliEnv reads its vendor facts from one table, and the local vendor is an explicit entry (test: unchanged output for claude, codex, google and local)"
  - "The architecture-policy description records the 205→214 raise"
description: "Findings 1, 4 and 5 on #623. (1) createCliClient (llm-client/src/cli-provider.ts) and createCodexCliClient (codex-cli-provider.ts) take envPolicy but no caller passes it (create-client.ts, llm-client.ts, provider-registry.ts), while README.md and the #623 changeset say a guard.env.allow entry reaches children — D1 decided (Ryan, 2026-10-10): option (b) — remove the envPolicy option from both factories and narrow README.md to hench runs and the cross-vendor reviewer; these are one-shot completions that need no project credentials, and wiring it would make llm-client read hench config. (4) Remove fallbacks that encode a weaker policy: hench/src/agent/lifecycle/cli-loop.ts 'cliEnv ?? resolveVendorCliEnv({ vendor })', and the spawnOnce env defaults in cli-provider and codex-cli-provider; make the env parameter required. (5) Cleanups: resolveVendorCliEnv's three parallel vendor ternaries (keyName, authNames, apiKey) become one per-vendor table { keyEnv, authNames, configKey, cloudModes } with the local vendor an explicit entry with no auth names; modeEnabled matches CLAUDE_CODE_USE_* names exactly except on win32; hench/src/guard/contracts.ts uses one 'import type { EnvPolicyConfig }' plus 'export type { EnvPolicyConfig }'; core/config.js loadVendorCliEnv reuses loadAllConfigs' project config instead of calling loadEffectiveProjectConfig again, keeping the configs.hench?.guard?.env ?? projectConfig fallback behaviour; tests/e2e/architecture-policy.test.js moves the 205→214 rationale from a JS comment into the description string as a 'Raised from 205 to 214 for …' entry."
lastModified: "2026-10-10T18:14:05.576Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
