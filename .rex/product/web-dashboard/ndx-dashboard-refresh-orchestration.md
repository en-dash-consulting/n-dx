---
id: "f82b4f30-8f6a-40d9-95a7-57825dd321cb"
type: "capability"
title: "ndx Dashboard Refresh Orchestration"
slug: "ndx-dashboard-refresh-orchestration"
statement: "The ndx refresh command rebuilds the dashboard's UI assets and refreshes its SourceVision-derived data and PR markdown cache, signalling a running ndx start server to reload when it can."
criteria: [{"id":"c1","text":"When an operator runs `ndx refresh`, the CLI shall turn the requested refresh into a deterministic plan of build and data steps."},{"id":"c2","text":"When `ndx refresh` runs its UI build step, the CLI shall rebuild the `@n-dx/web` dashboard artifacts."},{"id":"c3","text":"When the SourceVision assets require a rebuild, `ndx refresh` shall rebuild them along with the `@n-dx/web` artifacts."},{"id":"c4","text":"When `ndx refresh` runs its data step, the CLI shall refresh the SourceVision-derived dashboard data."},{"id":"c5","text":"When the operator requests it, `ndx refresh` shall regenerate the PR markdown cache in the same run."},{"id":"c6","text":"While an `ndx start` session is running, `ndx refresh` shall attempt to signal that server to reload live."},{"id":"c7","text":"If the running server cannot be updated live, `ndx refresh` shall tell the operator that a restart is needed."}]
source: "smart-add"
---
