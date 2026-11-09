---
id: "86b6f51a-6a97-4c60-803c-87eb1f8e3dcf"
type: "task"
title: "Config path guards in core and hench, and complete escaping in shellWord and ci"
slug: "config-path-guards-in-core-and-hench"
description: "Layer 6 of the CodeQL stack (docs/process/codeql-triage-2026-10.md, Layer 6). CodeQL alerts 61, 62, 55 (prototype pollution in packages/core/config.js setByPath), 56 (hench cli/commands/config.ts setConfigValue), 33 and 32 (js/incomplete-sanitization). ndx config set llm.__proto__.polluted x assigns on Object.prototype in the operator's own CLI process; not persisted and web never spawns config set, so defensive. Throw from splitSettingPath on __proto__, constructor or prototype (core imports nothing, inline the three-name set) and the same in hench's setConfigValue as CLIError. shellWord in run-resolve.ts does not apply MSVC quoting on win32, so the printed ndx work command for a path ending in a backslash is wrong: double backslashes before a quote and at the end. ci.js line 1328 escapes only dots when building a regex from the layout's data-directory constants: use the file's own escapeRegExp. Optionally fold in the verified behaviour-identical one-liners for the dismissable alerts 1, 2, 3 and 5 (file-permissions.js, mcp-shim.js, web.js and its twin in web/src/hub/new-project.ts). #817 and #819 touch config.js and ci.js in other functions. Branch fix/core-hench-config-path-guards."
acceptanceCriteria:
  - "ndx config set with a __proto__, constructor or prototype segment exits non-zero naming the key and leaves .n-dx.json byte-identical"
  - "hench's setConfigValue throws for the same three segments and the target object gains no property"
  - "shellWord on win32 renders a quoted word ending in a backslash and a word with an embedded escaped quote the way the MSVC argv parser reads them, and the existing cases are unchanged"
  - "Patch changesets for @n-dx/core and @n-dx/hench"
priority: "medium"
source: "codeql-triage"
---
