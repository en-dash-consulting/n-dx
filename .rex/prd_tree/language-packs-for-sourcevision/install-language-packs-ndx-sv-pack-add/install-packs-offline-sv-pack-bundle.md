---
id: "ac7a26e1-0f28-4e63-b481-4fa0fbf094e0"
level: "task"
title: "Install packs offline: `sv pack bundle` and `sv pack add --from <bundle>`"
status: "completed"
priority: "high"
tags:
  - "language-packs"
  - "sourcevision"
  - "cli"
  - "offline"
  - "pr-12b"
blockedBy:
  - "224898e7-8081-4e71-86c4-b922cd1b371a"
source: "roadmap"
startedAt: "2026-10-15T04:49:24.445Z"
completedAt: "2026-10-15T05:00:11.223Z"
endedAt: "2026-10-15T05:00:11.223Z"
resolutionType: "code-change"
resolutionDetail: "sv pack bundle and sv pack add --from with a Node-only tar archive; tests with an injected npm; docs and help updated (aa1a348b1)"
acceptanceCriteria:
  - "`sv pack bundle java --out <file>` writes one archive holding the installed pack, its dependencies and a manifest (tests with an injected npm runner)"
  - "`sv pack add java --from <file>` installs into the pack dir with no npm call, and the pack loads"
  - "A bundle for another pack, another version, or a corrupt archive is refused with a message naming the problem"
  - "Every new spawn is in the shell-spawn inventory and shell-spawn-inventory-policy passes"
  - "No package.json dependency changes"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "Client machines often have no registry access (LS16 and decision 7's \"offline tarballs\"). A pack's own npm tarball is not enough offline: @n-dx/lang-java depends on @n-dx/lang-kit, @n-dx/lang-runtime and web-tree-sitter. So the offline unit is a bundle of a complete installed pack.\n\n- `sv pack bundle <lang> [--out <file>]` (on a connected machine): installs `@n-dx/lang-<lang>@<sourcevision version>` into a fresh temporary prefix with the same npm runner `pack add` uses, writes a small manifest into the prefix (pack id, package name, version, the sourcevision version it was made for, the platform-independent nature of the contents: grammars are WASM), and archives the prefix as one .tgz (default name `n-dx-lang-<lang>-<version>.tgz` in the current directory). Reuse `pack add`'s code; the temporary prefix is removed afterwards.\n- `sv pack add <lang> --from <bundle>`: no network. Reads the manifest first and refuses a bundle for another pack or another version (naming both), then extracts into the pack dir (replacing an existing install of that pack), then loads the pack through pack-loader.ts as `pack add` does.\n- Archive with the system `tar` through @n-dx/llm-client's spawn helpers (bsdtar is present on macOS, Linux and Windows 10+), registered in the shell-spawn inventory, or with a Node-only implementation if that is simpler without a new dependency; no package.json dependency changes either way. Paths with spaces must work.\n- Tests: inject the npm runner; build a bundle from a fake installed prefix, install it into a temp ndx home, check refusal of a wrong id/version and of a corrupt archive; no network.\n- packages/sourcevision/AGENTS.md and `sv pack --help` describe the offline flow.\n\nNo package.json dependency changes. Do not touch rex, hench, core or web source."
lastModified: "2026-10-15T05:00:11.518Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
