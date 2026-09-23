---
id: "e92dfe2f-762f-4a30-adb7-dde28e7c7ff9"
level: "task"
title: "Partition balance and nesting: lopsided subdivisions count as failures, oversized zones flagged, tests grouped with their code, iso map draws sub-zones"
status: "pending"
priority: "high"
tags:
  - "sourcevision"
  - "zones"
  - "iso-map"
blockedBy:
  - "84a91da2-f8b2-4970-8e4e-2d5826a75533"
source: "ndx-capture"
acceptanceCriteria:
  - "Unit test: a subdivision whose largest child holds >= 70% of the parent is retried; if no balanced split exists the zone has no subZones and a structural finding is emitted"
  - "Unit test: a 60-file zone of three directories with sparse imports subdivides into three children none above 70%"
  - "Unit test: no zone in a subdivided tree has a child that holds >= 70% of it (checked recursively on the n-site2-shaped fixture)"
  - "Unit test: assessPartitionHealth marks a partition borderline when a top-level zone exceeds the oversized threshold without balanced sub-zones"
  - "Unit test: tests under app/utils/__tests__ and app/routes/__tests__ land in different zones grouped by their parent directory; tests under a top-level tests/ keep per-suite grouping"
  - "Unit test: iso-sources passes sub-zones as children; iso-model lays out child tiles inside the parent box, sized by file count"
  - "iso-skill drift test passes after regenerating the skill script"
  - "ZONE_ALGORITHM_VERSION bumped"
  - "Live on a copy of n-site2: largest top-level zone share and deepest-leaf share recorded before/after in this item's log; no test zone mixes more than one production parent directory"
  - "pnpm --filter @n-dx/sourcevision test passes; sourcevision eval gate passes"
description: "On n-site2 (2026-09-22, after the partition-review fix) the top zone holds 639 of 1,102 files (58%) against a 15% `maxZonePercent`. The cap is satisfied only nominally, through `subdivideZone`, and the subdivision is degenerate. Each level peels off 2–14-file slivers and pushes the rest down a level:\n\n```\ncore-application-monolith 639\n└─ routes-apps/routes 585\n   └─ …/components 557\n      └─ …/utils 514   (80% of the top zone, depth 3)\n```\n\nSeparately, quarantined tests from every `__tests__` directory (`app/utils/__tests__`, `app/routes/__tests__`, `app/components/__tests__`, …) end up in one 250-file zone named \"App\". The iso map (`export/iso-sources.ts`) reads only top-level `zones`, so none of this nesting is visible. Box size is capped, so a 639-file zone looks like any other large box.\n\nChanges:\n1. **Balanced subdivision.** A subdivision whose largest child keeps ≥ 70% of the parent's files is a failed split. Retry it once with a finer Louvain resolution, then with a directory split: group by the dominant first differing directory segment, and merge groups below the small-zone threshold into their nearest sibling by path. If neither produces a balanced split, keep the zone whole with no sub-zones and emit a structural finding, rather than nesting a sliver chain.\n2. **Oversized-zone signal.** `assessPartitionHealth` treats a top-level zone above `max(2 × maxZonePercent, 30%)` of files, with no balanced subdivision, as `borderline`. The Jev map question then sees it; the reason is recorded.\n3. **Tests with their code.** Quarantined test files under a `__tests__`, `test` or `tests` directory nested inside a production tree are grouped by that directory's parent (`app/utils/__tests__` → `app/utils`), and the group is named `tests-<parent>`. Only a top-level test root keeps today's per-suite grouping (`tests/`, `Tests/<suite>/`, `e2e/`).\n4. **Iso map draws sub-zones.** `IsoZoneInput` gains optional `children`. A zone with balanced sub-zones draws as a box divided into child tiles, sized by file count, with labels on hover. Import edges whose endpoints both resolve to child tiles attach to the tiles. Regenerate `.claude/skills/iso-map/scripts/iso-map.mjs` via `scripts/build-iso-skill.mjs`.\n5. Bump `ZONE_ALGORITHM_VERSION`."
lastModified: "2026-09-23T02:33:11.021Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
