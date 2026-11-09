---
id: "1ddbce45-9768-4e21-bd5b-210f5d3cef47"
type: "task"
title: "Run the final migration on this repository"
slug: "run-the-final-migration-on-this"
description: "Rebase, run ndx migrate --apply with the approved plan, and add a patch changeset for the migration. PRD writes on main pause only for this step. No major changeset: until Ryan decides to cut 1.0.0, no changeset may be major and no changeset text may announce 1.0.0 (the six @n-dx packages are one fixed version group, so one major bumps all six).\n\nDecided 2026-10-22 (Ryan): the cut migrates the schema only (ndx migrate --plan, then --apply) and keeps .rex/. The move to the .ndx/ layout is a separate step after the cut, because it changes every path the docs, skills and tests name."
acceptanceCriteria:
  - "main's PRD is on .rex/ with schema rex/v2"
  - "rex health reports no errors"
  - "A patch changeset records the migration, and no changeset is major or announces 1.0.0"
priority: "high"
tags:
  - "pr-26"
  - "lane-migration"
  - "core"
source: "roadmap"
blockedBy:
  - "21735168-45e9-4fc5-832f-1d8c6dc666a5"
---
