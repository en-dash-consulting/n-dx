---
id: "e45ebbf3-0d40-4bf2-b34d-19c7161c0ea7"
type: "task"
title: "Go resolver lets a go.mod versioned replace beat the go.work replace for the same module"
slug: "go-resolver-lets-a-go-mod-versioned"
description: "Verdict: should-fix (low). packages/sourcevision/src/language/go-resolver.ts buildScope applies versioned replaces from lowest precedence to highest (member go.mod first, go.work last). Each replace's `old.version` is checked against `required.version`, but an earlier replace in the same loop has already overwritten that value. Scenario: api/go.mod has `require x v1.0.0` and `replace x v1.0.0 => x v2.0.0`, and go.work has `replace x v1.0.0 => x v3.0.0`. The member replace sets the version to v2.0.0. The workspace replace then sees old v1.0.0 !== v2.0.0 and is skipped, so external packages from x are attributed v2.0.0. Go uses v3.0.0, because go.work replaces override go.mod replaces. Reachability: needs versioned replaces with an explicit old version in both files. The version is held in memory only and nothing consumes it yet. Fix: compare `old.version` against the originally required version (keep it beside the effective one), or apply the highest-precedence matching replace only. Cost: a few lines and one test."
acceptanceCriteria:
  - "With require x v1.0.0, a go.mod replace x v1.0.0 => x v2.0.0 and a go.work replace x v1.0.0 => x v3.0.0, an import of x is attributed version v3.0.0"
  - "A test covering that case fails on the current code"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "language-packs"
  - "go"
source: "ndx-adversarial-review"
---
