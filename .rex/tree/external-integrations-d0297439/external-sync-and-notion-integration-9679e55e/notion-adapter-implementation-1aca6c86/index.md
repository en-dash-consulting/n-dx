---
id: "1aca6c86-7f94-4278-befd-c8d0b125a71d"
level: "task"
title: "Notion adapter implementation"
status: "completed"
source: "llm"
startedAt: "2026-02-24T20:33:37.695Z"
completedAt: "2026-02-24T20:33:37.695Z"
description: "Specific implementation for Notion database integration\n\n---\n\n- Heavy cross-zone coupling (web-16 → web: 13 imports, web-24 → web-20: 9 imports) indicates missing abstraction layers between implementation details\n- Missing shared visualization interface abstraction forces chart and navigation zones to couple directly to different foundation systems\n- Multiple service layers (queue, validation) exceed expected coupling thresholds for isolated components, indicating insufficient architectural boundaries\n- Token usage views mixed into polling infrastructure zone instead of being consolidated with other usage analytics functionality\n- UI zone organization lacks consistent abstraction strategy - general utilities scattered across domain zones while application views leak into foundation layer\n- View components scattered across utility zones instead of grouped in dedicated view/page architectural layer\n- Web-16 zone imports heavily from multiple zones (13+8 imports) suggesting it occupies wrong architectural layer or needs interface abstraction\n- God function: PRDView in packages/web/src/viewer/views/prd.ts calls 83 unique functions — consider decomposing into smaller, focused functions\n- Web package exhibits god-zone anti-pattern where primary web zone (137 files) acts as catch-all while specialized concerns fragment into 28 micro-zones, inverting expected architectural hierarchy"
---

## Subtask: Map PRD hierarchy to Notion structure

**ID:** `8489d495-c32e-43b9-971c-8ac3142f6215`
**Status:** completed
**Priority:** medium

Create mapping between PRD items and Notion database structure

**Acceptance Criteria**

- Epics as top-level pages
- Features and tasks as sub-items
- Hierarchy preserved correctly

---

## Subtask: Sync all PRD fields to Notion

**ID:** `2aaae13a-0d78-4706-bacf-687296f37b85`
**Status:** completed
**Priority:** medium

Support status, priority, description, criteria, and tags in Notion

**Acceptance Criteria**

- All PRD fields mapped
- Status values synchronized
- Priority levels matched
- Rich text fields supported

---

## Subtask: Use Notion native properties

**ID:** `1f98431d-0c61-471c-b9d7-fc596bb96d18`
**Status:** completed
**Priority:** low

Map to Notion's built-in status and priority properties

**Acceptance Criteria**

- Uses Notion status property type
- Uses Notion priority property type
- Maintains compatibility with rex values

---

## Subtask: Implement conflict resolution

**ID:** `9ccb5785-1bcd-4c29-a957-d56b9ff55430`
**Status:** completed
**Priority:** medium

Handle conflicts when both local and Notion have changes

**Acceptance Criteria**

- Last-write-wins strategy
- Conflict warnings logged
- Data integrity maintained

---

## Subtask: Decompose PRDView god function into focused hooks

**ID:** `6fde7365-32a6-4658-8bc5-2ff19da46e6a`
**Status:** completed
**Priority:** critical

Extract PRDView (941 lines, 83 unique function calls) into focused custom hooks: usePRDData (fetch/polling/dedup), usePRDWebSocket (WS pipeline), usePRDActions (CRUD mutations), usePRDDeepLink (deep link resolution), useToast (notification state). PRDView should become a thin render shell that composes these hooks.

**Acceptance Criteria**

- PRDView function body is under 200 lines
- Each extracted hook has a single responsibility
- No behavior changes - all existing functionality preserved
- Tests continue to pass
- TypeScript compiles without errors

---
