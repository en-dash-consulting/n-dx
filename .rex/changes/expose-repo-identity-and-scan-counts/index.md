---
id: "cbb95845-6603-46a1-9e01-2dfe0035df40"
type: "change"
title: "Expose repo identity and scan counts through the child API and hub cards"
slug: "expose-repo-identity-and-scan-counts"
intent: "The hub fans out to every child's `/api/status` via `fetchChildSnapshot` and never reads `.sourcevision/` directly. Keep it that way: the new analysis data reaches the hub only through the child's HTTP API.\n\nAdd `repo` (from the manifest) and summary counts to the sv section of `GET /api/status` in `packages/web/src/server/routes-status.ts` — `outbound`, `infrastructure`, and `readiness.overall` when that field exists from the readiness feature, `null` when it does not. Extend `ChildSnapshot` and `ProjectCard` in `packages/web/src/hub/overview.ts` and show repo name and remote host on the card in `hub/home.ts`. Nothing else in the hub UI changes — the portfolio view is a separate, later piece of work.\n\nEvery sourcevision type consumed here passes through `packages/web/src/server/domain-gateway.ts` as a re-export with no logic."
acceptanceCriteria:
  - "The sv section of `GET /api/status` reports `repo` from the manifest plus counts for `outbound` and `infrastructure`."
  - "`readiness.overall` appears on the sv status when the readiness artifact provides it and is `null` — not absent, not zero — when it does not."
  - "A project analyzed before these fields exist returns the status route without error, with the new fields null or zero rather than throwing."
  - "`ChildSnapshot` and `ProjectCard` in `packages/web/src/hub/overview.ts` carry repo identity, and `hub/home.ts` renders repo name and remote host on each card; no other hub UI changes."
  - "The hub still makes no direct read of any `.sourcevision/` path — all new data arrives via `fetchChildSnapshot`."
  - "Every sourcevision type and value web uses is re-exported through `src/server/domain-gateway.ts` with no logic added, and `tests/e2e/domain-isolation.test.js` passes."
  - "Card assertions are added under `packages/web/tests/unit/hub` and `packages/web/tests/integration/hub-*.test.ts`."
amends: [{"target":"b9d3a37a-9227-4a10-87ba-de286cec7fac","delta":"modified","summary":"Expose repo identity and scan counts through the child API and hub cards","base":"73c2b5c729d04a72777a0649d1fe3bf9259af887764d59858bbff2025a970b58"}]
priority: "medium"
source: "ndx-capture"
blockedBy:
  - "54642f5c-3013-4b0c-81a4-69cc09a24791"
  - "3122b944-2521-4559-8c40-ef066e5319fa"
  - "21c17d38-c771-4e30-9db4-281733055adc"
---
