---
"@n-dx/web": patch
"@n-dx/hench": patch
---

Add `GET /api/llm/catalog`, serving per-vendor model lists and the provider
choices hench accepts (claude cli or api, codex cli only, google api, local
api), so the dashboard's model picker no longer drifts from llm-client's
catalog or hench's own provider rules.

Cloud-vendor models come from llm-client's `TIER_MODELS`/`MODEL_COSTS`
catalog; local models come from a live probe of the configured local server
(empty list with a `reason` when unreachable, never an error). Provider
choices come from a new `VENDOR_PROVIDERS` table in
`packages/hench/src/cli/commands/provider-support.ts` — extracted from
`cmdRun`'s ad hoc provider checks in `run.ts`, now table-driven and re-exported
from hench's public API. Web cannot import hench at runtime, so
`packages/web/src/server/hench-config-fields.ts` keeps a separately maintained
copy of the same table; `tests/integration/cross-package-contracts.test.js`
pins the two together.

The dashboard's hench-config save path (`PUT /api/hench/config`, plus the
adaptive apply/override routes) now rejects a `provider` value the active
vendor does not support, naming the vendor and its allowed providers.

No viewer changes — the picker UI and `MODEL_SUGGESTIONS` removal are a
separate change.
