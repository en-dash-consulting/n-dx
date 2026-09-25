---
"@n-dx/hench": patch
---

Prune the agent conversation by summarizing instead of dropping the oldest turns.

All three API agent loops (Anthropic, Gemini, LM Studio) spliced from the front of
the message array once the conversation crossed 20 turn-pairs, which dropped two
messages every turn from then on. That changed the prompt prefix on every request,
so the `cache_control` breakpoints never got a cache read, and it discarded the
run's only record of which files were touched and which commands failed.

Pruning now cuts back to 10 turn-pairs (by default) in one batch and replaces the
dropped span with a summary, placed after a head that is never rewritten —
so the cached prefix stays byte-identical between prunes and a prune fires roughly
once every ten turns rather than every turn. The summary routes through the
`context.summarize` task class (light tier by default), and a summarization failure
degrades to the previous drop behavior rather than failing the run. The retained
tail is also now cut on an assistant turn, so a prune can no longer orphan a tool
result from the call it answers.

On the local and Gemini loops the summary is preceded by an assistant/model bridge
turn, so the conversation keeps alternating roles: an OpenAI-compatible server
renders it through the loaded model's chat template, and Mistral-Instruct, Gemma
and Llama-2-chat raise "Conversation roles must alternate" on two consecutive user
turns. The Anthropic loop inserts a single user message.
