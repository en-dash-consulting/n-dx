---
id: "348b34e6-db4d-4ceb-b316-c3fe950276fb"
type: "change"
title: "The hub session drawer page bundles the whole dashboard (~545 KB) because the viewer barrels carry it"
slug: "the-hub-session-drawer-page-bundles"
intent: "Found by adversarial review of task ea48bb24 (hub home docks the hub session). Verdict: should-fix, low.\n\nScenario: dist/viewer/hub-session.html (built by packages/web/build.js from src/viewer/hub-session.ts) is ~545 KB. Of that, ~490 KB is dashboard code the drawer never runs: zod (via hooks/index.ts → use-app-data → loader/schema/validate.ts), guide.ts, and the top-nav and task-start components (via components/index.ts and api.ts). The entry imports only the Sidecar hooks and the drawer, but tests/integration/boundary-check.test.ts (\"hooks consumers import through barrel\", \"panel component imports … must use barrel\") requires barrel imports from outside hooks/ and components/. esbuild cannot drop the unused barrel modules because the web package does not declare them free of side effects. A direct-import build measured ~55 KB.\n\nReachable: every first open of the Hub session toggle on the hub home loads the page into its iframe. It is a loopback page, so the cost is parse time and memory, not network.\n\nOptions:\n(a) Mark the viewer's side-effect-free modules with \"sideEffects\" in packages/web/package.json (list the files that do have side effects, such as CSS and registration imports). Cheap, but a wrong entry silently drops code from the main dashboard. Needs a check that the dashboard bundle is unchanged.\n(b) Add a narrow barrel (e.g. viewer/sidecar/index.ts) re-exporting only the Sidecar hooks and components, and allow it in boundary-check. Moderate cost, explicit, no global risk. Recommended.\n(c) Exempt hub-session.ts from the barrel rules. Cheapest, but erodes the policy."
acceptanceCriteria:
  - "A test builds src/viewer/hub-session.ts with build.js's options and fails when the bundle includes zod or src/viewer/loader/"
  - "dist/viewer/hub-session.html is under 150 KB after pnpm --filter @n-dx/web build"
  - "boundary-check.test.ts passes without a blanket exemption for hub-session.ts"
touches:
  - "ed4461f5-7667-4c72-bbee-f39457b951fe"
priority: "low"
discoveredFrom: {"item":"ea48bb24-27cc-4224-9e09-2d6ab4a54cc2","run":"04336996-e27f-42a3-85f2-d851bdbcdfe9"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
