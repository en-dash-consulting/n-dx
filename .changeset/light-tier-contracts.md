---
"@n-dx/hench": patch
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
---

Complete light-tier routing: move classification to the light tier, and give
the two unguarded light calls real output contracts.

`sourcevision`'s classification batches now resolve through the `code.classify`
task class. This is the last of the audit's routing-map flips and the safest of
them: a fixed-size batch goes in, an enum-constrained list comes out, unknown
paths and unknown archetype ids are already dropped per item, and a prompt
degradation ladder already handles parse failures — so a wrong answer costs one
dropped classification.

Routing a call to the cheapest adequate model is only a safe trade while bad
output stays detectable, and two light-routed calls had nothing checking them.

The commit-subject call feeds `git commit -m` directly, and previously took the
first non-empty line and sliced it to 100 characters — so a fenced block, a
"Sure! Here's a subject:" preamble, or a markdown bullet would have been
committed into the repository's history. It now goes through a contract that
strips those tics and enforces one line within the documented 72-character
bound, falling back to the generic message when nothing usable survives:
refusing to commit would be worse than committing under a generic subject.

The body-merge call was worse — whatever the model returned was written verbatim
as the surviving PRD item's description, so an empty answer or a JSON blob would
have been persisted as the item's body. It now validates, and *throws* on
failure rather than repairing: `reshape` already treats body merge as
best-effort and keeps the existing description, which beats persisting a
preamble or a sentence cut in half by a length cap.

The other six light-routed sites were audited and already had contracts — zod
schemas for renames, clarify rounds and the assessment pass, and proposal
parsing with count checks for the consolidation guard. A new integration test
pins the resolved model for every class in the routing map, in both directions:
the light routes must be light, and the agent loop, proposal generation, and
deep enrichment must not be.
