---
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

Add `outbound.json`: the shape, the file, and the pipeline wiring.

SourceVision detects only the provider side of HTTP — `server-route-detection.ts` and `go-route-detection.ts` record the routes a repository serves. Without the consumer side, a repository that calls another repository is invisible, which is what makes a cross-repo scan impossible.

This lands the first slice: `OutboundDependency` in `schema/v1.ts`, a zod schema in `schema/validate.ts`, `outbound.json` registered in `schema/data-files.ts` and web's mirror, and `analyzers/outbound-detection.ts` wired into `sv analyze`. Call-site detection is deliberately empty — JS/TS HTTP and gRPC, JS/TS queue/database/cache, and Go each follow as their own change, and each now adds detections to a file consumers already read rather than introducing the file and its readers at once.

What the detector does find today is declared contracts: OpenAPI/Swagger documents and `.proto` files, with their paths. These are not found through the inventory alone, because `.proto` and `.yaml` are not programming languages and the default `codeOnly` inventory omits them — both sources are consulted and merged, rather than widening the inventory and changing the input to zone detection for every project.

`confidence` grades the call, not the target: a direct client call is `certain` whether its target is a URL literal or an environment variable name, and only indirection in reaching the call lowers it. `targetSource` separately says where the call points, so the cross-repo matcher has a category to switch on rather than a threshold to guess at. The three-level vocabulary it uses was `SdlcConfidence`, named for having had exactly one user; now that a second, unrelated record grades its detections with it, it is `Confidence` — still one definition, so the two cannot drift.

Deterministic throughout: no LLM, no network, and canonically ordered, so re-analysing an unchanged tree produces a byte-identical file.
