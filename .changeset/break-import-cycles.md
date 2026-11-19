---
"@n-dx/web": patch
"@n-dx/rex": patch
"@n-dx/llm-client": patch
---

Internal: the codebase has no import cycles left, so the Analyze page's Circular deps card reads 0 after the next `ndx analyze`.

Each cycle is broken by moving a shared type or helper to its own module, or by inverting a dependency, so no behaviour changes:

- **web viewer.** `usePRDActions` takes a `renderDetail` function instead of rendering `TaskDetail` itself, since hooks import no component. The Inbox's read (`useInbox` and its helpers) moved to `views/inbox-read.ts`, and `Pending` / `StaleNotice` to `views/product-notices.ts`. The placement types moved to `components/prd-tree/placement-types.ts` and the sidecar shapes to `hooks/sidecar-types.ts`. `GuessStrength` and `PixelIconName` moved to `product-model.ts` and `types.ts`. The shell components reach their status indicators directly, and `api.ts` no longer re-exports them.
- **web hub and server.** `routes.ts` and `proxy.ts` name a `HubHost` interface, which `Hub` implements, instead of the class. The project view types moved to `hub/project-view.ts`, and the sidecar's `CarryOutResult` to `carry-out-result.ts`.
- **rex.** `PRD_FILENAME` moved to `store/paths.ts`. `ensure-legacy-prd-migrated.ts` imports the serializer directly rather than through the store barrel.
- **llm-client.** The Jev question and answer types moved to `jev-types.ts`, and `TokenCacheProvenance` to `runtime-contract.ts`.

Every moved name is still re-exported from its old module.
