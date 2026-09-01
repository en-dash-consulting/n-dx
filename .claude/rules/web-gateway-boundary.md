---
paths:
  - "packages/web/src/viewer/**"
  - "packages/web/src/shared/**"
  - "packages/web/src/schema/**"
---

# Web viewer gateway boundary

Within the web package, `src/viewer/external.ts` concentrates all viewer-side imports
from `src/viewer/messaging/`, `src/shared/`, and `src/schema/`. `RequestDedup` is
canonically located in `src/viewer/messaging/request-dedup.ts` and re-exported through
`external.ts` for viewer consumers.

**Type-import exemption:** the root gateway rule (see root `CLAUDE.md`) requires
`import type` to flow through gateways too, to prevent type-import promotion erosion.
Web viewer files are exempt from this because the server/viewer boundary prevents them
from reaching the server-side gateway.

**Messaging exemption:** `src/viewer/messaging/` files may import directly from
`src/shared/` without going through `external.ts`. The shared/ directory is neutral
(neither server nor viewer), and messaging utilities access it directly to avoid
zone-level dependency inversion. Enforced by `boundary-check.test.ts`. New files added
to `viewer/messaging/` inherit this exemption — review them to ensure they are genuine
messaging infrastructure, not general viewer code.
