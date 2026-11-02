---
"@n-dx/hench": patch
---

The hench path guard resolves symbolic links before deciding whether a path lies inside the project and before matching blocked patterns, and returns the real path so the file, search and shell tools operate on the location that was checked. A path that does not exist yet is checked at the location its nearest existing ancestor resolves to. A dangling link is followed to its target rather than treated as a missing file, so a committed `notes.md -> ~/Library/LaunchAgents/x.plist` or `x -> .git/hooks/pre-commit` is refused, and `write_file` and `edit_file` open with `O_NOFOLLOW` (an `lstat` refusal on Windows, which has no such flag) so a link that appears after the check is not written through.
