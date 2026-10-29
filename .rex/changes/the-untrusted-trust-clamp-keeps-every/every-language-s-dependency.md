---
id: "034517a2-cf9f-4480-95ed-385ce76e17c5"
type: "task"
title: "Every language's dependency directories stay blocked, whatever language the checkout looks like"
slug: "every-language-s-dependency"
description: "Hal's adversarial review of #816 (diff mode, origin/main...fix/security-repo-trust), posted 2026-10-20: https://github.com/en-dash-consulting/n-dx/pull/816, finding F1 (medium-high, must-fix):\n\n> `detectRepoLanguage` now selects the baseline instead of `config.language`. But `guardBaselineForLanguage` returns `allowedCommands`, `allowedGitSubcommands` **and** `blockedPaths` — where `blockedPaths` = `CORE_BLOCKED` + a **per-language `extraBlocked`** + `SECRET_PATH_PATTERNS`. […] `clampGuardToBaseline` **intersects** commands but **unions** blocked paths. So the detected language still decides which dependency directory the clamp protects — and a marker file is repository content.\n\n> A cloned JS/TS repo ships a `.hench/config.json` guard that raises any warning […] It also ships a **zero-byte `Package.swift`**. `detectRepoLanguage` returns `swift`, the clamp unions the Swift baseline's blocked paths, and `node_modules/**` is not among them — so the containment applied to an *untrusted* checkout no longer blocks writes into `node_modules`. […] a payload in a package's `postinstall` or `node_modules/.bin/` runs the next time the operator runs `npm` or `pnpm` themselves.\n\n> It also fires with no adversary: a polyglot checkout (Go backend, JS frontend, `go.mod` at the root) detects as `go`, and an untrusted clone silently loses the `node_modules/**` write block.\n\nFix, Hal's option (a): make `extraBlocked` cumulative. Every baseline's `blockedPaths` includes every language's dependency directories (`node_modules/**`, `vendor/**`, `.build/**`, `DerivedData/**`, `Pods/**`, `Carthage/**`), so no marker file can loosen the clamp. `allowedCommands` stay per-language. This also makes `formatRepoTrustReport`'s promise true again: until trusted, \"the repository's config can only tighten it\".\n\nCaptured with Ryan's approval on 2026-10-27, after the layer was merged with main (the PRD is v2 now)."
acceptanceCriteria:
  - "Closes #686 (finding 1, follow-up): a marker file cannot loosen the blocked paths the untrusted clamp applies"
  - "guardBaselineForLanguage returns the union of every language's extraBlocked in blockedPaths, for every language; allowedCommands stay per-language"
  - "Test: an untrusted JS/TS checkout with a zero-byte Package.swift (and one with go.mod) still has node_modules/** in the clamped guard's blockedPaths; the test fails on the code before the fix"
  - "Test: an untrusted polyglot checkout (go.mod at the root, JS frontend) keeps node_modules/** blocked"
  - "Defaults hench init writes for a project still pass the trust assessment with no new finding (no repository flips to untrusted on upgrade because the baseline grew)"
priority: "high"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
source: "ndx-adversarial-review"
---
