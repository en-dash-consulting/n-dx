---
id: "f256f541-0261-4b26-943b-61f7fe0ce42c"
type: "task"
title: "Fix ANSI strip regex in parseRefreshPhases: missing escape byte"
slug: "fix-ansi-strip-regex-in"
description: "RESOLVED AS FALSE POSITIVE. The regex in parseRefreshPhases contained a RAW ESC byte (0x1b) in the source, invisible in normal file views — both the original review and the capture-time verification misread it as missing the escape prefix. Hexdump confirmed byte 1b before \\[[0-9;]*m, and an ANSI-colored-output regression test passed against the unmodified code. Hardening applied instead of a fix: the raw byte is rewritten as the explicit \\x1b escape sequence (functional no-op) with a comment explaining the misreading hazard, and the ANSI regression test is kept."
acceptanceCriteria:
  - "parseRefreshPhases strips full ANSI color sequences including the escape byte"
  - "Phases parse correctly from output produced with FORCE_COLOR set"
priority: "medium"
---
