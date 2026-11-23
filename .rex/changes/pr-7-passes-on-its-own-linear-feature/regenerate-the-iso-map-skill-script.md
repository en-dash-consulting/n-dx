---
id: "b6a4afb3-252c-4e5f-a6d1-c30c4cb85fc5"
type: "task"
title: "Regenerate the iso-map skill script"
slug: "regenerate-the-iso-map-skill-script"
summary: "Rebuilds a generated script so it matches the code it is built from."
description: "Run `node scripts/build-iso-skill.mjs` from the repository root and commit the regenerated `.claude/skills/iso-map/scripts/iso-map.mjs`. Do not edit the script by hand (tests/e2e/iso-skill-drift.test.js fails a hand edit). Then run `npx vitest run tests/e2e/iso-skill-drift.test.js` from the root."
acceptanceCriteria:
  - "tests/e2e/iso-skill-drift.test.js passes"
  - "Only the generated script changes"
priority: "high"
run: {"tier":"standard","skipTestGate":true}
---
