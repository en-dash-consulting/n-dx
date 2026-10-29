---
id: "473f775b-508d-46fa-a65a-4c8e7e239fc2"
type: "task"
title: "A cloned repo's package runs under another copy's approval when n-dx is installed in that repo"
slug: "a-cloned-repo-s-package-runs-under"
description: "Verdict: must-fix (security). findGlobalRoot (packages/core/extension-discovery.js:207) maps a project-local Q/node_modules/@n-dx/core to Q/node_modules and treats it as the global source; globalIsProject (:165) only catches cwd === Q. approvalFor (packages/core/extension-state.js:131) matches non-project approvals by packageName only, ignoring the stored source and directory. Trigger: user approved global ndx-foo@1.0.0; cloned repo Q has @n-dx/core as a devDependency and node_modules/ndx-foo with the same version and manifest block but a different bin; `npx ndx foo` from Q/sub runs it unprompted (reproduced). Also full-scans Q/node_modules from any subdirectory. Reachable: ndx <name>, ndx --help, hub list. Fix (recommended, both): bind approvals to source plus the real path of the package dir (recordApproval already stores source); treat a root as global only when it is not a project's node_modules (no package.json beside it, or compare with the npm prefix derived from process.execPath; pnpm's global dir has a package.json and needs its own test)."
acceptanceCriteria:
  - "An approval for a package at one directory does not approve a same-named, same-version package at a different directory or source"
  - "Running from a subdirectory of a project that installs @n-dx/core locally does not classify that project's node_modules as the global source"
  - "A test reproduces the subdirectory scenario and fails before the fix"
priority: "high"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
