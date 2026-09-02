---
"@n-dx/rex": patch
---

Replace identical-prompt retries with an escalation ladder.

The retry path resent a byte-identical prompt up to three times and told the
model nothing about why the previous answer was rejected. A model that emits
unparseable JSON once will usually do it again given the same input, so those
were three calls billed for one answer.

Retries now carry the validation error verbatim, and run on the standard tier.
That is two independent wins for different classes: the error feedback helps
every class — it is the actual complaint behind the audit finding — while model
escalation only changes anything for light-routed classes, where it is what
makes cheap-first routing safe. A light model that cannot satisfy the contract
hands off instead of failing the command. The attempt number is included in the
feedback, so consecutive prompts differ even when the error repeats, which is
the property the old loop violated.

The retry count is unchanged at three attempts: this changes how retries
behave, not how many there are. Only validation failures escalate — transport
and auth errors propagate immediately, since escalating them neither diagnoses
nor fixes anything. Sourcevision's prompt-degradation ladder is untouched: it
shortens the prompt on the same model, which is right for a context-overflow
failure, while this escalates the model on the same prompt, which is right for
a capability failure. The failure class decides which applies.

Applied to `prd.modify` (the audit's named site), `prd.rename`, and
`prd.merge`. Along the way, rename's title-collision check moved *inside* the
output contract: it used to run after every retry, so a light model returning
two identical titles failed the rename outright — now the standard tier gets a
chance at it.

Escalation rates are tracked per task class, so a class escalating on more than
a fifth of its calls — the signal that its light routing is not paying for
itself — is visible rather than inferred.
