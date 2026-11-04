---
"@n-dx/hench": patch
---

Agents cannot read or edit the per-user credential store. Claude CLI runs pass `Read(//<store>)` and `Edit(//<store>)` deny rules resolved from the ndx home at spawn, and hench's guard refuses the store (and its lock and temp files) when the ndx home sits inside the project. The Codex CLI sandbox can still read the store.
