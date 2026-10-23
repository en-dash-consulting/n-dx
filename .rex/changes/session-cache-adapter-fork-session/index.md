---
id: "052cfa55-9ea9-46e1-8b00-60a9ee73b555"
type: "change"
title: "Session cache, adapter --fork-session flag, and session-strategy config keys"
slug: "session-cache-adapter-fork-session"
intent: "Foundation for warm-parent forking, with no behavior change until the orientation pass is wired. Adapter: ClaudeCliInput gains forkSession, emitting --fork-session after --resume (fork without resume is meaningless and must be suppressed). New agent/lifecycle/session-cache.ts reads and writes .hench/session-cache.json ({parentId, createdAt, svFingerprint, vendor, model}) with isParentUsable() enforcing the three invalidations: sourcevision fingerprint change (manifest analyzedAt + gitSha), parentMaxAgeHours (default 24), and explicit --fresh. A corrupt or missing cache is a miss, never a throw. Config: hench.sessionStrategy ('fork' | 'batch' | 'cold', resolved per vendor — fork for the Claude CLI, cold otherwise), hench.tasksPerSession (default 4), hench.parentMaxAgeHours (default 24)."
acceptanceCriteria:
  - "buildClaudeCliArgs emits --fork-session only when a resume session id is also present, after the --resume flag"
  - "session-cache.ts round-trips the cache file and returns a miss for absent or corrupt JSON instead of throwing"
  - "isParentUsable rejects a parent when the sourcevision fingerprint changed, when older than parentMaxAgeHours, or when fresh is requested"
  - "The sourcevision fingerprint derives from manifest.json and is stable across reads when no analysis has run"
  - "hench.sessionStrategy, hench.tasksPerSession, and hench.parentMaxAgeHours exist in the config schema with documented defaults"
  - "Strategy resolution returns cold for non-Claude-CLI vendors regardless of the configured strategy"
  - "Unit tests cover the adapter arg shape, cache round-trip, every invalidation path, and per-vendor strategy resolution"
touches:
  - "00d910d1-dc49-488d-bd6f-3d26911abc79"
priority: "high"
tags:
  - "hench"
  - "sessions"
  - "config"
source: "ndx-work"
---
