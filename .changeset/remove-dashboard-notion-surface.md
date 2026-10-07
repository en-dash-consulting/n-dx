---
"@n-dx/web": patch
"@n-dx/core": patch
---

Remove the dashboard's Notion and integration surfaces

The tracker adapters went in the previous change; these are the dashboard
surfaces that existed to configure them. With no adapter behind them they
were a settings page for a feature that could not do anything.

Deleted: `routes-notion.ts` and its `/api/notion/*` endpoints, the
`notion-config` and `integration-config` views, the Notion schema wizard and
both stylesheets. The `rex.notionSync` and `rex.integrations` feature toggles
go with them — from the registry in `routes-features.ts`, from the route gate
table, from the static export's prerendered `features.json`, and from
`ndx config --help`. The Project page is now two sections, analyze-and-plan
settings and feature flags, with no conditional sections at all.

`routes-notion.ts` held the last dynamic `@n-dx/rex/dist/*` import in web, so
that escape hatch and its entry in the architecture policy's documented-dynamic-
imports registry are both gone. Note that this leaves rex's
`src/store/adapter-config.ts` — extracted in the previous change specifically so
this route could keep reading `.rex/adapters.json` — without a consumer. It is
still exported from `public.ts` and still tested; removing it is a rex decision
rather than a dashboard one, so it is left for the follow-up that records the
tracker removal.

Two things were removed beyond the literal surface, both because deleting the
routes made them dead rather than merely unused:

- `RouteFeatureGate.prefix`. Both subtree gates were Notion's and
  `/api/integrations`'; every remaining gate lists its paths exactly. An
  unexercised matching branch in the function that decides whether a disabled
  feature's endpoint is reachable is the kind of thing that rots, so the field
  and its branch go and `exact` becomes required.
- The `.cmd-sync-*` and `.intg-*` rules in `commands.css` and `deployed.css`,
  orphaned when the sync buttons and the integration list went.

The `/notion-config` and `/integrations` redirect aliases are deliberately
kept. They are URL compatibility for 0.8.0 bookmarks and they point at
`/project`, which still exists — removing them would turn a working redirect
into a 404 and buy nothing.

Unrelated robustness fix in `tests/e2e/prompt-census.test.js`: it enumerated
files with `git ls-files`, which reads the index, then read each one from disk.
A file deleted in the working tree but not yet staged made it throw ENOENT and
report as a crash rather than as the clean result it was. It now skips paths
that no longer exist.
