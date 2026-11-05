---
id: "99692891-d095-469e-aa09-1725b77e87de"
type: "change"
title: "Plan health, Specs to tighten, and Apply from the dashboard"
slug: "plan-health-specs-to-tighten-and-apply"
intent: "Slice S4 of the Plan page redesign (design: https://claude.ai/artifact/Sf8eeMzb9rew5phdqNCp1X, decisions PP2, PP11, PP12).\n\n- rex validate gains a check for stale release plans: an open change planned for a release that has shipped (some change carries shippedIn for it) or for one older than the newest shipped release. On this repository on 2026-10-28 that is 3 changes (one for 0.10.0, two for 0.8.0). Because the rule lives in rex, the CLI, MCP and the dashboard report the same thing. Changes with no planned release are not flagged.\n- A Plan health panel replaces the Validation preview: the last check's results as lights, with Check, Fix and Reshape (Fix and Reshape still preview before they write).\n- A Specs to tighten panel: changes with no acceptance criteria, tasks with none, changes waiting on a blocker and amendments awaiting review, each a link to the filtered list; zero rows hidden. Requirement coverage joins once the project has a requirement; until then one line says why Ready reads 0 and links the Product page's Requirements tab.\n- Apply from the dashboard: a change awaiting apply (completed, not applied) gets an Apply action in its detail panel and from the strip's Awaiting apply count, through the same rex core as MCP apply_change, previewed before it writes. Today the dashboard has no way to apply."
acceptanceCriteria:
  - "rex validate (CLI and MCP) reports open changes planned for a shipped or superseded release, and does not flag unscheduled changes"
  - "Plan health shows the last validation result with Check, Fix and Reshape"
  - "Specs to tighten lists only non-zero gaps, each linking to its filtered list"
  - "A change awaiting apply can be applied from its detail panel after a preview of what applying changes on the product map, and the write goes through rex's apply"
touches:
  - "ab9eeda9-2419-4ef0-bff4-4c20251758aa"
  - "a53b2572-87a8-4eb2-804a-2b9ae668b930"
  - "d3bfe8a4-c3d5-4aa4-893b-36fc58647dca"
priority: "medium"
tags:
  - "web"
  - "rex"
  - "dashboard"
  - "plan-page-redesign"
source: "ndx-capture"
blockedBy:
  - "9e95f7f4-a9ba-4a9a-a66b-300a0d2f7509"
  - "f86e6895-eaa2-4d7f-85c8-e6964a9b1fa7"
---
