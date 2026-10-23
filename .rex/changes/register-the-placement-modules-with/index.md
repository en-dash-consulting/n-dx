---
id: "5f83d450-be18-4620-9c8b-594745e84457"
type: "change"
title: "Register the placement modules with the v2 isolation test"
slug: "register-the-placement-modules-with"
intent: "Run 2fa34877's gate (run db35fba1) failed only because core/placement.ts now imports a runtime value (ADDED_NODE_TYPES) from schema/v2.ts and the v2 isolation test in packages/rex/tests/unit/schema/v2.test.ts ('no runtime module imports the v2 modules yet') does not list it. Add core/placement.ts and core/placement-policy.ts (which imports placement.ts) to the v2 module set in that test, as PRs 10 and 11 did for their modules, and update the comment that lists the v2 modules. Change nothing else. The full rex suite must pass. Decided 2026-10-08 (Ryan, option a)."
touches:
  - "51527b42-cc67-4a5a-83b3-61179298dfaf"
priority: "critical"
---
