---
id: "01d91dd7-523a-4e49-ad76-f442e6484002"
level: "task"
title: "Enforce API-key file permissions on Windows via ACLs, or stop claiming they are set"
status: "pending"
priority: "high"
tags:
  - "cross-os"
  - "windows"
  - "security"
  - "core"
  - "config"
source: "exploration-2026-08-17"
acceptanceCriteria:
  - "On Windows, either the API-key file's ACL is restricted to the current user, or the user is explicitly warned at storage time that it is not"
  - "`ndx config --help` no longer asserts 0600 permissions on platforms where they are not applied"
  - "If icacls is used it is invoked through win-spawn.js and the resulting ACL is verified, not inferred from exit code"
  - "The two Windows-skipped permission tests are enabled with platform-appropriate assertions"
  - "The cli_path executable-bit check has a documented Windows decision (skipped-by-design with a stated reason, or a PATHEXT-based equivalent)"
description: "packages/core/config.js:106-117 `saveProjectJSON` calls `await chmod(path, 0o600)` whenever .n-dx.json contains an API key (claude/codex/google). On Windows, Node's fs.chmod cannot express POSIX modes — it only toggles the read-only attribute — so the file retains inherited NTFS ACLs and stays readable by other users of the machine and by any process running as them.\n\nThe claim is made anyway: `ndx config --help` (config.js:1203) prints \"File permissions set to 0600 (owner-only) for security\" unconditionally, and config.js:1195-1202 presents storing the key in .n-dx.json as an acceptable practice partly on that basis. A user on Windows reading that help text is misinformed about the protection they have. The two tests that would catch it (tests/e2e/cli-config.test.js:936 \"sets .n-dx.json to 0600 when api_key is present\", :955 \"restricts permissions when api_key is added to existing config\") are both `it.skipIf(win32)`.\n\nTWO acceptable resolutions, in preference order:\n1. Implement the Windows equivalent — restrict the file's DACL to the current user, e.g. `icacls <path> /inheritance:r /grant:r \"%USERNAME%\":F`, routed through packages/core/win-spawn.js (never a hand-built command string; the path may contain spaces or metacharacters). Verify the resulting ACL rather than trusting the exit code.\n2. If ACL manipulation is judged too fragile to own, make the limitation explicit: platform-condition the help text, and warn at the point the key is stored on Windows that file permissions are NOT restricted and an environment variable or credential manager is preferable.\n\nDo NOT leave the current state, where the code appears to secure the file and the docs assert that it does.\n\nNote the related surface: config.js:362 and :401 reject a cli_path that is not executable via a POSIX mode check, and that test (cli-config.test.js:712) is likewise Windows-skipped — the executable-bit concept has no NTFS analog. Decide whether that validation is skipped-by-design on Windows (and say so in the error path) or should use a different signal such as PATHEXT membership."
---
