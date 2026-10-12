---
"@n-dx/hench": patch
---

The prune defaults stay at 20 trigger-pairs and 10 retained. No behaviour
changes on upgrade; this records why they stand and pins them against a silent
future edit.

They were carried over when 0.7.1 made them configurable, and the comment on
`DEFAULT_PRUNE_CONFIG` claimed they sat "where they were measured". They did
not. The 0.7.1 post-release measurement batch (rex task d08b0479) was the
measurement that was supposed to settle them, against the 10-run, $247.53
pre-optimization baseline — and it cannot bear on them at all, for a reason
that is structural rather than a gap in the data:
`DEFAULT_HENCH_CONFIG` sets `provider: "cli"`, and only the API loops prune.
`agent/lifecycle/cli-loop.ts` hands the conversation window to the vendor
binary and never constructs a `ConversationPruner`, so a batch of
default-config `ndx work` runs fires no prune whatever its cost totals say.
Its figures are evidence about prompt caching and the primer, not about these
two numbers. The batch's own deliverable,
`docs/analysis/prompt-token-batch-2-results.md`, was never written.

What the pair does rest on is arithmetic, and that is now stated where the
values are: the gap between them is twenty messages, so each prune is followed
by ten turns of pure append — the growth shape the prompt cache rewards — and
the trigger is peak context. Moving either number trades a known cadence for
an unmeasured one.

Two tests in `context-prune.test.ts` back this. One pins the three shipped
values as literals: the rest of that file is written against the exported
symbols, so before this nothing asserted the values themselves, and a
coordinated edit of the incidental `22`s elsewhere would have changed every
project's prune cadence on upgrade with the suite green. The other asserts the
gap property the defaults are chosen for — ten turns append after a prune
without one firing, and the next turn crosses the trigger.

Settling the numbers on evidence still needs a batch run against an API-loop
provider; that is filed separately rather than left implied here.
