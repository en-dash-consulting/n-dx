---
id: "861495a7-09ad-4848-ab88-21f33e1770ae"
level: "task"
title: "Fix the trivial POSIX fixture assumptions in hench tests (/tmp, git quoting, absolute-path check)"
status: "pending"
priority: "high"
tags:
  - "cross-os"
  - "windows"
  - "testing"
  - "hench"
  - "quick-win"
source: "exploration-2026-08-17"
acceptanceCriteria:
  - "run-log.test.ts uses path.isAbsolute rather than a leading-slash check"
  - "git.test.ts invokes git with argv rather than a quoted command string, and both previously-failing cases pass on Windows"
  - "test-runner.test.ts's runPostTaskTests cases use a real temp directory and a shell-quoting-free command"
  - "All five named failures pass on Windows"
  - "The same tests still pass on POSIX — no assertion became platform-conditional unnecessarily"
  - "No assertion was weakened to a looser match to achieve green"
description: "Five failures, three causes, all one-or-two-line fixture corrections. Do these first — smallest and lowest-risk of the triage groups.\n\nA. POSIX absolute-path assumption — 1 failure.\n   tests/unit/store/run-log.test.ts:63\n     expect(logPath.startsWith(\"/\")).toBe(true)\n   An absolute Windows path starts with a drive letter, so this can never hold there. Use\n   path.isAbsolute(logPath). The following `access(logPath)` assertion already proves the path is\n   usable, so this line is purely about absoluteness.\n\nB. POSIX shell quoting in git fixtures — 2 failures.\n   tests/unit/tools/git.test.ts:75 and :180\n     execSync(\"git commit -m 'test commit'\", { cwd: projectDir })\n   REPRODUCED standalone on Windows: `error: pathspec 'commit'' did not match any file(s) known to\n   git`. cmd.exe does not strip single quotes, so git reads -m as \"'test\" and treats \"commit'\" as a\n   pathspec. Pass argv instead of a command string — execFileSync(\"git\", [\"commit\",\"-m\",\"test commit\"])\n   — which is also what the spawn-hardening epic established as the house style.\n   NOTE while in this file: lines 44-45 set user.email/user.name the same single-quoted way. That\n   stores literal quotes in the config but still commits, so it is NOT a contributing cause of these\n   two failures — fix it in passing for correctness, not because it is breaking anything.\n\nC. POSIX-only fixtures in runPostTaskTests — 2 failures.\n   tests/unit/tools/test-runner.test.ts:391-404 and :418-428\n     projectDir: \"/tmp\", testCommand: \"echo 'all tests passed'\"\n   MEASURED: path.resolve(\"/tmp\") is \"C:\tmp\" on Windows and existsSync(\"C:\tmp\") is false, so the\n   spawn fails on a nonexistent cwd — which is why the assertion sees an empty string rather than the\n   echoed text. Use os.tmpdir() (or a mkdtemp fixture) for projectDir. The single-quoted echo is also\n   POSIX-only; cmd.exe would emit the quotes literally, so prefer a command with no shell quoting at\n   all (e.g. `echo all tests passed`) and adjust the expected substring if needed.\n\nSibling tests in the same describe blocks already pass — e.g. \"reports failure when test command exits\nnon-zero\" uses `sh -c 'exit 1'` and works because Git for Windows provides sh — so only the cases named\nabove need touching. Do not convert the whole file to a different style."
---
