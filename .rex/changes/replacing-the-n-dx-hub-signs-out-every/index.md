---
id: "77b723a0-0654-489b-9b11-5caf8192b059"
type: "change"
title: "Replacing the n-dx hub signs out every open dashboard tab in every project"
slug: "replacing-the-n-dx-hub-signs-out-every"
intent: "Adversarial review of capture/no-manual-restart (d59c6096c..3e16fdf2f). Verdict: should-fix; operator chose session hand-over. Browser credentials (landing nonces, sessions, WebSocket tickets) are in memory only (packages/web/src/shared/auth.ts CredentialStore, ~l.140: 'a restart revokes everything'), so an automatic hub replacement (packages/core/web.js replaceOrDeferHub) silently signs out every open tab on all registered projects; the only way back is 'ndx start' in each project for a fresh nonce link — the manual step this change set out to remove. Chosen fix: hand live sessions over across a replacement — the old servers write their live browser sessions (not nonces) to a one-shot file in the ndx home with owner-only permissions on shutdown-for-replacement, the new servers read and delete it at startup and reject it if stale (short max age) or not owned by this user; the per-user token is never written. Rejected alternatives: counting open tabs as live work (defers indefinitely), a warning only."
acceptanceCriteria:
  - "After an automatic hub replacement, a dashboard tab that was signed in before stays signed in on every restored project"
  - "The hand-over file is created owner-only, holds no per-user token, is deleted on read, and is ignored when older than a short maximum age or written for another home/port"
  - "A plain 'ndx hub stop' (not a replacement) still revokes every session"
  - "Tests cover hand-over, stale file rejection, and deletion"
touches:
  - "e96db771-5ed0-4ba8-a70b-74a30f462f65"
priority: "medium"
discoveredFrom: {"item":"8c5a1439-ad72-437a-a53f-42b4adc01221"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
