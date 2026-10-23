---
id: "20db52b8-3434-4058-bd29-93bc901cc328"
type: "task"
title: "Address pattern issues (2 findings)"
slug: "address-pattern-issues-2-findings-20db52"
description: "- Documentation zone is safely decoupled from all source zones; however, machine-parsed docs (prompt templates, config schemas) would be invisible to the import graph and should instead live in the relevant source package with explicit exports.\n- Missing unit test for task-usage.ts entry point: 2 of 3 source files have tests but the public-facing entry point does not. If task-usage.ts contains non-trivial aggregation or routing logic, this is a coverage gap that should be closed."
priority: "high"
source: "sourcevision"
---
