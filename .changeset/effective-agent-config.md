---
"@n-dx/web": patch
"@n-dx/hench": patch
---

Dashboard: `GET /api/llm/config` reports what `ndx work` will actually run.

The response gains an `effective` block — `{ vendor, provider, model,
modelSource }` — describing a flagless run. Until now the route returned
configured keys and left the reader to perform the resolution over them, which
is the step that goes wrong: the answer is assembled from `llm.vendor`, the
`llm.*` model fields, `hench.provider` and `hench.models.<vendor>` across two
files, and the rungs are not in the order anyone guesses. A page showing
`llm.claude.model` can name a model the agent loop does not use, because
`hench.models.claude` outranks it and only `ndx work` reads it.

`modelSource` names the winning rung using llm-client's exported `ModelSource`
union rather than restated literals, minus `cli-override` — a request carries
no `--model`, so the route can never observe that rung. `provider` is
`hench.provider` after the same switch `cmdRun` applies: a vendor with no CLI
(google, local) auto-switches `cli` to `api`.

Web cannot import hench, so `packages/web/src/server/effective-agent-config.ts`
is a separately maintained twin of hench's `resolveAgentModel` and provider
gate. Only the rung *ordering* is copied — every rung's computation is called
from `@n-dx/llm-client`, which both packages share. A fixture matrix across
all four vendors and nine config shapes runs both sides and compares
(`tests/integration/effective-agent-config-contract.test.js`).

hench exports `resolveAgentModel` (plus its parameter and result types, and
`HenchAgentModels`) from its public API for that contract test, the same reason
`VENDOR_PROVIDERS` is already exported: not to be called at runtime, but so the
copy web is forced to keep can be checked against the original.

A `hench.models` map with any entry hench's schema rejects — an unknown
vendor key, a non-string, an empty string — is discarded whole rather than
filtered, because that is what hench's own config salvage does with an
invalid optional field. Keeping the good entries would report an override
`ndx work` does not apply, which `ndx config hench.models.gemini …` (the
vendor is `google`) makes easy to hit.

Two configurations resolve but would refuse to run — `vendor=codex` with
`provider=api`, and a model pinned for a vendor that cannot run it. The route
reports the resolution rather than throwing, because a settings page that 500s
on a bad saved value is one you cannot use to fix it.
