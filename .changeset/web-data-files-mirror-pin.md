---
"@n-dx/web": patch
---

Correct the web data-file mirror and pin it to sourcevision's.

`packages/web/src/shared/data-files.ts` restates sourcevision's `DATA_FILES` — it has to, because web reaches sourcevision only through `server/domain-gateway.ts` and the viewer is bundled for the browser. It had drifted two entries behind, so `classifications.json` and `project-profile.json` were never mtime-watched and the dashboard did not live-reload when they changed, and both were missing from `GET /data`. The viewer genuinely reads classifications, so that one was a live defect.

The two lists are now asserted equal in `cross-package-contracts.test.js`, which previously only checked that `DATA_FILES` was exported, not that the copies agreed. Adding a data file now fails the build unless both files are edited in the same change.
