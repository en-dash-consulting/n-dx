---
"@n-dx/web": patch
---

`GET /api/llm/config`'s `effective` block now reads `hench.provider` and
`hench.models.<vendor>` from `.n-dx.json`/`.n-dx.local.json`, not only from
`.hench/config.json`.

hench's own help documents `hench.models.<vendor>` in `.n-dx.json` as the way
to pin the agent's model, and the dashboard's Robot Wrangler page saves there
too — but `resolveEffectiveAgentConfig` only ever read `.hench/config.json`,
so the settings page could report a model `ndx work` would not actually use.
It now merges the `hench` sections of both override files in with
`.hench/config.json` the same way hench's own `loadConfig` does: an invalid
merged field (an unknown vendor key, an empty model string) reverts to the
`.hench/config.json` value rather than dropping the override silently.

The contract test now runs hench's side through its own config loader instead
of handing `resolveAgentModel` a `models` literal, and its matrix adds cases
for each override file, both files set at once, and an invalid override.
