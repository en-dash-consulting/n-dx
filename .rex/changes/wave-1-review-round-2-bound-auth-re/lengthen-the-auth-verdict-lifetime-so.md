---
id: "2f683bfa-25e6-45e9-99c5-446c003bd6cb"
type: "task"
title: "Lengthen the auth verdict lifetime so visits reuse it"
slug: "lengthen-the-auth-verdict-lifetime-so"
description: "PR #1003 review comment https://github.com/en-dash-consulting/n-dx/pull/1003#discussion_r4558509242. AUTH_CHECK_TTL_MS = 60_000 in packages/web/src/server/routes-commands.ts. useAuthCheck in robot-wrangler.ts POSTs /api/commands/auth on every mount, and each miss runs ndx auth, which sends a real prompt (billed in auth: api mode). Config, env, store and trust changes are already detected directly; only CLI login and keychain state depend on expiry."
acceptanceCriteria:
  - "Revisiting Robot Wrangler within the verdict lifetime reuses the cached verdict and spawns no vendor call."
  - "The lifetime covers several minutes, and Re-check still forces a fresh check."
  - "Config, env, store and trust changes still invalidate the verdict immediately."
priority: "high"
source: "ndx-capture"
---
