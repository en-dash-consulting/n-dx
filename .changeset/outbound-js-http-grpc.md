---
"@n-dx/sourcevision": patch
---

Detect JS/TS HTTP and gRPC call sites into `outbound.json`.

The second outbound slice fills in what the first one left empty. `analyzers/outbound-detection.ts` now reports call sites for `fetch` (global and `node-fetch`), axios, got, ky and undici as `kind: "http"`, and gRPC client construction — on the module object, through a `loadPackageDefinition` result, or a generated `*Client` stub — as `kind: "grpc"`.

Detection runs through the TypeScript compiler API, never a regular expression over source text. A regex cannot tell `axios.get(url)` from `cache.get(key)`, and that difference is the whole value of the artifact. The walk resolves which local names reach a client library first — imports, `require`, destructuring, aliases, and instances from `axios.create()` / `new Pool()` — and only reports calls made through those names, so an unrelated `.get()` on an unrelated object is structurally incapable of being reported.

The two graded fields stay independent, as the schema specifies. `targetSource` says where a call points: a URL literal, the name behind `process.env.X` (including inside an interpolated URL), a config key path, or nothing. `confidence` says only how directly the call was reached — `certain` for a direct call on an imported client, `likely` for an alias or a configured instance, `inferred` for a dynamic member access. A literal target and an env target on equally direct calls therefore grade identically, which is pinned by a test so the two fields cannot drift into stating one fact twice.

Files are read from the inventory, so the same ignore rules, skip directories and incremental caching apply as everywhere else; test and docs roles are skipped, since a call site in a fixture is not a dependency the repository has. Still deterministic: no LLM, no network, canonically ordered.
