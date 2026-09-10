---
"@n-dx/web": patch
---

Explain a SourceVision finding in plain language from the Problems and
Suggestions views.

Every finding row now carries an **Explain** action that opens the Ask panel
with that finding attached. What travels is the finding's own fields — type,
severity, zone, message, and related files — as a structured `seed` beside the
prompt, not a pre-written sentence. That distinction is the feature: facts in
the question text would be deleted the moment the user reworded it, and a
prompt is not something the endpoint can render as a focus section or reason
about.

The endpoint already accepted a loose `{kind, id, text}` seed. It now also
takes `zone`, `files`, and a `labels` map, renders them as their own facts, and
— only when a seed produced a focus section — adds three rules requiring the
answer to name that finding's zone and files and to state what a fix would
touch. An explanation that could have been written without reading this
repository is the failure mode, so the extra rules say so outright.

Details worth knowing:

- **Nothing is defaulted on the way through.** A finding with no severity sends
  no severity; the list view's "treat missing as info" grouping default stops at
  the display layer, because telling a model the analysis classified something
  it did not classify is inventing the field the explanation reasons about.
  A `global` finding sends no zone rather than the string `"global"`.
- **The seed is shown as well as sent, and can be detached.** An answer naming
  files the user was never shown reads as a guess; a seed that could not be
  removed would silently ground every later question in whichever finding they
  arrived from.
- **Explain is opt-in per surface.** `FindingsList` also renders for the
  Architecture view, which has nowhere to send a finding, so the action appears
  only where a navigation target exists. The button sits outside the row header
  because that header is itself a button whenever a finding has related files.
- The seeded answer supports the same Copy and Capture-to-PRD actions as any
  other, and an unknown `seed` field is still rejected rather than dropped — a
  client that guessed the shape is told, not quietly answered without it.
