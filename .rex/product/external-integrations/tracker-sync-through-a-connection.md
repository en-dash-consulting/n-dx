---
id: "7df16224-db25-4a39-81d2-5c5c3904f4b9"
type: "capability"
title: "Tracker sync through a connection"
slug: "tracker-sync-through-a-connection"
statement: "The product keeps a linked tracker in step with ndx work through an operator's connection: deterministic rules turn ndx events into tracker calls that are off by default, dry-run first, create and block only by card, and record every call in an activity log."
criteria: [{"id":"c1","text":"Every sync rule is off until the operator turns it on, and dry-run records the would-be call without making it."},{"id":"c2","text":"Every tracker call carries the requestId ndx:<project>:<rexId>:<event>, and a create or duplicate reply is confirmed with a read before it is recorded."},{"id":"c3","text":"A missing workflow fact or a tracker limit becomes a card naming what is missing, never a guessed value."},{"id":"c4","text":"The hub keeps sync ticking for every registered project with a rule on, and the project server executes it through its own connection."}]
---

## History

- 2026-11-05 0943b9b0-e71e-4bb2-ab30-7047910ffdf1 added: Sidecar tracker sync
