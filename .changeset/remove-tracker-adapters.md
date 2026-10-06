---
"@n-dx/rex": patch
"@n-dx/core": patch
"@n-dx/web": patch
---

Remove the Notion, Jira, Asana and GitHub Projects store adapters, `rex sync`,
`rex adapter` and the `sync_with_remote` MCP tool.

No project used them. They were written against the whole-document store model
that the folder tree replaced, so every one of them had been carrying a
conversion layer between a PRD tree and a flat list of remote records — four
copies of a translation nobody was running. A work-tracker bridge is planned as
its own package, built against the storage model that actually exists; keeping
four unexercised adapters alive until then buys nothing and has to be migrated
with every schema change.

Gone from rex: `notion-*`, `jira-*`, `asana-*` and `github-projects-*` under
`src/store/`, the `integration-schema` system and its four tracker schemas, the
`AdapterRegistry`, `SyncEngine`, the `sync` and `adapter` CLI commands with
their help entries, and the `sync_with_remote` MCP tool. Gone from core: the
`ndx sync` command, its help and its command-effects entry.

Two dashboard surfaces went with them, because they could not outlive what they
called: `routes-integrations.ts`, whose every handler began by importing the
deleted integration-schema modules, and `POST /api/commands/sync`, which spawned
the deleted CLI command. `routes-notion.ts` is unaffected — it reads and writes
`.rex/adapters.json` through the credential helpers below, which stayed. The
Notion wizard, the feature toggles and the remaining viewer views are a separate
change.

What stayed, and why:

- **`file-adapter.ts` and `folder-tree-store.ts`** — the local stores. Untouched.
- **`src/core/sync.ts`** — not the sync engine despite the name. It is the item
  bookkeeping module (`stampModified`, `isModifiedSinceSync`,
  `ITEM_BOOKKEEPING_FIELDS`), and the folder-tree store, the bundle exporter and
  `rex analyze` all depend on it.
- **Credential redaction and environment resolution**, now in
  `src/store/adapter-config.ts` as plain functions rather than registry methods.
  A secret handed to rex still never reaches `.rex/adapters.json`; a
  `{ __redacted, envVar, hint }` marker goes there and the real value is read
  from the environment.
- **`WorkItemLink` in the schema.** Items may still record a link to an external
  system; nothing in rex writes one now. Removing the field is a schema change,
  not an adapter removal.

`createStore` keeps its adapter-name parameter and now throws for anything other
than `"file"`. Callers across rex and hench pass the name explicitly, and a
parameter that is silently ignored is worse than one that is checked — a caller
asking for `"notion"` should hear that it is gone rather than quietly receive the
local store.

The redaction rule changed shape. It used to read each adapter's `configSchema`
for an explicit `sensitive: true`; those schemas went with the adapters, so the
key name is now the only signal and the rule had to widen to match it. A key
whose name ends in `token`, `secret`, `password`, `passphrase`, `apikey` or
`credential` is redacted — which newly covers `apiToken`, previously caught only
by Jira's schema flag. The match is anchored at the end of the key rather than
done as a substring, so `projectKey` is still stored in the clear: redacting it
would write a `__redacted` marker over a value that was never a secret and then
fail to resolve it from an environment variable nobody set.
