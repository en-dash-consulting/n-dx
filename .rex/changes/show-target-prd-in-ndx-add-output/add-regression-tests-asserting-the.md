---
id: "0e2b33cb-8962-4461-8bf6-b9da271a3197"
type: "task"
title: "Add regression tests asserting the 'Added to:' path resolves on disk for all PRD item levels"
slug: "add-regression-tests-asserting-the"
description: "Lock in the corrected behavior with integration tests that run ndx add (and rex add) for each item level — epic, feature, task, subtask — plus a case that creates new ancestor containers in one call. Each test parses the 'Added to:' line from stdout and asserts the path exists on disk after the command, points at the newly created item, and is workspace-relative. This guards against future folder-tree schema changes silently breaking the copy-paste affordance again."
acceptanceCriteria:
  - "Test cases cover epic, feature, task, and subtask creation"
  - "Test case covers a single invocation that creates new ancestor containers and asserts the deepest path is printed"
  - "Each test parses the 'Added to:' line from CLI stdout and verifies the path exists via fs.stat"
  - "Tests assert paths are workspace-relative (no absolute paths, no leading ./ inconsistencies)"
  - "Tests run as part of the standard rex/ndx integration suite"
  - "Unit tests cover: exact ID match, exact title match, mixed-case title match, multi-match (returns first + warning), and no-match (returns null)"
  - "Integration test calls MCP get_item with a title and asserts item data is returned"
  - "Integration test calls rex update with a title-based identifier and asserts the item is updated"
  - "All new tests pass in CI without modification to existing test fixtures"
priority: "medium"
tags:
  - "test"
  - "rex"
  - "cli"
  - "testing"
source: "smart-add"
---
