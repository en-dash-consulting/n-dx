---
id: "44bea9a4-d841-41b5-9a8b-cfe67d598298"
level: "task"
title: "resolveNdxBin: resolve @n-dx/core from the server module graph before the dogfood path"
status: "completed"
priority: "high"
startedAt: "2026-08-18T21:58:47.192Z"
completedAt: "2026-08-18T22:05:09.667Z"
endedAt: "2026-08-18T22:05:09.667Z"
acceptanceCriteria:
  - "resolveNdxBin resolves @n-dx/core/cli.js from the server module graph when no project-local ndx bin exists"
  - "The dogfood packages/core/cli.js path is used only as the final fallback"
  - "refresh, ci, auth, export, and self-heal endpoints work on an analyzed project that is not the n-dx monorepo"
description: "Pre-existing on main (2 call sites) but this branch adds refresh, ci, and auth call sites (5 total). resolveNdxBin has only local .bin/ndx then join(projectDir,'packages','core','cli.js') — the dogfood path valid only when the analyzed project is the n-dx repo itself. resolveNdxCli's middle step (req.resolve of the package from the server's own module graph) is missing, so all five endpoints fail with Cannot find module on any normal analyzed project. Fix: add req.resolve('@n-dx/core/cli.js') between the local-bin check and the dogfood fallback — verified feasible: @n-dx/core has no exports map and ships cli.js in files, so the subpath resolves under CJS."
---
