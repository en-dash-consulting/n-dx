---
"@n-dx/hench": patch
---

Strip thinking blocks from the tail a prune retains, so keep-tail compaction no longer trips Anthropic's preserved-thinking check.

A `thinking` block's signature is bound to the conversation prefix that produced it. The summarizing prune replaces the turns in front of the retained tail, which invalidates every thinking block the tail carries — from Claude Fable 5.1 onward the next request fails with `400 Invalid signature in thinking block`. `PruneShape` gains an optional `sanitizeRetained` hook; the Anthropic shape uses it to drop `thinking` and `redacted_thinking` blocks from retained assistant turns, keeping `text` and `tool_use` in order. Applied on both the summarized and degraded-drop paths. The Gemini and OpenAI-compatible shapes omit the hook and are unaffected.
