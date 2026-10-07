---
"@n-dx/rex": patch
"@n-dx/llm-client": patch
"@n-dx/core": patch
---

Add the placement decision for a change on the product layer (`core/placement-policy.ts`). `rex.placement.models` (`text`, `jev`, `both`) chooses which tiers run beside the rules, and `rex.placement.autoAccept` (`none`, `agree`, `confident`) decides when a placement is accepted without a person; a change without one gets `needsPlacement`. Jev runs under its own `prd.place.judge` task class, which is not a default judgment route, so exporting `TYPESAFE_API_KEY` alone never turns it on. `confident` needs a Jev pick at confidence 0.8 or higher that is on the rules shortlist. Jev can abstain with a none-of-these option, which is never auto-accepted, and a Jev confidence that is not finite or is outside 0–1 is ignored with a warning. Without Jev, `both` falls back to the text model and `jev` to rules only, each with a warning. Not wired into the store, CLI or MCP yet.
