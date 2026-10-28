---
"@n-dx/web": patch
---

The Sidecar drawer draws the open session's permission cards, oldest first, with an orange bar above the composer while the agent waits. Only the first waiting card can be decided: Approve, Deny with an optional note sent to the agent as the reason, and "Always allow" when the call can be allow-listed. ⌘↵ approves and ⌘⌫ denies it outside text fields. A command card shows its ndx command's effects from the command manifest. Ending a session withdraws its waiting cards with the reason "session ended", and the drawer draws them as denied. The waiting-card badge ignores a card read that a later read has overtaken.
