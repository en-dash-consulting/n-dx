---
id: "33f281fb-22ab-4f2f-bf3b-973f7dee61be"
level: "task"
title: "Apply repository trust to guard.env and read cli_path from .n-dx.local.json on the cross-vendor reviewer path"
status: "pending"
priority: "medium"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-3"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack)"
startedAt: "2026-10-11T01:14:11.380Z"
acceptanceCriteria:
  - "In an untrusted checkout whose config has `guard.env.allow: [\"*\"]`, the reviewer CLI receives only the default-allowed environment and a warning is printed (unit test)."
  - "In a trusted checkout the configured allow list applies unchanged."
  - "A `cli_path` set only in `.n-dx.local.json` is the path the reviewer is spawned with (unit test)."
  - "Closes #656 and #468."
  - "`pnpm --filter @n-dx/core test` passes."
description: "Two open issues on the path `ndx pair-programming` uses to spawn the reviewer CLI, fixed together before pair review routes more runs through it.\n\n#656: `loadVendorCliEnv(dir, vendor)` in `packages/core/config.js` reads `hench.guard.env` straight from `.hench/config.json` or the `.n-dx.json` hench override, and nothing on that path evaluates repository trust. A cloned or forked repository shipping `guard.env.allow: [\"*\"]` passes every operator credential to the reviewer CLI unasked. Evaluate repository trust there (llm-client's `evaluateRepoTrust`, which config.js can load dynamically). When the checkout is untrusted, or has an unaccepted `env-allow-added` finding, ignore the repository-supplied `guard.env.allow` entries (keep `deny`) and warn once naming the finding.\n\n#468: `resolveVendorCliPath` in `packages/core/pair-programming.js` reads `llm.<vendor>.cli_path` only from `.n-dx.json`, but every `cli_path` is written to `.n-dx.local.json`. Read `.n-dx.local.json` first, then `.n-dx.json`, then fall back to the bare binary name on PATH."
lastModified: "2026-10-11T01:20:10.101Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
