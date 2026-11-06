---
id: "7a5ad68c-e6f0-4530-93a8-d0c1bf05c251"
type: "change"
title: "docs/cli-ui-gap.md says the credential chip calls GET /api/commands/auth, a route that no longer exists"
slug: "docs-cli-ui-gap-md-says-the-credential"
intent: "Pre-existing (found by the adversarial review of 47220535; not introduced by it). Verdict: out-of-scope, low.\n\ndocs/cli-ui-gap.md:121 is a hand-written row, outside the generated section. It says the `ndx auth` coverage is the Robot Wrangler chip via \"GET `/api/commands/auth`\". That route is POST-only. trust-gate-routes.test.ts asserts \"GET /api/commands/auth is no longer a route\", and Robot Wrangler's useAuthCheck POSTs. A reader following the doc gets a non-200. Tune's tile now reads GET /api/commands/auth/cached, which never spawns.\n\nFix: change the row to POST `/api/commands/auth` (re-check via `?refresh=true`) and mention the read-only GET `/api/commands/auth/cached`. This is a doc-only edit, and the root-docs subset (cli-ui-gap-drift) covers the file."
acceptanceCriteria:
  - "docs/cli-ui-gap.md names POST /api/commands/auth for the Robot Wrangler credential chip"
  - "docs/cli-ui-gap.md names GET /api/commands/auth/cached as the read-only cached verdict"
  - "node scripts/run-all-tests.mjs root-docs passes"
touches:
  - "07e4564e-e181-42c1-be5a-20a16c8d2649"
priority: "low"
discoveredFrom: {"item":"47220535-f736-4de6-863f-f13016f3c34e","run":"9d764631-0fdc-408a-b6a9-7a23521e0e1c"}
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
