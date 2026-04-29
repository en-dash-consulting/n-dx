---
id: "01490ebc-ec8c-4b4d-b4b3-3120815757ef"
level: "task"
title: "Call graph extraction and analysis"
status: "completed"
source: "smart-add"
startedAt: "2026-02-11T13:22:19.915Z"
completedAt: "2026-02-11T13:22:19.915Z"
acceptanceCriteria: []
description: "Build comprehensive call graph analysis that tracks function calls, method invocations, and cross-module dependencies beyond simple imports\n\n---\n\nAllow users to toggle the import graph visualization on/off due to current usability limitations"
---

## Subtask: Implement call graph extraction and storage infrastructure

**ID:** `65a2d97f-0a8d-445b-88c4-94cb80a4eefd`
**Status:** completed
**Priority:** high

Parse TypeScript/JavaScript ASTs to extract function calls and build efficient data structures for storing and querying call graph relationships

**Acceptance Criteria**

- Extracts direct function calls with caller-callee relationships
- Identifies method invocations on objects and classes
- Handles property access chains and destructured calls
- Processes both local and imported function references
- Stores caller-callee relationships with source location metadata
- Supports efficient queries for direct and transitive dependencies
- Handles cyclic call relationships without infinite loops
- Integrates with existing sourcevision data storage format

---

## Subtask: Integrate call graph analysis into sourcevision pipeline and web UI

**ID:** `8f924457-7ac0-43cb-8f0e-cfb66b9fedc6`
**Status:** completed
**Priority:** medium

Integrate call graph extraction into the main analysis pipeline and create interactive visualization with zone analysis enhancements

**Acceptance Criteria**

- Call graph analysis runs as part of sourcevision analyze
- Results are stored in sourcevision manifest and data files
- Analysis progress is reported to user during execution
- Handles analysis failures gracefully without breaking main pipeline
- Displays functions as nodes with call relationships as directed edges
- Supports filtering by file, zone, or function name patterns
- Provides zoom, pan, and layout controls like import graph viewer
- Shows call frequency and complexity metrics on hover
- Zone detection considers both import and call relationships
- Call graph metrics contribute to zone cohesion scores
- Cross-zone call patterns are identified and reported
- Zone summaries include call graph connectivity statistics

---

## Subtask: Generate architectural findings and recommendations from call graph data

**ID:** `2cd1fd02-c436-4602-936a-e1badd2472ee`
**Status:** completed
**Priority:** low

Analyze call graph patterns to identify architectural issues and generate actionable recommendations for code quality improvements

**Acceptance Criteria**

- Identifies functions with excessive outgoing calls (god functions)
- Detects tightly coupled modules through dense call patterns
- Finds potentially dead code with no incoming calls
- Suggests refactoring opportunities based on call patterns

---

## Subtask: Add import graph toggle to SourceVision UI

**ID:** `75d504cd-d043-43c6-81bf-5290a0254921`
**Status:** completed
**Priority:** low

Implement a toggle control that allows users to hide/show the import graph visualization when it becomes overwhelming or unusable for large projects

**Acceptance Criteria**

- Toggle control is visible in SourceVision section of web UI
- Import graph is hidden by default when toggle is off
- Toggle state persists across browser sessions
- Toggle affects only import graph, not other SourceVision features

---
