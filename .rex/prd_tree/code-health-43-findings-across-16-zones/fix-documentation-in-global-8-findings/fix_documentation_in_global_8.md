---
id: "7d140635-dd3c-4488-b008-d9f792b61519"
level: "feature"
title: "Fix documentation in global (8 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-14T01:51:57.519Z"
completedAt: "2026-04-14T01:51:57.519Z"
acceptanceCriteria: []
description: "- Add a policy note to CLAUDE.md's dual-fragility governance section clarifying whether the 'production zones' qualifier intentionally excludes test zones from the two-consumer rule and addition-review requirements. packages-web:unit-server (cohesion 0.45, coupling 0.55) is a concrete case where the exclusion is ambiguous and ungoverned.\n- Audit all manually maintained governance lists in the codebase (PANEL_FILES in boundary-check.test.ts, injection seam registry in CLAUDE.md, gateway table in CLAUDE.md) for automated completeness-check coverage. Any list with no exhaustiveness assertion is a silent governance drift risk as the codebase grows.\n- Create a zone-pin manifest in sourcevision configuration listing all intentionally pinned files with the reason for each pin. At minimum six files are known to need pinning to eliminate phantom coupling artifacts; without a central manifest each re-analysis regenerates phantom edges and requires per-reviewer knowledge of the insight history.\n- Establish a formal zone promotion checklist triggered when any sub-directory crosses the 5-file reliable-metrics threshold: (1) CLAUDE.md zone policy entry, (2) zone-pin configuration for anchor files, (3) index.ts barrel if absent. Document the checklist in TESTING.md or a ZONES.md to prevent ad-hoc promotion decisions and ensure the two governance mechanisms stay in sync.\n- Establish a zone ID naming convention that encodes the package in all zone prefixes: 'sv-' for packages/sourcevision/, 'rex-' for packages/rex/, 'web-server-' for web server zones, 'web-viewer-' for web viewer zones, and 'web-sv-' for web package zones that render sourcevision data. Apply this retroactively to sourcevision-view-tests (→ web-sv-view-tests) to eliminate the cross-package prefix collision that makes zone-filter queries unreliable.\n- Four enrichment passes have fully characterized but not resolved: completion-reader.ts dead code, rex-2 zone naming, web-helpers↔web-viewer levels.ts cycle, and hench-4 genuine bidirectional coupling. None of these requires further analysis — all resolution paths are known. Creating PRD tasks for each would convert them from perpetual insight record entries into tracked work items with owners.\n- Zone coupling reports present artifact-driven bidirectional pairs (four of five in the web package) identically alongside the one genuine cycle, providing no triage signal for reviewers — a 'zone-pin confirmed / artifact suppressed' annotation in sourcevision zone metadata would allow governance tooling to distinguish known-artifact pairs from actionable architectural violations without requiring per-reviewer knowledge of the underlying misclassifications.\n- rex-2 (4 files, cohesion 1, 5 inbound imports from the rex hub) is an unnamed overflow zone with no documentation, no zone pinning, and no descriptive ID. Its files are invisible to API surface audits and changeset impact analysis for the rex package. This is a governance gap that compounds silently as the rex package evolves — each new rex feature that touches rex-2 files goes unnoticed by zone tooling."
recommendationMeta: "[object Object]"
---

## Children

| Title | Status |
|-------|--------|
| [Fix documentation in global: Add a policy note to CLAUDE.md's dual-fragility governance section clarifying wh (+7 more)](./fix-documentation-in-global-add-907a29/index.md) | completed |
