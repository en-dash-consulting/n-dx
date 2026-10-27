---
id: "3f1ff1cf-7238-4bad-88ca-e1caf9360890"
type: "capability"
title: "Bootstrap the product layer from an established codebase"
slug: "bootstrap-the-product-layer-from-an"
statement: "Rex drafts capability specs with code files taken from the codebase's .sourcevision output, which it reads from disk without importing sourcevision."
criteria: [{"id":"c1","text":"When .sourcevision output is present, the rex migration reader shall build a map from each capability to its code files, using zones.json and the files that capability's tests exercise."},{"id":"c2","text":"The capability spec drafter shall add each capability's code files from the reader's map to the spec it drafts."},{"id":"c3","text":"If the project has no .sourcevision directory, the reader shall return an empty map and the migration plan shall stay unchanged."},{"id":"c4","text":"Rex shall read the .sourcevision output files directly and shall not import from the sourcevision package."},{"id":"c5","text":"The migration shall keep the capability-to-code-files map in the plan and shall not store code files on capabilities."}]
priority: "medium"
---

When ndx is set up for the first time in an established codebase there is no PRD to migrate: `ndx init` runs sourcevision init and a fast analyze, then creates an empty PRD, so the product layer starts empty and placement has nothing to place changes on. Bootstrap proposes the product layer from the code itself (areas, capabilities, constraints, with drafted specs) as a reviewable plan, then applies it once reviewed.

It reuses the migrations framework from PR 13 (ab7b00bb) with a different source adapter: the codebase map (sourcevision zones, routes, components, file info) plus tests and docs, instead of a v1 tree. The text drafting pass (d6419e1e), the optional Jev confidence pass and review queue (2f0d7092), and the plan file with recorded answers carry over.

Shape (to settle in a short design pass before tasks are planned):
- Which code signals make a capability (zones, routes, components, CLI commands, MCP tools), and how areas get job-shaped names.
- Init suggests the step at the end and never runs it unasked: init stays fast and makes no model calls. Bootstrap is an explicit, reviewable command.
- The plan half can land after PR 13; applying waits on the migration apply path (PR 23, 9f75db42).
- After bootstrap, sourcevision recommendations enter as changes (PR 20) and placement attaches them to the bootstrapped capabilities.
- The same source-adapter seam later serves tracker imports (the Jira/Notion bridge).

Proposed acceptance criteria:
1. On an established repository with an empty PRD, the bootstrap plan proposes areas, capabilities and constraints, each citing the code and test evidence it came from, and writes nothing to .rex/.
2. Re-running on an unchanged codebase map produces an identical plan.
3. ndx init on a codebase with no PRD suggests the bootstrap command and makes no model call.
4. Applying a reviewed bootstrap plan writes a valid v2 tree through the v2 writer.
