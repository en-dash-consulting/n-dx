---
id: "21973e6f-ab9b-44b9-aa49-cb6daa659948"
type: "change"
title: "listWorktrees returns no entry for a bare repository when the host's GIT_CONFIG_PARAMETERS sets safe.bareRepository=explicit"
slug: "listworktrees-returns-no-entry-for-a"
intent: "packages/llm-client/tests/integration/git-worktree-helpers.test.ts (~166), \"a bare repository is a single bare entry\": after `git init --quiet --bare` it expects listWorktrees(bare) to return one entry {path, branch: null, head: null, isMain: true, detached: false, bare: true}. It returned [] on Ryan's Mac (Darwin 23, git 2.43.2) whenever the suite ran inside an ndx work run (PR 3's review, run f7cdcaab), while GitHub's macOS jobs pass it.\n\nCause (diagnosed 2026-11-09): the Claude desktop app's Terminal panel exports GIT_CONFIG_PARAMETERS='safe.bareRepository=explicit' 'core.fsmonitor=' into every shell it opens. ndx work is launched from that panel, so the variable reaches hench, the spawned claude, its Bash tool, vitest and finally git. With safe.bareRepository=explicit git refuses to discover a bare repository from cwd (\"fatal: cannot use bare repository … (safe.bareRepository is 'explicit')\", exit 128), and listWorktrees reads a non-zero exit as \"not a repository\" and returns []. Only the bare test fails because `git init --bare` does no discovery and every other test uses a non-bare repository. GitHub runners never set the variable. Ruled out: /var vs /private/var realpaths (passes), GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/GIT_COMMON_DIR (they break the whole file, not this one test).\n\nlistWorktrees is right to honour the host's policy: overriding safe.bareRepository would defeat the protection it exists for. The fix is test hermeticity. tests/setup-session-env.js already hides ambient agent-run state so a gate run behaves as CI does, and already replaces GIT_CONFIG_GLOBAL; it should also drop command-line-scope git config inherited from the host.\n\nDuplicates cf903bc9 on #1008's branch (feat/codex-sidecar-broker), which will be closed as a duplicate when that stack lands."
acceptanceCriteria:
  - "The bare-repo listWorktrees test passes on Ryan's Mac, including in the Terminal panel environment that broke it, without its expectation changing"
touches:
  - "3bc1cab2-ebb4-4f6a-8d4f-a19e3fb22a09"
priority: "medium"
source: "ndx-capture"
---
