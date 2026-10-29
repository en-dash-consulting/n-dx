---
id: "77433115-5cc2-4c15-a8b0-83b16f25d235"
type: "change"
title: "graview.app from the repository's config runs its own dev server without a trust check"
slug: "graview-app-from-the-repository-s"
intent: "Out-of-scope finding from the adversarial review of 083c929b (graview.bin waits for trust). Pre-existing, not introduced by that change.\n\nScenario: a cloned repository sets `{\"graview\": {\"app\": \"./face\"}}` in `.n-dx.json` (or a committed `.n-dx.local.json`) and ships `face/bin/serve.js` (or a `package.json` with a `dev` script). Before `ndx trust accept .`, the user runs `ndx graview serve .`. `readGraviewConfig` (packages/graview/src/graview-bin.ts) resolves `app` with no trust gate, and `serveProductApp` (packages/graview/src/cli/index.ts:152-174) runs `node <app>/bin/serve.js`, or `npm|pnpm run dev` in that directory, with the user's whole environment plus `NDX_TOKEN_FILE` (the per-user hub token path) and `NDX_REX_MCP_URL`. The trust review does not list `graview.app`, so the user cannot see it either.\n\nReachable: `ndx graview serve .` (face on by default) in any checkout whose config sets graview.app. Not covered: 083c929b gated only `graview.bin`; `withoutTrustGatedFields` leaves `graview.app` in place.\n\nOptions: (1) recommended: add `[\"graview\",\"app\"]` to the trust-gated binary fields in llm-client repo-trust, so it is collected, raises `vendor-cli-path` (or a sibling code), enters the digest, and is stripped by `trustedProjectConfig` / `trustedLocalConfig`, which `readGraviewConfig` already uses; untrusted, `serve` falls back to the installed `@n-dx/graview-face`. Cost: one field plus tests mirroring graview-bin-trust.test.ts. Risk: a trusted repo that sets it reads as changed once. (2) Read `graview.app` only from an untracked local config. Cheaper, but the review cannot show it.\n\nVerdict: out-of-scope (pre-existing). Severity critical on the review scale: repository code runs with the user's environment and hub token path before trust."
acceptanceCriteria:
  - "In an untrusted checkout whose .n-dx.json sets graview.app to a directory with a sentinel bin/serve.js, `ndx graview serve .` does not run the sentinel (test fails today)"
  - "A graview.app in a git-tracked .n-dx.local.json is likewise not used until the checkout is trusted"
  - "The trust review lists a repository-set graview.app as a finding and it enters the trust digest; accepting it makes serve run that face"
  - "A graview.app in an untracked .n-dx.local.json keeps applying"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "critical"
discoveredFrom: {"item":"083c929b-aba3-402d-8a5f-9c69dfaa0126","run":"379b94ea-5bc7-49c2-8623-9028193bccf0"}
tags:
  - "security"
  - "graview"
  - "ndx-adversarial-review"
  - "severity:critical"
  - "issue-cleanup"
source: "ndx-adversarial-review"
---
