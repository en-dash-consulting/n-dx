---
id: "84a91da2-f8b2-4970-8e4e-2d5826a75533"
level: "task"
title: "Route-aware partitioning: detect file-based routing, treat route directories as generic, group route modules by route subtree"
status: "pending"
priority: "high"
tags:
  - "sourcevision"
  - "zones"
source: "ndx-capture"
acceptanceCriteria:
  - "Unit test: buildProjectProfile detects React Router from react-router.config.ts or app/routes.ts, Next from the next dependency, SvelteKit from @sveltejs/kit, and records routeConvention roots"
  - "Unit test: with a React Router convention, a zone of app/routes/apps/watt-matters/** files derives id watt-matters, not routes or routes-N"
  - "Unit test: a fixture of three route features (each: route files + colocated components) whose route files import a shared component library partitions one zone per feature, not by shared imports"
  - "Unit test: route-subtree proximity edges do not raise measured cohesion (metrics use the import-only graph)"
  - "Unit test: naming candidates include the route path for a zone under one route subtree"
  - "ZONE_ALGORITHM_VERSION bumped"
  - "Live on a copy of n-site2: no zone id matches /^routes(-\\d+)?$/ and each app under app/routes/apps/<name> with >= 3 files is its own zone or sub-zone; recorded in this item's log"
  - "pnpm --filter @n-dx/sourcevision test passes; sourcevision eval gate passes"
description: "n-site2 is a React Router app (`react-router.config.ts`, `app/routes.ts`, `app/routes/**`) but `project-profile.json` lists `express, react, vite, vitest` — nothing in sourcevision knows `app/routes/` is a file-based route tree. Consequences seen on a fresh partition (2026-09-22):\n\n- **Every zone under `app/routes/` derives the id `routes`** (the most common segment; only `src/lib/app/packages/internal/pkg` are generic), so ids collide and fall to `routes-3`, `routes-4`, `routes-8`, `routes-9`, `routes-18`.\n- **Route modules are grouped by incidental imports.** Route files rarely import each other; they import shared components, so Louvain groups them by which shared modules they happen to use: `routes-blog` = `SwirlGenerator.tsx` + `accessibility.tsx` + `blog/layout.tsx`; `routes-n-me` includes `apps/prompt-tool/layout.tsx` and `blog/authors.tsx`; `routes-9` = scrapbook + timer. Directory-proximity edges are only added for files with no imports at all, so they never help here.\n\nChanges:\n1. **Detection.** `buildProjectProfile` recognises file-based routing and records `routeConvention: { framework, roots }` — React Router 7 / Remix (`react-router.config.*`, `app/routes.ts`, `@react-router/*` or `@remix-run/*` deps → `app/routes`), Next (`next` dep → `app`, `pages`, `src/app`, `src/pages`), SvelteKit (`@sveltejs/kit` → `src/routes`). Add the framework to `frameworks`.\n2. **Generic segments.** When a convention is detected, its root segment (`routes`, `pages`, and `app` already) is skipped by `deriveZoneId` / `disambiguateZoneId` like `src`, so ids come from the feature directory beneath it.\n3. **Route subtree grouping.** Route modules under a convention root get directory-proximity edges to their siblings in the same route subtree (the first directory segment below the root, e.g. `apps/<name>`, `admin`, `blog`, `_marketing`), weighted like the existing proximity edges, so a feature's route files and its colocated `components/`, `lib/`, `hooks/` cluster together even when they import shared code more than each other. Tracked in `metricsGraph` exclusion the same way proximity edges are (not evidence of cohesion).\n4. **Route-path name candidates.** For zones whose files sit under one route subtree, add the route path (`/apps/scrapbook`, `/admin`) as a naming candidate in `zone-naming.ts` alongside the directory candidates.\n5. Bump `ZONE_ALGORITHM_VERSION`."
lastModified: "2026-09-23T02:32:52.999Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
