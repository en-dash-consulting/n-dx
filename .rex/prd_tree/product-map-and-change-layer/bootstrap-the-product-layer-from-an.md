---
id: "3f1ff1cf-7238-4bad-88ca-e1caf9360890"
level: "feature"
title: "Bootstrap the product layer from an established codebase"
status: "pending"
priority: "medium"
blockedBy:
  - "8cc70b76-8b1f-4506-8f5e-799cc153468d"
description: "When ndx is set up for the first time in an established codebase there is no PRD to migrate: `ndx init` runs sourcevision init and a fast analyze, then creates an empty PRD, so the product layer starts empty and placement has nothing to place changes on. Bootstrap proposes the product layer from the code itself (areas, capabilities, constraints, with drafted specs) as a reviewable plan, then applies it once reviewed.\n\nIt reuses the migrations framework from PR 13 (ab7b00bb) with a different source adapter: the codebase map (sourcevision zones, routes, components, file info) plus tests and docs, instead of a v1 tree. The text drafting pass (d6419e1e), the optional Jev confidence pass and review queue (2f0d7092), and the plan file with recorded answers carry over.\n\nShape (to settle in a short design pass before tasks are planned):\n- Which code signals make a capability (zones, routes, components, CLI commands, MCP tools), and how areas get job-shaped names.\n- Init suggests the step at the end and never runs it unasked: init stays fast and makes no model calls. Bootstrap is an explicit, reviewable command.\n- The plan half can land after PR 13; applying waits on the migration apply path (PR 23, 9f75db42).\n- After bootstrap, sourcevision recommendations enter as changes (PR 20) and placement attaches them to the bootstrapped capabilities.\n- The same source-adapter seam later serves tracker imports (the Jira/Notion bridge).\n\nProposed acceptance criteria:\n1. On an established repository with an empty PRD, the bootstrap plan proposes areas, capabilities and constraints, each citing the code and test evidence it came from, and writes nothing to .rex/.\n2. Re-running on an unchanged codebase map produces an identical plan.\n3. ndx init on a codebase with no PRD suggests the bootstrap command and makes no model call.\n4. Applying a reviewed bootstrap plan writes a valid v2 tree through the v2 writer."
lastModified: "2026-10-08T18:09:44.381Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
