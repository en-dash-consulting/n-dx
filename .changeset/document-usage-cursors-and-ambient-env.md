---
"@n-dx/core": patch
---

Document what the assisted-run token capture added, and the flake family it exposed.

`.hench/usage-cursors/` now appears in the key-files table (`project-guidance.md`, so both `CLAUDE.md` and `AGENTS.md` carry it) and in the gitignore guide's copy-paste block and per-path table — it is machine- and session-local, and committing one collides between machines and puts a session id in history.

The skills guide gains a shared section on what every state-mutating skill does at the end. The per-skill step lists are summaries that omit the commit step, so adding a lone "record the run" step to each would have implied they were exhaustive; the shared note covers both, including why planning-style skills record against `skill:<name>` and land in `get_token_usage`'s `orphans` bucket.

TESTING.md gains **Family 4 — Ambient environment leaking into the suite**, which is the pattern behind three separate defects rather than one: `FORCE_COLOR` (24 failures across 8 files), whether `sh` resolves on PATH (21 failures across 5 files **plus 5 vacuous passes**), and `CLAUDE_CODE_SESSION_ID` (the suite reading a live, growing transcript). CI set none of them, so all three were green in CI and red only for humans. The rules record the setupFile mechanism, why a genuine environment dependency gets guarded rather than removed, and that an ambient dependency which breaks assertions usually also satisfies some for the wrong reason — so an audit should look for the vacuous passes too. The section intro said "Two failure families" while three were documented below it.
