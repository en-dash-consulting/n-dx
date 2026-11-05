---
id: "6a77921e-d047-41a8-be72-ed1729555dd7"
type: "task"
title: "Settings › Commands drops its Reference tab from the URL, so a reload or Back lands on Run"
slug: "settings-commands-drops-its-reference"
description: "Verdict: should-fix (ndx-adversarial-review, severity low).\n\nScenario: open /command-reference. The server 302s to /commands/reference, and CommandsView (packages/web/src/viewer/views/commands.ts, initialTab) reads the pathname once at mount and opens Reference. Then use-route-state's seed replaceState rewrites the address to /commands, because entryUrl only carries a runId or taskId. A reload, a copied link, or Back/Forward to that entry opens the Run tab. Clicking a tab also never changes the URL. An in-app navigateTo(\"command-reference\") resolves through resolveViewAliasRoute(...)?.view to \"commands\" and drops the sub, so it lands on Run too. Nothing in the app calls it today, which keeps this low.\n\nReachability: the direct /command-reference load works and is tested. Only reload, share and history after landing are affected.\n\nOptions:\n(a) Carry the tab in route state: a `tab` field on HistoryEntry, set from parsePathnameRoute's subId for \"commands\", emitted by entryUrl as /commands/reference, and passed to CommandsView as a prop with tab clicks calling navigateTo. Cost: moderate plumbing in use-route-state and view-registry. Recommended.\n(b) Have CommandsView replaceState its own sub-path on tab change. Cost: small, but it fights the router's own replaceState. Not recommended."
acceptanceCriteria:
  - "After loading /command-reference, the address bar reads /commands/reference and a reload still opens the Reference tab"
  - "Choosing a tab on Settings › Commands updates the URL, and Back returns to the previous tab"
  - "navigateTo(\"command-reference\") opens Settings › Commands on the Reference tab"
  - "A unit test covers the route state carrying the Commands tab"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
