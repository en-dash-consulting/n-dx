---
id: "2faf9d58-2878-4e12-a9e3-b613591fd7bd"
type: "change"
title: "Build shared ANSI color formatting utility with TTY and NO_COLOR support"
slug: "build-shared-ansi-color-formatting"
intent: "Create a shared color formatting module in the llm-client or core package that defines a semantic palette (success/completed, pending/in-progress, error/failure, warning, info/dim) and exposes lightweight helpers. The module must check process.stdout.isTTY and respect the NO_COLOR and FORCE_COLOR environment variables so that piped output, CI logs, and --json/--quiet modes receive plain text. This utility becomes the single color source-of-truth consumed by all packages."
acceptanceCriteria:
  - "Module exposes named semantic color helpers (e.g. colorSuccess, colorError, colorPending, colorDim) rather than raw ANSI codes"
  - "Colors are disabled when process.stdout.isTTY is false"
  - "Colors are disabled when NO_COLOR env var is set (any non-empty value)"
  - "Colors are forced on when FORCE_COLOR env var is set"
  - "Module has unit tests covering TTY=false, NO_COLOR, FORCE_COLOR, and default TTY=true branches"
  - "Module is exported through the appropriate package public API or gateway"
touches:
  - "c513f257-7f0b-4bce-9bf5-82f5cc909ef0"
priority: "high"
tags:
  - "cli"
  - "color"
  - "shared"
source: "smart-add"
---
