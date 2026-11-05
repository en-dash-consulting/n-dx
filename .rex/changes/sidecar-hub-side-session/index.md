---
id: "73f42fbb-cc9b-4c44-8798-06959e234fe2"
type: "change"
title: "Sidecar hub side session"
slug: "sidecar-hub-side-session"
intent: "Batch H1 of the Sidecar epic (CAOS 3f7a80b7-1924-8104-9ed8-c98bc5f409e4, feature Hub side session 3f7a80b7-1924-81bd-b127-df0eb6e927ab), stacked on L1 (change 6dcba986, PR #945). One hub-scope Sidecar per machine, hosted on a project server the hub picks and reached only through the hub at /hub/session/. It works from a capped snapshot of every registered project, keeps the hub ledger, drills into worktree sessions, and drafts but never does. Claude-only in H1. Design: local-design-workshop/docs/analysis/sidecar/README.md §4.3-4.5, §6, §7, §12 (stories 25-27), §15.1."
acceptanceCriteria:
  - "Stories 25, 26 and 27 of the Sidecar design (§12, Hub side session) are complete"
  - "Nothing in this change turns on web.sidecar; while the host's web.sidecar is off the hub home shows no Hub session toggle and /hub/session/ refuses"
  - "src/hub/ imports nothing from src/server/ or src/viewer/; the hub reaches the host only over HTTP, behind its token check and request-guard"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
  - "ba50eaa7-5f31-4a8d-9e16-6c452882022e"
priority: "high"
source: "caos"
---
