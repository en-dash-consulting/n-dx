---
id: "fe3eb56e-a017-4e19-980d-d3590b632824"
level: "task"
title: "File and Format Detection"
status: "completed"
source: "llm"
startedAt: "2026-02-09T16:13:11.734Z"
completedAt: "2026-02-09T16:13:11.734Z"
acceptanceCriteria:
  - "cmdConfig in hench/cli/commands/config.ts is not flagged as unused"
  - "Validators in web/schema/validate.ts are not flagged as unused"
  - "Components in health-gauge.ts and logos.ts are not flagged as unused"
  - "No regression in detecting genuinely dead exports"
description: "Improve file handling and format detection capabilities\n\n---\n\nThe detectDeadExports() function in callgraph-findings.ts only checks the call graph for usage. Exports consumed via dynamic imports (await import()) or used only through import edges (not direct calls) are incorrectly flagged as dead. This produces false positives for CLI command registrations (cmdConfig) and validators used through import chains."
---

## Subtask: Improve file format detection and import

**ID:** `72444020-200d-4aee-bc4a-34b223d74925`
**Status:** completed
**Priority:** low

Enhance file format detection for full paths and support multiple JSON/YAML schemas for PRD import with deduplication.

**Acceptance Criteria**

- Handles commands with full paths
- Handles full paths
- parses JSON file matching Proposal schema directly
- parses JSON file with flat items array
- parses JSON file with nested objects
- parses YAML file with title/description pairs
- parses YAML file with name fields
- deduplicates against existing PRD items
- preserves description in JSON items

---

## Subtask: Implement structured file parsing

**ID:** `bfe24c09-b4f7-4a4f-9999-80a69cf1d5d9`
**Status:** completed
**Priority:** medium

Parse JSON and YAML files with flexible schemas

**Acceptance Criteria**

- parses valid JSON array into proposals
- extracts JSON from markdown code fences
- strips code fences without json language tag
- preserves optional fields
- rejects missing epic title
- throws on invalid JSON
- detects markdown from .txt extension
- defaults to markdown for unknown extensions
- merges case-insensitively

---

## Subtask: Fix dead export detection to cross-reference import graph

**ID:** `e372d0df-e3c6-4cb6-bfe7-4e69251ea7a4`
**Status:** completed
**Priority:** high

In callgraph-findings.ts:199-300, detectDeadExports() only checks the call graph for usage, missing exports consumed via dynamic imports, static imports without call edges (JSX components, validators), and import chains. Fix: after building the calledFunctions set from call edges, also mark an export as used if its name appears in any import edge's symbols array (static, dynamic, or require types). This covers dynamic imports (await import()), JSX element usage, and inline calls that don't produce CallExpression nodes. Add unit tests covering: dynamic-import-only usage, static-import-only usage (no call edge), genuinely dead exports, re-exported symbols, and class instance methods.

---

packages/hench/src/store/suggestions.ts exports loadSuggestionHistoryAsync and saveSuggestionHistoryAsync which have no callers. The synchronous versions (loadSuggestionHistory, saveSuggestionHistory) are used. Remove the async exports, or if they exist for a planned feature, document that intent.

**Acceptance Criteria**

- detectDeadExports consults import graph edges with type 'dynamic' and 'require' in addition to call graph edges
- cmdConfig (imported via dynamic import in hench CLI router) is no longer flagged as unused
- pnpm test passes for sourcevision package
- Exports that appear in import edge symbols (static, dynamic, or require) are not flagged as dead
- validate.ts validators, health-gauge.ts components, and logos.ts exports are no longer flagged
- Genuinely dead exports (not imported anywhere) are still detected
- Test file exists covering all 5 edge cases
- All tests pass
- loadSuggestionHistoryAsync and saveSuggestionHistoryAsync are either removed or documented with a tracking reference
- pnpm typecheck and pnpm test pass

---
