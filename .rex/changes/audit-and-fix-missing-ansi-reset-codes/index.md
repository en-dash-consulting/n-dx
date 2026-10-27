---
id: "5f17b7af-ba00-43a6-8c6c-dcd5c8bf1d00"
type: "change"
title: "Audit and fix missing ANSI reset codes in tool and CLI output lines"
slug: "audit-and-fix-missing-ansi-reset-codes"
intent: "Identify all call sites in the CLI output pipeline where blue (and other) ANSI color codes are applied without a trailing reset sequence. The primary symptom is that text after a colored tool-output line inherits the blue color. Fix each site to ensure every colorized string ends with the ANSI reset code (`\\x1b[0m`), including multi-line and wrapped tool output. Cover rex, hench, sourcevision, and the ndx orchestrator."
acceptanceCriteria:
  - "No terminal line colored blue (or any other ANSI color) bleeds color onto the next output line"
  - "All colorized output strings end with the ANSI reset sequence"
  - "Color formatting utility enforces reset-on-close so callers cannot emit a color without a paired reset"
  - "Verified across rex, hench, sourcevision, and ndx orchestrator output paths"
touches:
  - "eb21a965-6d17-4ee7-b6bd-0f1e6d07ff33"
priority: "high"
tags:
  - "cli"
  - "ansi"
  - "color"
  - "bug"
source: "smart-add"
---
