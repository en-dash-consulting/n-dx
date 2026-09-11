---
"@n-dx/hench": patch
---

fix(hench): local loop dispatches tool calls on finish_reason "stop", shows reasoning, and re-prompts no-work completion claims

Three divergences between the local (LM Studio) loop and the CLI vendors,
found while chasing a qwen3.5 run that burned tokens across two blank turns,
made one bookkeeping tool call, and quit:

- **Tool calls were silently discarded when `finish_reason` was `"stop"`.**
  The loop's done-check was `no tool calls OR finish_reason "stop"/"end_turn"`,
  and LM Studio reports `"stop"` for some models even when `tool_calls` is
  populated — so the model's work orders were dropped and the run ended. The
  model is now done only when it stops calling tools; `finish_reason` no longer
  short-circuits dispatch.

- **Reasoning output was invisible.** Thinking models (qwen, deepseek-r1)
  return their chain of thought in `reasoning_content` (or `reasoning`) with an
  empty `content`, so the operator watched blank turns consume tokens. When a
  turn has reasoning but no content, the reasoning is now streamed under a
  `(thinking)` label. Display only — it is never fed back into the
  conversation.

- **A no-work completion claim ended the run on the spot.** The Claude API
  loop re-prompts plan-only turns; the local and Gemini loops now give the
  same second chance: when the model claims completion but the run has changed
  nothing, it is told to execute (up to 2 reminders) before the claim stands —
  after which completion validation rejects it and the task resets to pending.
