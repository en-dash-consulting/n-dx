---
id: "7a265498-6a49-4c2e-bb60-7459c85865b1"
type: "task"
title: "rex init --help says it writes prd.json; it writes product/index.md (v2) or prd_tree/"
slug: "rex-init-help-says-it-writes-prd-json"
description: "packages/rex/src/cli/help.ts:27 describes rex init as \"Sets up .rex/ with config.json, prd.json, and workflow.md\". No PRD mutation has written prd.json since the folder tree, and since ff12092b a new project gets product/index.md (rex/v2); an existing v1 project keeps prd_tree/. Reachable: `rex init --help`, `ndx rex init --help`. Verdict should-fix (low): no wrong behaviour, but the help is the first thing a new user reads about what init creates. Fix: reword the description to name config.json, workflow.md, and the PRD tree (an empty v2 tree for a new project; an existing PRD keeps its layout). Cost: one string plus a help assertion; risk none. Check command-docs-parity if the help text is mirrored in docs."
acceptanceCriteria:
  - "rex init --help no longer names prd.json"
  - "rex init --help says a new project gets an empty v2 tree (product/index.md) and an existing PRD keeps its layout"
  - "A help test asserts the description (fails on today's text)"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "rex"
  - "lane-migration"
source: "ndx-adversarial-review"
---
