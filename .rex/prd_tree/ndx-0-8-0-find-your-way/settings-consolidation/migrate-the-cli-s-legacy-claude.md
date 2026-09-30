---
id: "a11c292c-3341-45cd-9029-d7890ef74c0e"
level: "task"
title: "Migrate the CLI's legacy claude.* section to llm.claude.* on both read and write"
status: "in_progress"
priority: "medium"
tags:
  - "0.8.0"
  - "settings-consolidation"
  - "pr-24"
source: "Split out of 11e17f5e (Robot Wrangler) during implementation — the CLI half of its write-only-new-keys criterion is a self-contained migration, not a one-line note."
startedAt: "2026-09-30T22:48:34.139Z"
acceptanceCriteria:
  - "`ndx config claude.<field> <value>` writes `llm.claude.<field>` and prints a one-line deprecation note naming the key actually written. The note goes to stderr, like the other advisories in handleSetProjectSection, so `--json` stdout stays parseable."
  - "`ndx config claude.<field>` (read) returns the resolved value — `llm.claude.<field>` when set, else the legacy `claude.<field>` — for all five fields (model, lightModel, cli_path, api_key, api_endpoint), spanning `.n-dx.json` and `.n-dx.local.json`."
  - "`ndx config claude` and `ndx config --json` show the merged view rather than only the legacy section."
  - "`ndx config --test-connection` finds credentials stored under `llm.claude.*`, where it currently reports `No Claude configuration set.`"
  - "Existing `claude.*` values on disk are left in place — the migration changes where new writes go, never what an existing file already says."
  - "tests/e2e/cli-config.test.js passes with its claude-section cases updated to assert the new write target and the resolved read, and a case pinning that a legacy-only project still reads correctly."
  - "A patch changeset covers @n-dx/core."
description: "The Robot Wrangler task (11e17f5e) landed the per-field `llm.claude.*` ?? legacy `claude.*` resolution (`resolveClaudeConfig` in @n-dx/llm-client), wired it into `loadLLMConfig`, `GET /api/llm/config` and `GET /api/ndx-config`, made `PUT /api/llm/config` refuse the legacy keys, and removed core's `llm.claude.*` → `claude.*` write mirror. What it did NOT do is the CLI half: `ndx config claude.<field>` still writes the legacy key.\n\nRedirecting only the write was attempted and reverted, because it breaks 22 cases in `tests/e2e/cli-config.test.js` — the write moves to `llm.claude.*` while every read still looks at the `claude` section. All four read sites must move together:\n\n1. `handleGet` (packages/core/config.js ~line 2834) — `getByPath(configs[pkg], settingPath, pkg)` for `pkg === \"claude\"` must resolve `configs.llm?.claude?.<field> ?? configs.claude?.<field>`, or `ndx config claude.model` answers `Key \"claude.model\" not found.` right after setting it.\n2. The whole-section read in the same function (`ndx config claude`, no dot) must show the merged view, or it reports `No claude configuration set.`\n3. `--json` output — `parsed.claude` must carry the merged view.\n4. `--test-connection` — reads the claude section for cli_path/api_key and currently reports `No Claude configuration set.` when the values live under `llm.claude.*`.\n\nThe five legacy fields are `model`, `lightModel`, `cli_path`, `api_key`, `api_endpoint`. Note `cli_path` and `api_key` route to `.n-dx.local.json` (`LOCAL_ONLY_SETTINGS`, config.js ~line 113), so the merged read must span both files, and `LLM_VALIDATORS` already carries `claude.cli_path`, `claude.api_endpoint` and `claude.model` keys relative to the `llm` section — a redirected write validates correctly without new validators.\n\nConstraints that apply to every n-dx change: cross-package imports go only through the package's gateway module; orchestration scripts in packages/core spawn CLIs and never import packages. config.js may not *statically* import packages (tests/e2e/domain-isolation.test.js:384), but it already loads @n-dx/llm-client with `await import(...)` (lines 1549, 2685, 3098). Resolve through `resolveClaudeConfig` the same way, and replace `resolveClaudeSettings` with it (closes GitHub issue #466). Every user-facing change carries a changeset using the scoped package name with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-30T22:48:34.519Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
