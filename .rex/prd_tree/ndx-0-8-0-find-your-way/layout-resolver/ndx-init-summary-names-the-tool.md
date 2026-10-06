---
id: "835757f4-7a49-4000-96e3-ff0ae66b0611"
level: "task"
title: "ndx init summary names the tool directories the project actually uses"
status: "in_progress"
priority: "medium"
startedAt: "2026-10-06T22:25:20.198Z"
acceptanceCriteria: []
description: "After ndx init, the summary prints '.sourcevision/ created', '.rex/ created' and '.hench/ created', but establishInitLayout puts every new project on the .ndx/ layout, so the directories that exist are .ndx/sourcevision, .ndx/rex and .ndx/hench. The created/reused detection already uses the resolved layout (packages/core/cli.js, layout.sourcevisionDir etc.); only the labels are hard-coded. Found during review of #529; pre-existing on main.\n\nScope:\n- packages/core/cli.js printStaticInitSummary: label each line with the resolved directory, relative to the project root, with a trailing slash (.ndx/rex/ on the new layout, .rex/ on a legacy project re-initialised in place).\n- packages/core/cli-ink.js: the Ink (TTY) init summary shows the same resolved names.\n- packages/core/help.js: the init description no longer claims it sets up .sourcevision/, .rex/ and .hench/; describe what it sets up without naming a fixed folder, or name both layouts.\n\nAcceptance criteria:\n- On a fresh directory, the static init summary names .ndx/sourcevision/, .ndx/rex/ and .ndx/hench/ (test).\n- On a project already on the legacy layout, the summary names .sourcevision/, .rex/ and .hench/ and reports them reused (test).\n- The Ink summary uses the same resolved labels (test, or a shared helper that both paths call and that is tested).\n- No new literal .rex/, .hench/ or .sourcevision/ path is introduced; labels come from resolveLayout via packages/core/layout.js.\n\nConstraints: packages/core orchestration uses the core resolver (packages/core/layout.js) and never imports other packages. Changeset: @n-dx/core patch. Keep the change to the summary and help text; no unrelated refactors."
lastModified: "2026-10-06T22:25:20.634Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
