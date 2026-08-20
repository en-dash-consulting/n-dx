---
"@n-dx/core": patch
---

Actually restrict API-key file permissions on Windows, instead of only claiming to.

`config.js` called `chmod(path, 0o600)` after writing `.n-dx.json` whenever it held a provider API key, and `ndx config --help` stated "File permissions set to 0600 (owner-only) for security" unconditionally. On Windows both were false. Measured on Windows 11:

```
after chmod(path, 0o600):
  mode reads back as 0666        (not 0600)
  icacls:  SYSTEM:(I)(F)  BUILTIN\Administrators:(I)(F)  <user>:(I)(F)
```

Every entry is `(I)` — inherited. `fs.chmod` cannot express a POSIX mode on Windows; it maps only the read-only attribute and never touches the DACL. So the API key stayed readable by SYSTEM and every administrator while the help text promised owner-only, and the two tests that would have caught it were `it.skipIf(win32)`.

A new `file-permissions.js` module now **attempts and then verifies** the restriction, reporting what it actually achieved:

- **POSIX** — `chmod` to 0600, then confirm via `stat` that the mode landed (FAT/exFAT mounts and some network shares silently drop mode changes).
- **Windows** — `icacls <path> /inheritance:r /grant:r <DOMAIN\user>:F` through `win-spawn.js`, then read the DACL back and require no inherited `(I)` entries and no principal other than the current user. The exit code is not trusted: icacls reports "Successfully processed 1 files" in cases where the resulting ACL is not what was requested.

When verification fails, the user is warned at the point of writing — naming the file, the cause, and the safer alternative (`ANTHROPIC_API_KEY`, or Credential Manager on Windows). A false assurance about an API key is worse than a stated limitation. The help text now describes what the running platform actually does.

Verified end-to-end: a real `ndx config claude.api_key` on Windows now produces a file whose ACL is exactly `<user>:(F)`.

Also resolves the related `cli_path` executable check. `access(value, X_OK)` **succeeds for a plain JSON file** on Windows — Node documents X_OK as having no effect there, so it degrades to `F_OK` and the check could never reject anything, while advising "Run: chmod +x". It is now explicitly skipped on Windows via `executableBitIsMeaningful()` with the reasoning recorded. Requiring a PATHEXT extension instead was rejected: it would refuse the extensionless POSIX scripts that pnpm/npm global installs place beside their `.CMD` shims, and a validation that rejects valid input is worse than none — spawn-time diagnostics already cover the rest.

All four Windows skips in `tests/e2e/cli-config.test.js` are gone (143 passing, 0 skipped): the permission assertions now check mode on POSIX and the DACL on Windows, and the executable-bit case asserts the documented Windows behaviour rather than being silently skipped.
