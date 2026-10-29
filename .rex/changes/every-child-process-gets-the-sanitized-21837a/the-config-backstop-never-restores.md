---
id: "cd3930fb-0d47-4414-8327-c7f2a7dd2eee"
type: "task"
title: "The config backstop never restores through a swapped parent, and catches a layout switch"
slug: "the-config-backstop-never-restores"
description: "Second short adversarial re-review of #816 + #817 (the 20 fix commits since abf90b308; two parallel passes, trust/config and child-env/spawn/backstop; fix/security-child-env at 9b60c492e), 2026-10-28, child-env pass findings 1 (high) and 2 (medium), both probed, plus its robustness note. All three are introduced by bfb205e4's ConfigBackstop (packages/hench/src/guard/config-backstop.ts).\n\n1. Restore follows a swapped parent symlink out of the project. During a run, the agent replaces .claude/ (or .codex/, .ndx/) with a symlink to a directory outside the project, such as ~/.claude or ~/.codex. It can do this from codex's workspace-write sandbox or with an allowed `node -e`. readEntry and putBack resolve through the link, and the backstop runs unsandboxed in hench. So restore() deletes the outside file and writes the repository's snapshot content there, deletes an outside file that was absent at snapshot time, and reports restored: true. Probed: with a fake home, its settings.json and config.toml received the repository's content and its settings.local.json was deleted. The real-world effect is that the user's global Claude settings, with the hooks and permissions in them, are replaced by the repository's, and user files are deleted. That is a sandbox escape that looks like a successful restore.\n2. Creating .ndx/ switches the layout and the backstop ignores it. `mkdir -p .ndx/hench` (or just `.ndx/.keep`) changes no protected file, so restore() returns []. But detectLayoutMode now reports `ndx` (packages/llm-client/src/layout.ts). Every later n-dx command then stops reading the user's .n-dx.local.json (their deny entries, claudePath, apiKeyEnv) and .n-dx.json, and reads agent-planted state under .ndx/. Probed: resolveLayout reported mode ndx afterwards.\n3. ConfigBackstop.capture runs outside run.ts's try (~line 1489) and throws on a protected parent that is a symlink loop or unreadable, so a repository can crash every `ndx work` at start.\n\nFix: at snapshot time, record each protected parent directory's identity (lstat kind, plus realpath under projectDir) and the layout mode, including .ndx/'s existence and kind. On restore, never follow a link out of projectDir. If a parent is no longer the same real directory, remove the swapped-in link and recreate the directory without following it, then restore into it. Never rmSync or write through a resolved path outside projectDir. If the layout mode changed (.ndx/ appeared on a legacy project, or vanished on an ndx one), restore it when that is safe (remove a .ndx/ the agent created), otherwise fail the run naming it. capture must fail closed with a clear message rather than crash."
acceptanceCriteria:
  - "A protected parent (.claude, .codex, .ndx) swapped for a symlink to a directory outside the project is never written or deleted through; the outside directory is left exactly as it was, and the run reports the swap"
  - "A .ndx/ directory created during a run on a legacy-layout project is removed (or the run fails naming it), so the next command reads the same layout and config as before the run"
  - "A symlink loop or unreadable protected parent does not crash `ndx work`; it fails the run start with a clear message"
  - "Test: each case above, with an outside directory standing in for the user's home; the tests fail on the code before the fix"
priority: "high"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
