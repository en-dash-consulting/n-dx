---
id: "c9867c35-7f69-401d-9908-03bac57a4d6c"
type: "task"
title: "Validate all CLI commands, MCP tools, and web dashboard against multi-file PRD backend"
slug: "validate-all-cli-commands-mcp-tools"
description: "Systematically verify that every command and interface that reads or writes PRD data works correctly with the new multi-file storage. Cover rex CLI commands, ndx orchestration commands, MCP read/write tools, web dashboard PRD tree, and hench task selection. Add integration tests covering multi-branch multi-file scenarios."
acceptanceCriteria:
  - "rex status, next, validate, analyze, recommend, and prune produce correct output with items spanning multiple PRD files"
  - "ndx plan, ndx work, ndx ci, and ndx status operate correctly on aggregated multi-file PRDs"
  - "MCP tools get_prd_status, get_next_task, add_item, edit_item, update_task_status, merge_items, and move_item work with multi-file backend"
  - "Web dashboard PRD tree view renders items from all PRD files in a unified tree"
  - "hench task selection via rex-gateway considers items from all PRD files"
  - "Integration tests cover: two-branch scenario with items in separate files, cross-file item update, and duplicate merge across files"
priority: "high"
tags:
  - "rex"
  - "testing"
  - "integration"
source: "smart-add"
---
