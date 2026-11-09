---
id: "955f7405-6bab-45f7-8722-b7595000a98f"
type: "task"
title: "A hub auth-mode mismatch is resolved by restarting the hub in the requested mode, not by telling the user to stop it"
slug: "a-hub-auth-mode-mismatch-is-resolved"
description: "Covers hubAuthMismatchMessage in packages/core/web.js ('Stop it first (ndx hub stop), then run this command again'). Reuse the safe hub-replacement path from the stale-hub task: when the running hub's auth mode (open vs token) differs from what this command asked for and no live work is on it, replace it in the requested mode and re-register its projects; with live work, defer as that task does. Replacing a token hub with an open one stays an explicit choice (--no-auth / web.auth=false), and the open-hub direction must never silently serve a project unauthenticated. SAFETY: the operator's live hub runs on 127.0.0.1:3117 with ~/.n-dx as its home and serves 25 projects. Never run 'ndx hub stop', 'ndx start' or anything that stops, replaces or registers with that hub. Every test and manual check uses a temporary NDX_HOME and a free port (hub.port / --port)."
acceptanceCriteria:
  - "A token-mode ndx start against an open hub with no live work replaces it with a token hub and re-registers its projects"
  - "A --no-auth ndx start against a token hub replaces it only because the operator asked for --no-auth, and says so"
  - "With live work on the hub, the mismatch defers like the stale-hub replacement and never tells the user to run ndx hub stop"
  - "Tests cover both directions in a temporary NDX_HOME"
priority: "high"
source: "ndx-capture"
blockedBy:
  - "98e5a4d9-0b50-4124-a5a9-9745366d2af8"
---
