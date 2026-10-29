---
id: "e0167d83-bac8-45cb-b6fc-3a94330d1f6a"
type: "task"
title: "On Windows, concurrent writes to extensions.json fail with EPERM on rename and leave .tmp files"
slug: "on-windows-concurrent-writes-to"
description: "Verdict: must-fix (Windows is a primary platform; cheap). writeCache (packages/core/extension-discovery.js:545-550) and updateExtensionsFile (extension-state.js:116-124) rename <path>.<pid>.tmp over extensions.json with no retry; Windows refuses a rename onto a file another process has open. Trigger (reproduced): 8 concurrent `ndx extensions list --json` from new directories: 4 report \"cache not written: EPERM ... rename\" and leave extensions.json.<pid>.tmp behind; updateExtensionsFile racing 6 list processes threw EPERM once in 250 writes, so `ndx extensions enable --yes`, disable, remove or a first-run approval can crash while the hub lists. writeCache's catch never removes the tmp file; updateExtensionsFile has no catch. Fix (recommended): retry the rename on EPERM/EACCES/EBUSY with short backoff (graceful-fs style), remove the tmp file on final failure, and sweep stale extensions.json.*.tmp. Alternative: an O_EXCL lock file around both writers."
acceptanceCriteria:
  - "Concurrent list runs and approval/disable writes on Windows complete without EPERM errors"
  - "No extensions.json.*.tmp file is left after a failed or concurrent write"
  - "A test with concurrent writers asserts both outcomes"
priority: "medium"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
