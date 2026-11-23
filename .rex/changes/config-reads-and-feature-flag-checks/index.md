---
id: "b74c12c2-673c-488b-9559-9f999d9440b4"
type: "change"
title: "Config reads and feature-flag checks (config.json)"
slug: "config-reads-and-feature-flag-checks"
summary: "Record where code reads configuration and where it checks feature flags, with the code each flag switches on or off, in a new language-neutral report. Feature flags and config files are the client's two biggest migration pain points."
intent: "PR 7 of the PHP language-pack stack, stacked on PR 6. Implements decision D2: two new language-neutral fact kinds, `configReads` and `flagChecks`, in the lang-kit pack contract, and a new sourcevision artifact `config.json` that holds them. PHP is the first producer; other packs can produce them later. Also adds a Composer flag-SDK table to sdlc-profile beside the npm, Go and Python ones (packages/sourcevision/src/analyzers/sdlc-profile.ts `FEATURE_FLAG_DEPS`, `FEATURE_FLAG_PY_DISTS`).\n\nLane rules (PHP pack; decisions made 2026-11-12):\n- D2 is a named exception to the 2026-10-12 rule that facts go only into existing artifacts; Hal reviews the field names. Keep every field optional-friendly and documented.\n- No values: facts record names, keys, files and positions only, never config or flag values (decision D7 on values is still open and belongs to the private engagement tooling).\n- `config.json` is written only when some pack produced either kind, so every other repository's output is byte-identical (no new file).\n- Do not change sourcevision MCP tool names, required parameters or response shapes.\n- Agents cannot use the network, run `pnpm install`, read `~/.cache`, or write under `.claude/`. The operator does those steps.\n- Record measurements with append_log on the task.\n- Patch changesets with scoped package names.\n- Before finishing, run the six static root policy tests: tests/e2e/architecture-policy.test.js, domain-isolation.test.js, shell-spawn-inventory-policy.test.js, wall-clock-inventory-policy.test.js, layout-literal-policy.test.js, obfuscated-code-policy.test.js."
acceptanceCriteria:
  - "The pack contract defines configReads and flagChecks, and sourcevision writes them to config.json only when a pack produced them"
  - "For PHP repositories with the pack, define()-constant flags, config-array flags, helper-call flags and flag SDK calls are reported with the code span they gate, and PHP config sources are reported with their consumers"
  - "Composer flag SDKs count toward the feature-flags readiness dimension"
  - "Repositories with no producing pack get byte-identical output and no config.json"
amends: [{"target":"11df5f27-e8e0-42b3-adda-7331247ea363","delta":"added","summary":"Config reads and feature-flag checks (config.json)","criteria":{"add":[{"id":"config-json","text":"config.json holds config reads and flag checks only when a pack produced them"},{"id":"php-flags-config","text":"PHP flag checks, config sources and host-selected tenant configs are reported"}]},"proposed":"Language packs can report where code reads configuration and where it checks feature flags, with the code each check gates and no values, and sourcevision writes them to config.json; PHP is the first producer.","under":"58f0468b-33ce-46ee-b507-c95261f152b6","title":"Config reads and feature-flag checks","type":"capability"}]
priority: "high"
tags:
  - "php"
  - "lang-php"
  - "php-pr7"
blockedBy:
  - "38abed61-45be-4181-a45c-5652878ad43c"
---
