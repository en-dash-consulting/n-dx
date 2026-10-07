---
"@n-dx/rex": patch
---

Remove `src/store/adapter-config.ts` — the last of the tracker-integration code.

`adapter-config.ts` was the remains of the adapter registry: `.rex/adapters.json`
persistence plus credential redaction and environment resolution. It was extracted
as a neutral module when the Notion, Jira, Asana and GitHub Projects adapters were
deleted, specifically so the dashboard's `routes-notion.ts` could keep reading the
file. That route has since been deleted too, which left the module with no caller
anywhere in the repository while it was still exported from `public.ts` and
`src/store/index.ts`.

Gone from the public API: `loadAdapterConfigs`, `getAdapterConfig`,
`saveAdapterConfig`, `removeAdapterConfig`, `isSensitiveField`, `envVarName`,
`redactValue`, `isRedactedField`, `resolveRedactedConfig`, and the `AdapterConfig`,
`AdapterConfigField` and `RedactedField` types.

This supersedes the earlier plan to keep the redaction and env-var helpers for a
future work-tracker bridge. That plan predated the removal of their last caller.
Keeping them would have frozen a credential-persistence API for a feature that no
longer exists into the 1.0.0 surface, on the strength of a consumer that does not
exist yet and will own its own config when it does — the helpers are forty lines of
string manipulation, cheaper to write again in the right package than to carry as a
semver commitment in the wrong one.

`file-adapter.ts` (the local store) and `src/core/sync.ts` (item bookkeeping, not the
sync engine) are untouched, as before.

Two pieces of housekeeping travelled with it, because both were about this removal:

- `packages/rex/tests/integration/domain-layer-boundary.test.ts` still listed
  `../../store/adapter-registry.js` in `KNOWN_VIOLATIONS` after that file was
  deleted. The list is only ever read as "is this import permitted", so an entry
  whose module is gone permits nothing and nothing complains — it just leaves the
  tracked surface describing imports that cannot happen. The entry is removed and a
  new assertion fails on any `KNOWN_VIOLATIONS` entry whose module no longer exists,
  so the next deletion cannot leave one behind.
- The changeset for the original adapter removal said the credential helpers
  "stayed". They ship in the same release as this change, so that sentence would
  have contradicted this entry in a single changelog. It now says they were moved at
  that step and removed later, which is what happened.

`docs/archive/collaborative-workflows-discovery.md` still describes the adapters and
`.rex/adapters.json`. That is deliberate: the archive is explicitly point-in-time
("every page here describes the state of the project on the date it was written and
has not been maintained since"), and it is retained to record why a decision was
made. Editing it would falsify the record rather than update it.
