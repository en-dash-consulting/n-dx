---
id: "f256f541-0261-4b26-943b-61f7fe0ce42c"
level: "task"
title: "Fix ANSI strip regex in parseRefreshPhases: missing escape byte"
status: "pending"
priority: "medium"
acceptanceCriteria:
  - "parseRefreshPhases strips full ANSI color sequences including the escape byte"
  - "Phases parse correctly from output produced with FORCE_COLOR set"
description: "parseRefreshPhases (routes-commands.ts:576) strips ANSI with a regex that lacks the leading escape byte (x1b), so stripping cyan('[refresh]') output removes the [36m part but leaves the bare escape character in place — line.startsWith('[refresh]') then fails and phases comes back empty. Latent because color is TTY-gated and execFile gives the child a pipe, but supportsColor() short-circuits to true on FORCE_COLOR (common in dev/CI shells, and the server inherits its env). The no-control-regex eslint suppression above the line indicates the escape byte was there and got dropped. Fix: restore the x1b prefix in the pattern."
---
