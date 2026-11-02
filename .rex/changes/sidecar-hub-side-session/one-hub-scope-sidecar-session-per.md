---
id: "a23d8599-329b-438e-b907-f6370e63e9d2"
type: "task"
title: "One hub-scope Sidecar session per machine runs from the snapshot and cannot read repositories"
slug: "one-hub-scope-sidecar-session-per"
description: "Story 25, part 2 of 3 (CAOS 3f7a80b7-1924-81b5-9c3e-d5aa3573b938). Architecture (a): a project server the hub picks hosts the hub-scope session; state lives under <ndx home>/hub/sidecar/; the hub proxies /hub/session/* to the host. Design §4.4, §4.5, §6."
acceptanceCriteria:
  - "Hub sessions persist under <ndx home>/hub/sidecar/ (resolveNdxHome) with a host lock holding pid and port; a second create, on the same or another project server, returns the existing session's id"
  - "The hub picks the host (the first reachable registered project) and proxies /hub/session/* to its hub-scope Sidecar routes, HTTP and WebSocket, after guardHubRequest; a request without the token gets 401; when the host is unregistered or dies, the next request picks another host and the session resumes from disk"
  - "The hub lens in lens-packets.ts becomes a packet built from the hub snapshot, rebuilt every turn; it stays unavailable, naming web.sidecar, while the host's web.sidecar is off"
  - "The hub session's context ceiling is 40k unless web.sidecarContextCeiling.hub sets it; a turn that ends above it checkpoints and the next turn starts cold from a fresh snapshot"
  - "The Claude spawn for hub scope passes an empty tool list (no Read, Grep or Glob) and an MCP config holding only ndx-sidecar; a test asserts the argv, with a win32 branch for comma-joined lists and stdin prompts"
  - "A hub create with the Codex vendor is refused with a reason naming that its read-only sandbox can still read repositories"
  - "src/hub/ imports nothing from src/server/ or src/viewer/ and no new hub route skips the token check or request-guard; the project server learns the hub's URL from the hub at spawn"
priority: "high"
source: "caos"
---
