---
id: "ce03b7ed-9779-4ff6-9a9b-1462891620a3"
type: "change"
title: "Dashboard behind the hub: product logos, favicon and notification icon carry the /p/<id> prefix; Isometric Map matches `sv iso` and stays current"
slug: "dashboard-behind-the-hub-product-logos"
intent: "**Logos.** Since the hub began serving projects under `/p/<id>/`, the product logos (SourceVision, Rex, Hench in the sidebar, rail and branded headers) have been broken. `ProductLogoPng` used bare root paths (`/Rex-F.png`), which the browser requested from the hub root. Only the n-dx mark went through `appUrl`. The favicon swapper had the same bug. The notification icon pointed at `/favicon.png`, which no build ships at all. All three now go through `appUrl`, and the notification icon uses `n-dx.png`.\n\n**Isometric Map in the dashboard.** The route and `sv iso` share `loadIsoInput → buildIsoModel → renderIsoMap`. The dashboard still differed in two ways:\n- The map runs in a sandboxed `srcdoc` iframe, where the drill-in's hash navigation plus reload cannot work, so \"Open on its own\" and the breadcrumb were dead. Scenes now switch in the page. The hash is still read at load and updated with `history.pushState` where allowed, and back/forward work through `popstate` / `hashchange`.\n- The view built the map once on mount. It now regenerates with the applied controls whenever the analysis stamp changes (`analyzedAt`, narration status and `finishedAt`, `structureHash`), so new zones and narrated names show up without a reload."
acceptanceCriteria:
  - "Unit test: with base path /p/caos, product logo and n-dx logo src and the product favicon href carry the prefix; standalone they stay root-relative"
  - "jsdom: in a document without a navigable URL, Open on its own shows the area's zones and the breadcrumb returns to the areas map"
  - "Unit test: IsoMapView regenerates when analysisStamp changes and not on unrelated re-renders"
  - "Unit test: isoMapAnalysisStamp changes with analyzedAt and with narration finishing"
  - "pnpm --filter @n-dx/web test and pnpm --filter @n-dx/sourcevision test pass; iso-skill drift passes"
touches:
  - "6a8f9616-59f0-458f-8e56-45abbb00a3da"
priority: "high"
tags:
  - "web"
  - "sourcevision"
  - "iso-map"
source: "ndx-capture"
---
