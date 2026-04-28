---
id: "8a4773af-894f-4245-9bbf-7bf676abd527"
level: "task"
title: "Scan Result Processing"
status: "completed"
source: "llm"
startedAt: "2026-02-09T15:29:11.123Z"
completedAt: "2026-02-09T15:29:11.123Z"
description: "Improve the quality and accuracy of code analysis"
---

## Subtask: Enhance similarity detection for deduplication

**ID:** `e96c0946-3976-47aa-9670-d93e929df9b1`
**Status:** completed
**Priority:** medium

Improve similarity function and deduplicateScanResults logic

**Acceptance Criteria**

- Duplicate scan results are accurately identified
- Similar items are merged intelligently
- Performance is maintained for large codebases

---

## Subtask: Improve proposal building logic

**ID:** `764452f8-0554-4a7b-b237-729e679d3382`
**Status:** completed
**Priority:** high

Enhance buildProposals hierarchy generation

**Acceptance Criteria**

- Epic/feature/task hierarchy is logical
- Proposals match project domain
- Related items are grouped appropriately

---

## Subtask: Add structured file format detection

**ID:** `7fef6cda-6eee-4b84-a515-6b5261c3cb2a`
**Status:** completed
**Priority:** medium

Implement detectFileFormat and parseStructuredFile

**Acceptance Criteria**

- JSON and YAML files are parsed correctly
- File format detection is accurate
- Parsing errors are handled gracefully

---

## Subtask: Implement intelligent result merging

**ID:** `aef1c182-56b1-4d01-829a-50d7fbe85a07`
**Status:** completed
**Priority:** high

Merge similar scan results while preserving distinct ones

**Acceptance Criteria**

- keeps distinct results unchanged
- merges exact duplicates (case-insensitive)
- merges near-duplicate scan results
- only merges results of the same kind
- prefers result with higher priority
- prefers result with description over one without
- prefers result with acceptance criteria
- prefers longer (more descriptive) title when merging
- supports custom similarity threshold
- handles large result sets in reasonable time
- merges acceptance criteria from duplicate results

---

## Subtask: Implement proposal merging logic

**ID:** `5604c1ad-35f1-4453-87f0-00aeb8524594`
**Status:** completed
**Priority:** medium

Merge proposals intelligently while preserving structure

**Acceptance Criteria**

- merges proposals with the same epic title
- deduplicates features within the same epic
- merges tasks into existing features
- keeps distinct epics separate
- does not mutate input proposals

---

## Subtask: Support multi-file reasoning

**ID:** `5591cc9b-d36e-45de-9647-8203ad7b6362`
**Status:** completed
**Priority:** medium

Process and combine multiple input files

**Acceptance Criteria**

- processes a single JSON file
- combines files with distinct epics
- combines JSON and YAML files

---

## Subtask: Implement chunking for large results

**ID:** `cdf959a7-803d-435b-b27b-0f2f32b66379`
**Status:** completed
**Priority:** medium

Handle large scan result sets by chunking

**Acceptance Criteria**

- formats a single result with all fields
- handles results with no optional fields
- splits results into multiple chunks when they exceed the limit
- preserves result order within chunks
- puts a single oversized result in its own chunk

---

## Subtask: Enhanced JSON extraction

**ID:** `3dab4b0e-3429-4212-943c-a0d99b906bf7`
**Status:** completed
**Priority:** high

Robust JSON extraction from mixed content

**Acceptance Criteria**

- strips leading prose before JSON array
- handles nested arrays correctly
- prefers code fences over bare JSON
- recovers from truncated JSON
- strips leading prose from LLM response
- falls back to lenient parsing when some items are invalid
- throws descriptive error when nothing is salvageable
- provides useful error message for non-JSON

---

## Subtask: Implement proposal quality validation

**ID:** `a6bae265-0984-4b7d-a133-5e36b6f0011d`
**Status:** completed
**Priority:** medium

Validate and warn about proposal quality issues

**Acceptance Criteria**

- warns about tasks missing description and criteria
- warns about very short task titles
- warns about features with no tasks
- counts across multiple proposals with parentLevel
- accepts tasks with only description (no criteria)

---

## Subtask: Implement proposal quality validation system

**ID:** `87bb286d-7eb1-4a98-9394-c85e19f64459`
**Status:** completed
**Priority:** medium

Add validation checks for proposal completeness and quality standards

**Acceptance Criteria**

- warns about tasks missing description and criteria
- warns about very short task titles
- warns about features with no tasks
- accepts tasks with only description (no criteria)
- accepts tasks with only criteria (no description)

---

## Subtask: Implement cross-proposal validation and counting

**ID:** `d0f2be2c-a57a-4eac-946d-fee5a7bd0012`
**Status:** completed
**Priority:** medium

Add validation that works across multiple proposals and provides accurate counts

**Acceptance Criteria**

- counts across multiple proposals with parentLevel
- reports all issues across multiple proposals
- counts items across multiple proposals

---

## Subtask: Implement proposal diffing system

**ID:** `401c3c78-1fec-4402-9c07-eb0dc4af614f`
**Status:** completed
**Priority:** high

Compare new proposals against existing PRD structure

**Acceptance Criteria**

- marks existing epics that match proposals
- marks existing features under existing epics
- marks existing tasks as unchanged
- handles multiple epics with mixed existing/new
- counts unchanged items separately from additions

---

## Subtask: Implement findings-first analysis

**ID:** `2354d362-6c8f-46df-8532-196f3b6e8aca`
**Status:** completed
**Priority:** medium

Support generating structural findings without requiring AI enrichment

**Acceptance Criteria**

- produces structural findings at pass 0 with enrich: false
- generates structural insights without AI
- assigns proximity files to reduce unzoned count

---

## Subtask: Maintain backward compatibility for insights

**ID:** `dda88308-2bb6-4ce2-8d00-3ee31f43d2f4`
**Status:** completed
**Priority:** high

Ensure new findings format maintains compatibility with existing insights format

**Acceptance Criteria**

- populates both findings and insights for backward compat
- structural findings have severity based on content

---
