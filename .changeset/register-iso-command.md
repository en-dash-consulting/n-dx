---
"@n-dx/core": patch
---

Register `ndx iso` in the command registry

`cli.js` dispatched `iso` and `help.js` carried its help entry, but
`COMMAND_REGISTRY` had no row for it, so `getOrchestratorCommands()` omitted
it and every registry-driven check was blind to the command. Typing `ndx is .`
suggested `ndx ci, ndx fix, ndx sv` and never the command actually meant.

`iso` now has a registry row, a `COMMAND_EFFECTS` declaration, and a row in
both command references. `ndx is .` suggests `ndx iso` first.
