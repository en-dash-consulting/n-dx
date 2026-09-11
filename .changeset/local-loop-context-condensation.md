---
"@n-dx/hench": patch
---

feat(hench): local loop context tracking, condensation, and pressure tinting

The local (LM Studio) loop managed context by count: keep the last 20
turn-pairs, silently discard everything older (and, by an off-by-one, the
task brief itself). For a local model that is both amnesia and wasted
prefill. With `llm.local.maxContextTokens` set, the loop now manages the
window by measurement — each response's `prompt_tokens` is the actual size
of the request just sent:

- **Token-triggered condensation.** At ≥70% of the window, old tool outputs
  are digested in place (first 200 chars kept — free, no model call). At
  ≥90%, the middle of the conversation is additionally summarized via one
  extra chat/completions call and replaced with the summary, preserving the
  brief and the model's recent working set. Rewrites are rare by design —
  each one invalidates the server's prompt-prefix cache once.
- **Visible accounting.** Every condensation prints a `[Context]` line
  (captured into the run log like all stream output), the tok/s metric line
  gains `· ctx N% (used/window)`, the run record gets a
  `contextCondensations` count, and the run summary prints
  `Context window: condensed N time(s)` for local runs.
- **Pressure tinting.** The model's own streamed text — and only it, not
  tool lines or metrics — renders yellow at ≥70% and red at ≥90% window
  fill. Terminal only: the run log stays plain text.

Without `maxContextTokens` the loop keeps the count-based fallback prune
(now preserving the brief and never orphaning tool results) and prints a
one-line hint that context tracking is off.
