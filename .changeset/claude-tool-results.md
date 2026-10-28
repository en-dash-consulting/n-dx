---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/web": patch
---

Claude tool results now reach the Sidecar transcript and hench runs. The session driver turns each `tool_result` block on a Claude stream-json `user` line into its own `tool_result` event carrying the block's `tool_use_id` (`toolResult.callId`), and `tool_use` events carry the call's id (`toolCall.id`). The drawer pairs a result with its call by that id, falling back to order when no id is present, and hench records each result on the call it names without changing turns, completion or token totals.
