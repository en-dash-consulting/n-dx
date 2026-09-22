---
id: "5d5aaed5-5b3b-4947-9320-3444ac727e1b"
level: "task"
title: "Zone identity: stale fallback names are not treated as chosen, numeric-suffix ids follow their verified names"
status: "pending"
priority: "medium"
tags:
  - "sourcevision"
  - "zones"
blockedBy:
  - "07e84b24-f429-4fc3-940c-a748db0f7878"
source: "ndx-capture"
acceptanceCriteria:
  - "Unit test: reapplyCascadeLabels replaces a preserved name 'Routes 8' on zone routes-6 with the cascade's name"
  - "Unit test: deriveZoneName never emits consecutive spaces"
  - "Unit test: a zone with id routes-11 and an accepted name 'Scrapbook Application' gets id scrapbook-application and previousIds ['routes-11']"
  - "Unit test: a zone whose id has no numeric suffix keeps its id regardless of name"
  - "Unit test: a zone pin and `get_zone` using a previous id resolve to the renamed zone"
  - "Unit test: a second run on unchanged input keeps the renamed id (no oscillation)"
  - "Live on n-site2: no zone id matches /-\\d+$/ where the zone has an accepted name; recorded in this item's log"
  - "pnpm --filter @n-dx/sourcevision test passes"
description: "Two identity defects seen on n-site2 (2026-09-22).\n\n**1. Stale fallback names survive as if chosen.** `routes-6` is named \"Routes 8\" and `routes-7` \"Routes 7\". `reapplyCascadeLabels` (`zones.ts`) keeps a preserved name when `zone.name !== deriveZoneName(zone.id)` — but after `preservePreviousZoneIdentity` or renumbering, a name that was the algorithmic default for a *different* id (\"Routes 8\" from a former `routes-8`) fails that check and is kept as a deliberate choice, and `isGenericZoneName` / the naming step's \"already tried\" skip then leave it alone forever. Treat a name as algorithmic when it equals `deriveZoneName` of the id's base with any numeric suffix (`^<Base>( \\d+)?$`), or of any id the zone has held (from the preserved identity), so it goes back through naming. Also fix `deriveZoneName` producing a double space (\"Routes  Marketing\") from ids with empty segments.\n\n**2. Numeric-suffix ids never improve.** Zone ids come from `deriveZoneId` and fall back to `<base>-<n>` (`zones.ts` numeric-suffix branch). A verified name (\"Scrapbook Application\") never flows back into the id, so `routes-11` is what every finding, CONTEXT.md heading, `ndx zone` argument and iso-map label shows. When a zone's id has a numeric suffix and its name was accepted by the naming judgment (Choice or verified generated name), derive a new id by kebab-casing the name (disambiguated against used ids, no numeric suffix unless unavoidable), and record `previousIds` on the zone. Everything that resolves zone ids — `zonePins`, `zoneAnchors` targets, `ndx zone <id>`, sourcevision MCP `get_zone`, judgment-cache keys (already name-free), `preservePreviousZoneIdentity` — accepts a previous id as an alias. Ids without numeric suffixes are never renamed (stability for zones people already refer to)."
lastModified: "2026-09-22T18:27:56.201Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
