---
id: "5ae9199b-e6f0-424c-87ba-20359386b5fa"
type: "change"
title: "Clicking a marked zone on the Codebase map filters the recommended fixes"
slug: "clicking-a-marked-zone-on-the-codebase"
summary: "On the Analysis page, clicking a zone marked with '!' in the left panel filters the recommended fixes, but clicking the same zone on the codebase map does nothing. This makes the map work the same way."
intent: "Left over from change 16b0e619 (Analysis top row). Stat cards and '!' zones in the 'Codebase at a glance' tile filter the 'Recommended fixes' tile, but the Codebase map row is a sandboxed iframe of sourcevision's iso-map export that sends no clicks back to the page. Have the iso-map export post a zone-selected message (postMessage, with an origin check) and have the Analysis page apply the same filter the left tile uses. The iso-map skill script is generated from `packages/sourcevision/src/export/` by `scripts/build-iso-skill.mjs`; regenerate it rather than hand-editing."
acceptanceCriteria:
  - "Clicking a zone on the Codebase map filters the Recommended fixes list to that zone, as clicking it in the left tile does"
  - "The iso-map export sends the selection with postMessage, and the page accepts it only from the map frame"
  - "The map's existing click-for-details and double-click-to-open behaviour is unchanged"
  - "The generated iso-map skill script is rebuilt and tests/e2e/iso-skill-drift.test.js passes"
  - "Tests cover the message handling and the resulting filter"
touches:
  - "acebe9ce-090f-480e-a9fd-e578f2b34a2b"
priority: "low"
discoveredFrom: {"item":"16b0e619-7330-4247-b526-a8148101da4d"}
tags:
  - "web"
  - "sourcevision"
  - "analysis"
source: "ndx-capture"
blockedBy:
  - "16b0e619-7330-4247-b526-a8148101da4d"
---
