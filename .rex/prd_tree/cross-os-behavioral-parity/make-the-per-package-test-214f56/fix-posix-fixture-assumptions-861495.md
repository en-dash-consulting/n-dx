---
id: "861495a7-09ad-4848-ab88-21f33e1770ae"
level: "task"
title: "Fix POSIX fixture assumptions in hench and web tests (/tmp, git quoting, absolute-path check)"
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
  - "Both hench git.test.ts sites and web's routes-sourcevision.test.ts:202 invoke git with argv rather than a quoted command string"
  - "A grep for `-m '` across hench and web finds no remaining POSIX-quoted git fixtures"
  - "test-runner.test.ts's runPostTaskTests cases use a real temp directory and a shell-quoting-free command"
  - "All six named failures pass on Windows"
  - "The same tests still pass on POSIX — no assertion became platform-conditional unnecessarily"
  - "No assertion was weakened to a looser match to achieve green"
description: "Six failures across two packages, three causes, all one-or-two-line fixture corrections. Do these first — smallest and lowest-risk of the triage groups.\n\nA. POSIX absolute-path assumption — 1 failure (hench).\n   tests/unit/store/run-log.test.ts:63\n     expect(logPath.startsWith(\"/\")).toBe(true)\n   An absolute Windows path starts with a drive letter, so this can never hold there. Use\n   path.isAbsolute(logPath). The following `access(logPath)` assertion already proves the path is\n   usable, so this line is purely about absoluteness.\n\nB. POSIX shell quoting in git fixtures — 3 failures (2 hench, 1 web).\n   hench tests/unit/tools/git.test.ts:75 and :180\n   web   tests/unit/server/routes-sourcevision.test.ts:202\n     execSync(\"git commit -m 'feature change'\", { cwd: ... })\n   REPRODUCED standalone on Windows: `error: pathspec 'commit'' did not match any file(s) known to\n   git`. cmd.exe does not strip single quotes, so git reads -m as \"'test\" and treats the second word as\n   a pathspec. Pass argv instead of a command string — execFileSync(\"git\", [\"commit\",\"-m\",\"test commit\"])\n   — which is also what the spawn-hardening epic established as the house style.\n   NOTE in hench's file: lines 44-45 set user.email/user.name the same single-quoted way. That stores\n   literal quotes in the config but still commits, so it is NOT a contributing cause of those two\n   failures — fix it in passing for correctness, not because it is breaking anything.\n   The web site (routes-sourcevision) is the same one-line change; grep for `-m '` across both packages\n   in case there are further instances that have not surfaced yet.\n\nC. POSIX-only fixtures in runPostTaskTests — 2 failures (hench).\n   tests/unit/tools/test-runner.test.ts:391-404 and :418-428\n     projectDir: \"/tmp\", testCommand: \"echo 'all tests passed'\"\n   MEASURED: path.resolve(\"/tmp\") is \"C:\tmp\" on Windows and existsSync(\"C:\tmp\") is false, so the\n   spawn fails on a nonexistent cwd — which is why the assertion sees an empty string rather than the\n   echoed text. Use os.tmpdir() (or a mkdtemp fixture) for projectDir. The single-quoted echo is also\n   POSIX-only; cmd.exe would emit the quotes literally, so prefer a command with no shell quoting at\n   all (e.g. `echo all tests passed`) and adjust the expected substring if needed.\n\nSibling tests in the same describe blocks already pass — e.g. \"reports failure when test command exits\nnon-zero\" uses `sh -c 'exit 1'` and works because Git for Windows provides sh — so only the cases named\nabove need touching. Do not convert whole files to a different style."
---
