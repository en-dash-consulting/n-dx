---
id: "c00b80d5-0140-440f-930f-11a2d3bcc079"
type: "change"
title: "Hench decodes vendor stdout without splitting multi-byte characters"
slug: "hench-decodes-vendor-stdout-without"
intent: "spawnWithAdapter in packages/hench/src/agent/lifecycle/cli-loop.ts calls chunk.toString() on each stdout chunk, so a multi-byte UTF-8 character split across two chunks becomes replacement characters in the parsed line, the run log and fullStdout. Fix with a StringDecoder or setEncoding('utf8'), as llm-client's vendor-session.ts now does. Found as a deferred finding in story 01's review (run a9c6246e); predates the Sidecar work."
acceptanceCriteria:
  - "a multi-byte character split across two stdout chunks reaches the parsed line, the run log and fullStdout intact"
  - "a test feeds a split multi-byte character through spawnWithAdapter's stdout handler"
priority: "low"
source: "ndx-capture"
---
