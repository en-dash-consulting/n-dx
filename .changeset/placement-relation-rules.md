---
"@n-dx/rex": patch
---

Tighten placement's rules. A change counts as a code-health finding only when it carries the `code-health` tag, no longer because its source is sourcevision. The relation is decided by an explicit `Relation: amends` or `Relation: touches` line in the intent, else by an amending verb opening the title (`Add`, `Support`, `Replace`, …), else touches; `fix: true` and `code-health` always touch. A change no rule matches can still get a new-capability proposal from the text model, which is given the list of areas, and a proposal under an unknown area is dropped. A proposal is never auto-accepted.
