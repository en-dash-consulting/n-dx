---
id: "d1f293e3-9051-443f-b0f5-3a0839302edf"
type: "task"
title: "Add configReads and flagChecks fact kinds and the config.json artifact"
slug: "add-configreads-and-flagchecks-fact"
summary: "Add a language-neutral place to record where code reads configuration and checks feature flags, written only for projects whose language pack reports them."
description: "Decision D2 (2026-11-12). Engine and contract only; no producer in this task.\n\nIn `packages/lang-kit/src/pack-contract.ts`:\n- `ConfigReadFact`: `key` (as written, dotted for nested array access: `db.host` for `$config['db']['host']`), `source` (`file` | `env` | `ini` | `yaml` | `xml` | `json` | `define` | `unknown`), optional `sourceFile` (project-relative file the value comes from, when known), `position`. No values.\n- `FlagCheckFact`: `name` (as written), `normalized` (lower-case, separators unified, `FEATURE_`/`FF_`/`features.` prefixes stripped, so `FEATURE_NEW_CHECKOUT` and `features.new_checkout` meet), `mechanism` (`constant` | `config` | `function` | `sdk` | `env`), optional `client` (SDK or helper name), `position`, and `gated` (start and end line of the code the check controls, when the check is an `if`/ternary/`match` condition). No values.\n- Add both to `FileFacts`, to `PRODUCED_FACT_KINDS`, and document them as language-neutral.\n\nIn sourcevision:\n- A new artifact `config.json` (schema in packages/sourcevision/src/schema, registered in the data-files list, validated like the others): per file, its config reads and flag checks; plus a top-level index of flags by `normalized` name with their files and total gated lines, and of config keys with their consumer files.\n- Written only when at least one pack produced either kind. When none did, no file is written and nothing else changes (byte-identical output, no empty file).\n- Do not change sourcevision MCP tool names, required parameters or response shapes. Follow docs/architecture/gateways.md if web or other packages need to see it (they do not in this task).\n- Document the artifact in sourcevision's docs where the other artifacts are listed, marked as new, and mention that Hal reviews the field names (PR body note).\n\nTests: schema validation, writing with a fake producer, and no file without one."
acceptanceCriteria:
  - "The pack contract defines documented ConfigReadFact and FlagCheckFact kinds, listed in PRODUCED_FACT_KINDS"
  - "sourcevision writes a validated config.json with per-file facts and flag/key indexes when a pack produces them"
  - "With no producing pack, no config.json is written and output is byte-identical"
priority: "high"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "lang-kit"
  - "sourcevision"
  - "contract"
---
