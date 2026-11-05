---
id: "4841fb59-8f6b-41d5-97bf-461e46396e26"
type: "task"
title: "A narrow Sidecar barrel keeps the hub drawer page under 150 KB"
slug: "a-narrow-sidecar-barrel-keeps-the-hub"
description: "Option (b) of change 348b34e6: a narrow viewer barrel (for example src/viewer/sidecar/index.ts) re-exporting only the Sidecar hooks and components the drawer entry needs, allowed by boundary-check. Not option (a): a wrong sideEffects entry silently drops dashboard code."
acceptanceCriteria:
  - "A test builds src/viewer/hub-session.ts with build.js's options and fails when the bundle includes zod or src/viewer/loader/"
  - "dist/viewer/hub-session.html is under 150 KB after pnpm --filter @n-dx/web build, and the main dashboard bundle is unchanged in behaviour (its tests pass)"
  - "boundary-check.test.ts passes without a blanket exemption for hub-session.ts; the narrow barrel is named in the rule that allows it"
priority: "low"
source: "adversarial-review"
---
