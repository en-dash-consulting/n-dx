---
id: "efc7dfe8-6d04-44b7-8eb2-beb9111fafad"
type: "task"
title: "Display target PRD path in ndx add command output"
slug: "display-target-prd-path-in-ndx-add"
description: "When ndx add (and rex add) creates new items, print the resolved PRD file path the items were written to (e.g. .rex/prd.md or a branch-scoped .rex/prd_{branch}_{date}.md). The message should appear after successful write, before the summary of created items, and should respect --json output mode by including a prdPath field in the JSON payload."
acceptanceCriteria:
  - "Human-readable ndx add output includes a line like 'Added to: .rex/prd.md' identifying the target PRD file"
  - "JSON output mode includes a 'prdPath' field with the absolute or repo-relative path of the target PRD file"
  - "Branch-scoped writes show the correct branch-scoped filename when multi-file mode is active"
  - "Output is shown for both single-task and bulk (--file) add invocations"
  - "Unit or integration test verifies the path appears in stdout for at least one canonical and one branch-scoped scenario"
priority: "medium"
tags:
  - "rex"
  - "cli"
  - "ux"
source: "smart-add"
---
