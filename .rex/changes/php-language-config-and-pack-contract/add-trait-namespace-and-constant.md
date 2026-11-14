---
id: "84fe6ecb-f2d1-4d1e-8121-725fc70ca4df"
type: "task"
title: "Add trait, namespace and constant symbol kinds, the conditional guard and include candidates to the pack contract"
slug: "add-trait-namespace-and-constant"
summary: "Extend the shared contract every language pack writes to, so a PHP pack can report traits, namespaces, constants, includes that only run under a condition, and the possible targets of includes built at run time."
description: "Decision D3 (2026-11-12), in `packages/lang-kit/src/pack-contract.ts`:\n\n1. `SYMBOL_KINDS` gains `trait`, `namespace` and `constant`. Document them in the doc comment the way the other kinds are documented (PHP `trait T {}`, `namespace A\\B;`, `const X = 1;` at namespace level, class constants, and `define('X', …)` with a literal name). Keep language terms: a trait is not reported as a class or interface.\n2. `ImportGuard` gains `conditional`: an import that runs only under a condition — PHP `include`/`require` inside `if`/`else`/`switch`/a loop, inside a function or method body, or behind a `function_exists`/`class_exists`/`defined` check. Document it next to `type-checking` and `optional`.\n3. Dynamic-include candidates: add an optional, documented field on `WrittenImport` (for example `candidates?: readonly string[]`, sorted, distinct, project-relative paths) for an include whose path is built at run time but starts with a literal prefix (`\"config/\" . $_SERVER['HTTP_HOST'] . \".php\"` → files under `config/` ending in `.php`). Candidates are evidence, not edges: state in the doc comment that consumers must never turn them into import edges.\n\nThen make every sourcevision consumer accept the new values without changing output for existing packs: schema enums, validators and type guards that list symbol kinds or guards (search packages/sourcevision/src for `SYMBOL_KINDS`, `ImportGuard`, `type-checking`), JSON schemas for persisted artifacts, and any MCP response typing — optional values only, no tool name or required-parameter changes. If an artifact schema has no place for candidates, keep them in memory only and say so in the doc comment; do not add a persisted field in this task.\n\nTests: contract unit tests for the new kinds and guard, a sourcevision test that a fact carrying `trait`/`namespace`/`constant` and a `conditional` import round-trips through the facts-out adapter, and a test that candidates never produce edges."
acceptanceCriteria:
  - "SYMBOL_KINDS includes trait, namespace and constant, and ImportGuard includes conditional, each documented"
  - "WrittenImport has an optional documented candidates field, and a test proves candidates never become import edges"
  - "Existing packs' output and all non-PHP analyze output are byte-identical"
priority: "high"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":120}
tags:
  - "php"
  - "lang-kit"
  - "contract"
blockedBy:
  - "94b212f6-fac0-4adb-8a12-814d38e792f9"
---
