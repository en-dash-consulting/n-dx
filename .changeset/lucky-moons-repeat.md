---
"@n-dx/hench": patch
---

Keep the summarizing prune's output role-alternating on the local and Gemini loops.

The summary was inserted as a single `user` message directly after the `user` brief, so the array read system, user, user, assistant. Anthropic merges consecutive same-role turns, but an OpenAI-compatible server renders the array through the loaded model's Jinja chat template, and Mistral-Instruct, Gemma and Llama-2-chat raise "Conversation roles must alternate" — which the local loop turns into a thrown error, killing the run on the first prune and on every retry.

`PruneShape.toSummaryMessage` may now return several messages. The local and Gemini shapes return an assistant/model bridge turn followed by the user summary; the Anthropic shape still returns one user message. The pruner counts the summary region in messages rather than in prunes, so the drop offset and the prune cadence are unchanged.
