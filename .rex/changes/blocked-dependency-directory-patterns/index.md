---
id: "a2e189ae-7950-4f42-9f9b-9ce0a3d8d486"
type: "change"
title: "Blocked dependency-directory patterns only match at the project root, so nested node_modules stays writable"
slug: "blocked-dependency-directory-patterns"
intent: "Out-of-scope finding from the adversarial review of task 034517a2 (#816 F1 follow-up). Verdict: out-of-scope (pre-existing); severity high.\n\nScenario: hench's guard matches blockedPaths with simpleGlobMatch (packages/hench/src/guard/paths.ts:48-91), which anchors the pattern at the project root (`^…$` against the root-relative path). The baseline blocks `node_modules/**`, `vendor/**`, `.build/**`, `Pods/**` etc. only at the root. In a polyglot checkout (go.mod at the root, JS frontend in `web/`), or any JS workspace monorepo (`packages/*/node_modules`), a write to `web/node_modules/.bin/vite` or to a package's `postinstall` under `packages/a/node_modules/x/` passes validatePath, even for an untrusted checkout clamped to the baseline. The payload runs the next time the operator runs npm/pnpm. This is the threat #816 F1 names; 034517a2 made the root pattern unconditional but did not reach nested directories. Its polyglot test asserts the pattern string is present, not that `web/node_modules/...` is refused.\n\nReachable: hench's own tool loop (provider=api) write_file / shell tools that call Guard.checkPath, on any monorepo or polyglot checkout. CLI-provider runs are governed by the vendor CLI's own permissions instead.\n\nOptions:\n(a) Recommended: make the baseline's dependency patterns match at any depth: `**/node_modules/**`, `**/vendor/**`, `**/.build/**`, `**/DerivedData/**`, `**/Pods/**`, `**/Carthage/**` (SECRET_PATH_PATTERNS already use `**/`). Cheap. Risk: assessment/digest unaffected (assessment checks only hench/rex/.git coverage); `vendor/**` at any depth blocks first-party code a project keeps under some nested vendor/ dir; the user can override in a trusted config.\n(b) Keep the root patterns and add the `**/` forms only to the untrusted clamp. Narrower blast radius, but splits defaults from baseline, which v1.ts documents as one table."
acceptanceCriteria:
  - "validatePath refuses `web/node_modules/.bin/x` and `packages/a/node_modules/x/package.json` under the guard baseline for every language"
  - "An untrusted polyglot checkout (root go.mod, JS frontend in web/) clamped by applyRepoTrust refuses a write to web/node_modules/ — a test that fails today"
  - "Existing hench init defaults still evaluate as baseline in the trust assessment (no repository flips to untrusted on upgrade)"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "high"
discoveredFrom: {"item":"034517a2-cf9f-4480-95ed-385ce76e17c5","run":"71261223-8957-45d0-8388-9ab3c22a8beb"}
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "security"
  - "issue-cleanup"
source: "ndx-adversarial-review"
---
