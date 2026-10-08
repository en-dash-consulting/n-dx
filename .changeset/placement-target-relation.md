---
"@n-dx/rex": patch
---

A placement is now a target and a relation. `PlacementDecision.accepted`, each shortlist candidate and each Jev ranking entry carry `{ target, relation }`, with `relation` either `touches` or `amends`. The rules alone pick the relation: a change with `fix: true` or a code-health finding touches its target, a change whose title or intent asks for new behaviour amends it, and any other change touches it. The text model and Jev pick only the target. Constraints are ranked as candidates alongside capabilities, and a code-health finding (source `sourcevision` or tag `code-health`) is placed on the architecture constraint. The text model can propose a new capability or constraint under an area as an `added` amendment with a type. A proposal is never auto-accepted in any `autoAccept` mode, so it always leaves `needsPlacement` set for a person.
