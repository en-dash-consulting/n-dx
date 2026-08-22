## hench-agent internal governance

`hench-agent` (160+ files, 31 directories) is the second-largest zone in the monorepo. Internal sub-zone boundaries:

- **`agent/`** — Agent loop, tool dispatch, conversation management
- **`prd/`** — PRD integration via `rex-gateway.ts` and `llm-gateway.ts`
- **`brief/`** — Task brief construction and context gathering
- **`tools/`** — Tool implementations (file ops, shell, search)
- **`process/`** — Process lifecycle, concurrency management

Rules:
- Each sub-zone directory should maintain a barrel `index.ts` re-exporting its public API.
- Cross-sub-zone imports should flow through barrels, not reach into internal modules.
- Boundary assertions should be added to hench's test suite before the zone reaches web-viewer's scale.
