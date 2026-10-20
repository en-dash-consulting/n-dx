---
id: "8e1faf49-0242-4dd5-8515-36d7230ffa4a"
level: "task"
title: "Make uv workspace member globs safe to compile and linear to match"
status: "completed"
priority: "high"
tags:
  - "review-fixes"
  - "security"
  - "lang-kit"
  - "pr-20"
source: "review"
startedAt: "2026-10-17T09:28:23.423Z"
completedAt: "2026-10-17T09:33:18.957Z"
endedAt: "2026-10-17T09:33:18.957Z"
resolutionType: "code-change"
resolutionDetail: "uv member globs compiled once by a RegExp-free segment matcher (src/dir-glob.ts); invalid class -> notice; O(pattern x path) matching"
acceptanceCriteria:
  - "An invalid member glob yields a notice, never a throw, and the Python pack is not degraded"
  - "Glob matching is linear (no catastrophic backtracking); pathological patterns return promptly"
  - "Existing uv workspace fixtures unchanged"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"The hench sandbox may block ~/.cache corpora; leave corpus checks to the session and do not capture follow-ups for them."}
description: "Stack review (#793, packages/lang-kit/src/python-build.ts around line 220, globRegExp around 545). [tool.uv.workspace] member globs are turned into a RegExp:\n- **Throw.** A `[…]` class is copied verbatim into new RegExp, so `members = [\"pkgs/[z-a]\"]` throws `SyntaxError: Range out of order`. readPyproject catches only TomlSyntaxError, so forProject throws and the runtime degrades the whole Python pack (\"build files could not be read\"). The module doc says nothing throws on file content.\n- **Backtracking.** `**` becomes `.*`, so a member like `**a**a**a…c` tested against repository directory paths backtracks badly. A 10-segment pattern against a 50-character path didn't finish in 20 s.\n\nNothing consumes workspaceMembers yet, but it is computed on every pack run, and the pattern is compiled once per directory.\n\nFix:\n- compile each glob once, inside try/catch, with a failure becoming a notice;\n- validate or escape class contents;\n- collapse consecutive `**`, or match segment by segment without regex backtracking.\n\nTests: a bad class gives a notice and no throw; the pathological glob returns promptly; existing uv workspace fixtures are unchanged."
lastModified: "2026-10-17T09:33:19.272Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
