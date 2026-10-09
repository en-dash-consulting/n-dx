---
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

Derive cross-repo workspace crossings from outbound HTTP calls and shared infrastructure, not only npm imports.

`analyzers/workspace-crossings.ts` had one signal: an external import naming a sibling member's package. It now has three, all in that same module — no second aggregator. Every cross-repo crossing carries `source: "npm" | "http" | "infra"` and an `evidence` sentence naming both sides, because an edge no import supports is unreadable without one. Intra-repo crossings carry neither; they come from the import graph Louvain partitioned, which is none of these three.

**http** reads each member's `outbound.json` and resolves its `http` and `grpc` calls against the other members. A literal target is matched on two independent signals: the host being a member's declared `baseUrl` host (a person said so), and the path being a route that member's `components.json` says it serves (its own analysis said so). Both hold, or a declared host with no path to check, is `certain`; either alone is `likely`. The edge lands on the file that handles the route, not the package entry point.

**infra** joins two members that reference one resource: the same `infra:` id is `certain`, the same name for a queue, topic, bucket or stream is `likely`. The rule is restricted to those kinds deliberately — two repos both having a `database` called `primary` are not talking to each other. A shared resource has no direction, so one edge is emitted per member pair per resource, oriented by member id so repeated runs produce the same graph.

Two questions this settles:

- **Matching an env-var name to a producer.** Neither side's convention is taken as canonical. Both the variable name and the host are reduced to their identity words — the ones that say *which* thing rather than *what* it is — so `ORDERS_URL` and `orders.internal` meet in the middle without either repo adopting the other's spelling. `WorkspaceMember` gains `baseUrl` for members to declare where they serve; an env match against a declared base URL is `likely` and is drawn, an env match against a member's *name* alone is not.
- **The threshold.** `certain` and `likely` are drawn, `inferred` is withheld — every `inferred` rule here rests on two names resembling each other and nothing else, and a name collision between repositories is ordinary. A wrong edge in a cross-repo map is read as architecture, which is worse than a missing one.

Withheld candidates are reported rather than dropped: `sourcevision workspace` prints each one with its reason, which is nearly always a member that has declared no `baseUrl` — a one-line fix the operator cannot make if the near-miss is invisible. `sourcevision workspace --status` prints edge counts broken down by source.

`sortCrossings` now tie-breaks on `source`, because two sources can draw the same file pair and without it `zones.json` stopped being byte-stable. Web mirrors the two new fields in its schema and zone-crossing validator; a zod object strips undeclared keys, so leaving them out would have made the evidence vanish between the analyzer and the dashboard rather than fail loudly.
