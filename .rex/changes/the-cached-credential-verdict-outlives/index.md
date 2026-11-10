---
id: "c963030c-f6cd-4e05-a927-d18cf0af5adb"
type: "change"
title: "The cached credential verdict outlives an LLM config change made outside the dashboard"
slug: "the-cached-credential-verdict-outlives"
intent: "Pre-existing (found by the adversarial review of 47220535; not introduced by it). Verdict: out-of-scope, low.\n\nThe `authCheckCache` in packages/web/src/server/routes-commands.ts (around line 1757) is dropped only by `invalidateAuthCheckCache()`, which is called from one place: the dashboard's PUT /api/llm/config (routes-llm.ts:1544). If `llm.vendor` or `llm.<vendor>.cli` changes some other way, the server keeps the old vendor's verdict. That covers `ndx config llm.vendor codex .` from a terminal, a hand edit to `.n-dx.json` or `.n-dx.local.json`, and a branch switch. The verdict is then served for the new active vendor by POST /api/commands/auth (Robot Wrangler chip) and GET /api/commands/auth/cached (Tune's Your tooling tile).\n\nTrigger: a check passes for claude in Robot Wrangler, then `ndx config llm.vendor codex .` runs while codex is logged out. Tune and Robot Wrangler now show codex as Connected/ok until a manual Re-check or a server restart.\n\nOptions:\n(a) Recommended. Key the cache by the effective (vendor, provider, cli path) and treat a mismatch as a miss. This is cheap and needs no watcher.\n(b) Invalidate from the existing `.n-dx.json` file watcher in start.ts. It also catches local edits, but it adds a seam."
acceptanceCriteria:
  - "After the active vendor changes in .n-dx.json without the dashboard PUT, POST /api/commands/auth runs a fresh check instead of returning the previous vendor's verdict"
  - "After the same change, GET /api/commands/auth/cached returns { cached: false }"
  - "A routes-commands test changes llm.vendor on disk between two auth requests and asserts the second does not reuse the first verdict"
touches:
  - "07e4564e-e181-42c1-be5a-20a16c8d2649"
priority: "low"
discoveredFrom: {"item":"47220535-f736-4de6-863f-f13016f3c34e","run":"9d764631-0fdc-408a-b6a9-7a23521e0e1c"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
