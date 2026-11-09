---
id: "c9d90073-ef5d-455f-b30d-cc2e6efebcfa"
type: "task"
title: "Refuse cmd.exe dynamic variables, modifiers and CR/LF in Windows spawn tokens"
slug: "refuse-cmd-exe-dynamic-variables"
description: "Layer 1 of the CodeQL stack (docs/process/codeql-triage-2026-10.md, Layer 1). CodeQL alerts 43, 44, 68, 69, 70, 71 (js/shell-command-constructed-from-input) and the unguarded sourcevision copy behind 52. The #790 guard assertNoWindowsEnvExpansion is bypassable: cmd.exe dynamic variables (CD, DATE, TIME, RANDOM, ERRORLEVEL, CMDEXTVERSION, CMDCMDLINE, HIGHESTNUMANODENUMBER, the =C: forms) are never in process.env, and the :~n,m and :a=b modifiers make the captured name never match an env key. A model id of the form claude-opus-5%CMDCMDLINE:~-1% followed by an injected command passes the guard, rex's RunModelsSchema and hench's vendor prefix check, and runs on the next ndx work on Windows; the PRD tree is committed repository content. Reproduced with an echo-only proof. Fix both twins (packages/core/win-spawn.js and packages/llm-client/src/exec.ts) identically: strip modifiers before the env lookup, refuse the dynamic-variable names and names starting with =, refuse tokens holding CR or LF, add /v:off to every cmd.exe recipe (win-spawn 147 and 174, exec.ts 610 and 1746, exec-cli.ts 29). Add a sync execFileSyncCli to llm-client and make sourcevision's exec-cli.ts a re-export. Branch fix/windows-cmd-guard-bypass off main; #840 touches the same functions and rebases over it."
acceptanceCriteria:
  - "A token holding %CMDCMDLINE:~-1%, %CD%, %OS:~0,3%, %X:a=b% or a newline is refused by spawnCli, spawnCli's core twin, execFileSyncCli and sourcevision's exec-cli, on every platform via the _platform override"
  - "A path such as C:/100%cool/bin still spawns, as #790 intended"
  - "windows-quoting-parity.test.js pins the guard as well as quoteWindowsToken and buildWindowsCliCommandLine"
  - "Every cmd.exe invocation passes /v:off"
  - "Patch changesets for @n-dx/core, @n-dx/llm-client and @n-dx/sourcevision"
priority: "critical"
source: "codeql-triage"
---
