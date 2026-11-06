---
"@n-dx/web": patch
---

The Sidecar can ask the operator to pick between options. A new `ask_choice` broker tool raises a choice card with a radio (or checkbox) row per option, arrow-key movement, an Other free-text row and a Send button; the answer returns to the agent as the tool result. It writes nothing, and every worktree lens now tells the agent to use it for a decision instead of listing options in its reply.
