---
id: "3cf901ba-8119-4a0f-ad16-7941665cedbe"
type: "task"
title: "Sidecar command cards expand the effects line's layout path tokens"
slug: "sidecar-command-cards-expand-the"
description: "Found in the M2 browser check (2026-10-28): the command card for ndx status reads 'reads {prdRead} + {hench}/runs/'. GET /api/commands/manifest serves declarations with layout tokens unexpanded beside the project's layoutPaths, and the reader is meant to expand them (see effectsLayoutPaths in packages/web/src/server/routes-commands.ts); packages/web/src/viewer/components/sidecar-cards.ts does not."
acceptanceCriteria:
  - "A command card's effects line replaces every {token} with the manifest's layoutPaths value, so ndx status reads '.rex/product/ and .rex/changes/' on a v2 project, never '{prdRead}' (tested)"
  - "A token the manifest's layoutPaths does not name is left as written rather than dropped (tested)"
priority: "medium"
source: "ndx-capture"
---
