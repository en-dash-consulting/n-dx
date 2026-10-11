---
id: "769512f9-3bb0-4505-8713-b7c31d9ccbe0"
level: "task"
title: "Keep the Robot Wrangler page rendering when the config response has no failover block"
status: "pending"
priority: "high"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-5"
source: "claude-code: Robot Wrangler redesign session 2026-10-11 (PR stack) — follow-up to run 43bcae12 / 66468883, whose gate failed when the page crashed on a config without a failover block"
acceptanceCriteria:
  - "`robot-wrangler-vendor.test.ts` passes again, with every vendor, connection and tier test that passed before 2af821998."
  - "With a config response that has no `failover` block, the page renders the vendor cards and a failover toggle with no chain, and does not throw (new test)."
  - "A missing `tiers` or `review` block likewise leaves the rest of the page rendering."
  - "The failover section's own tests in `robot-wrangler.test.ts` still pass."
  - "`pnpm --filter @n-dx/web test`, the package typecheck, and the root affected test gate pass."
description: "Run 43bcae12 (task 66468883) committed the failover section as 2af821998, but its test gate failed with about 40 failures in `packages/web/tests/unit/viewer/robot-wrangler-vendor.test.ts`: vendor cards, connection cards and tier rows, all of which passed before. The cause: `FailoverSection` in `packages/web/src/viewer/views/robot-wrangler.ts` reads `failover.applies` and `failover.chain` unguarded. That file's config fixtures have no `failover` block, so rendering throws a TypeError and the whole page renders nothing, which leaves every element query in those tests `null`.\n\nFix it both ways:\n- **The page must not crash on a missing block.** When `failover` is absent (an older server, or a partial response), render the failover section as the toggle only (enabled from `autoFailover` as before), with no chain and no reason. The rest of the page renders normally. Do the same for `tiers` and `review` wherever the page reads them, so one missing block can never blank the page. Follow how the tier table already tolerates its block being absent.\n- **Fixtures:** add a realistic `failover` block to the shared config fixture in `robot-wrangler-vendor.test.ts`, matching what the server returns: `{ enabled, applies, reason?, chain }`.\n\nAdd one test that renders the page from a config with no `failover` block, and asserts the vendor cards and the failover toggle still render."
lastModified: "2026-10-11T06:06:38.839Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
