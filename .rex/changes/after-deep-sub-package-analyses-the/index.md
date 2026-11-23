---
id: "2ecf4418-cfab-48b1-8e0b-6cc3ef588e46"
type: "change"
title: "After --deep sub-package analyses, the root analysis runs with the last sub-package's process-wide settings"
slug: "after-deep-sub-package-analyses-the"
summary: "On a deep analysis of a repository with nested analysed packages, the main analysis can end up using a sub-package's settings instead of its own, including the request size limit a project configured. Fixing it makes the root run honour the root's configuration."
intent: "Failure: `cmdAnalyze` (`packages/sourcevision/src/cli/commands/analyze.ts`) calls `initAndLoadLLMConfig(absDir)` for the root (about line 486) and only then `runDeepSubAnalyses` (about line 541), which calls `cmdAnalyze(subDir)` per sub-package. Each nested call runs `initAndLoadLLMConfig(subDir)` again, overwriting process-wide state: `setLLMConfig`, `setProjectDir`, `configureJudgmentCache`, `configureRerunLog`, `configureRuleCache` and (added by task 1e1b26d9) `setJevRequestByteCeiling`. Nothing re-applies the root's values before `executePhases(ctx, …)` runs the root phases.\n\nScenario: root config sets `sourcevision.jev.requestByteCeiling: 65536`; `packages/a` has its own analysis and no such key. `ndx analyze --deep .` → root init sets 65536, the nested analyze of `packages/a` resets it to undefined, and the root's typed-finding and classify requests are packed at the 128 KiB default. The same ordering leaves the root phases with the sub-package's project dir, LLM config and judgment/rule cache directories.\n\nReachability: `ndx analyze --deep` on any repository where `detectSubAnalyses` finds a nested analysed directory. Verified by reading the code only; not reproduced in a run.\n\nVerdict: should-fix (severity medium). The clobbering of project dir, LLM config and caches predates task 1e1b26d9 (out of scope there); the byte ceiling joined the same init and inherits the defect.\n\nOptions:\n- Recommended: split the process-wide setup out of `initAndLoadLLMConfig` into one function and call it again for the root after `runDeepSubAnalyses` returns. Cheap; one integration test with a stub sub-analysis.\n- Run sub-analyses before the root's init. Smaller diff, but the root's `.sourcevision` init message and vendor header move after the sub-package output."
acceptanceCriteria:
  - "After `runDeepSubAnalyses` returns, the Jev request byte ceiling in force is the root config's `sourcevision.jev.requestByteCeiling`, not the last sub-package's (test with a root override and a sub-package without one)"
  - "After `runDeepSubAnalyses` returns, the project dir, LLM config and the judgment, rerun and rule cache directories are the root's (test)"
touches:
  - "36cd4378-93d4-4cf7-8381-7029a98ef2f2"
priority: "medium"
discoveredFrom: {"item":"1e1b26d9-6e14-41b1-9232-3d32869355d1","run":"1391979f-ddf3-425c-ac39-135b472c5a51"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
