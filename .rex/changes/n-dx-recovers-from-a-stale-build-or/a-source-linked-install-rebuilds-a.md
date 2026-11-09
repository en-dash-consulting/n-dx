---
id: "c4e62e1c-54e8-48e8-92c3-71fc0b7aba7c"
type: "task"
title: "A source-linked install rebuilds a stale dist/ before it spawns, instead of printing a pnpm command"
slug: "a-source-linked-install-rebuilds-a"
description: "Covers staleWebDistWarning and the rebuild half of serverRefreshFix in packages/core/web.js, 'Build artifact missing … Run pnpm install (or pnpm build)' in packages/core/cli.js, and 'Viewer not built. Run pnpm build first.' in packages/core/export.js. When the checkout is source-linked and a package's dist/ lags its source (scripts/lib/stale-dist.mjs / the build stamp) or is missing, ndx runs the package build itself, says it is doing so, and continues the command; a failed build reports the build's own error. A published install that is missing a dist/ says to reinstall (it cannot rebuild). SAFETY: the operator's live hub runs on 127.0.0.1:3117 with ~/.n-dx as its home and serves 25 projects. Never run 'ndx hub stop', 'ndx start' or anything that stops, replaces or registers with that hub. Every test and manual check uses a temporary NDX_HOME and a free port (hub.port / --port)."
acceptanceCriteria:
  - "ndx start on a source-linked checkout whose @n-dx/web dist/ lags its source rebuilds it and then spawns, printing that it rebuilt, with no pnpm instruction"
  - "A command whose package dist/ is missing on a source-linked checkout builds it and runs, rather than exiting with the pnpm hint"
  - "ndx export with no built viewer builds it on a source-linked checkout"
  - "A failed automatic build exits non-zero with the build's error output"
  - "Tests cover the lagging, missing and failed-build cases without touching the operator's hub"
priority: "high"
source: "ndx-capture"
---
