---
id: "2839d1f0-e35c-4266-8b7e-a4eb32c2f358"
type: "task"
title: "List every live toggle and web.sidecarGithubReads in ndx config help, held by a test"
slug: "list-every-live-toggle-and-web"
description: "Rewrite the `features.*` block of `ndx config --help` in packages/core/config.js from FEATURE_REGISTRY's keys, defaults and one-line descriptions, and add web.sidecarGithubReads to the web settings. config.js cannot import the web package, so add a policy test under tests/e2e that reads both and fails when a registry key is missing from the help."
acceptanceCriteria:
  - "Every key in FEATURE_REGISTRY appears in `ndx config --help` with its default"
  - "web.sidecarGithubReads appears in the help with its default"
  - "The new test fails when a registry key is added without a help line"
priority: "medium"
tags:
  - "feature-flags"
  - "core"
source: "ndx-capture"
---
