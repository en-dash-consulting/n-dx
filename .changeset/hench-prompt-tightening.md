---
"@n-dx/hench": patch
---

Stop the agent prompt telling the agent the same thing twice, and make a retry
brief say what to do differently.

hench assembles one model call from two halves built in different files — the
system prompt and the task brief — and neither could see what the other emitted.
The duplication was invisible in either file alone and only appeared in the
assembled envelope:

- **The project block was written twice.** `buildSystemPrompt` emitted
  `## Project Info` (Project / CLI command / Validate command / Test command)
  and `formatTaskBrief` emitted `## Project` with the same four values under
  different labels. The system prompt keeps them — it also carries the
  use-the-CLI-name instruction, and it is the stable half while the brief
  changes per task.
- **`## Rules` and `## Workflow` had become two renderings of one list.** Read
  before changing, run the tests, and the whole `git add -A` +
  `.hench-commit-msg.txt` + do-not-commit procedure each appeared in both.
  `## Rules` now holds constraints only; steps live in `## Workflow`, which
  carries the full instruction rather than half of it.

`PREVIOUS FAILURE` printed the prior failure text under a heading and stopped,
leaving the model to infer what to change — and the most available continuation
is the approach it just watched fail. The section now names the retry, asks for
a diagnosis before any edit, and requires an explicit statement of what is being
done differently if the previous approach is being kept.

Measured with `scripts/prompt-census.mjs --dump hench`: the assembled prompt for
the representative task drops from 653 to 584 tokens (-10.6%), system 466 → 416
and brief 187 → 167. Retries now cost slightly more than before by design — the
corrective instruction is the point.

One caller sends the brief without hench's system prompt: `callVerifier` in
`lifecycle/loop.ts` pairs it with a reviewer prompt of its own. It asks whether a
solution satisfies the acceptance criteria, which the project name and command
list do not bear on, so it loses nothing it used.

A new `prompt-non-redundancy.test.ts` asserts against the assembled envelope for
both providers, so a fact restated across the two halves fails even though each
file alone looks correct.
