---
id: "777869b8-d76a-4cc1-8906-65f2d7d327aa"
type: "task"
title: "Sidecar sessions checkpoint at a context ceiling and carry a typed ledger"
slug: "sidecar-sessions-checkpoint-at-a"
description: "Context ceiling for every Sidecar session (design §4.4). Read the per-call context from each assistant line (Claude) or each turn (Codex). When a turn ends above the session's ceiling, the server checkpoints: the agent writes typed ledger entries (decision, gotcha, verified, unfinished, changed; at most 240 characters each, through the broker's existing ledger_append), and the next turn starts a cold vendor session seeded with the lens packet rebuilt fresh, the ledger rendered within 3k characters, and the last two user/assistant exchanges verbatim. The old transcript is never re-sent. Ceilings default to 100k tokens for worktree sessions and 40k for hub sessions, configurable in project config. The drawer that shows the divider is M2; this story records the checkpoint as a transcript frame for it. Depends on story 06's packet builders. CAOS story: https://www.notion.so/3f7a80b71924810492a8ca3948c3f474."
acceptanceCriteria:
  - "the ceiling is configurable per scope, defaulting to 100k tokens for worktree sessions and 40k for hub sessions"
  - "a turn that ends above the ceiling checkpoints: the agent writes typed ledger entries through ledger_append, and the next turn starts a cold vendor session"
  - "the cold turn's prompt holds only the rebuilt lens packet, the ledger within 3k characters and the last two exchanges verbatim; a test asserts the old transcript is never re-sent"
  - "the checkpoint is recorded as a 'context refreshed' transcript frame with the number of notes carried, for the drawer to render"
priority: "medium"
source: "caos"
---
