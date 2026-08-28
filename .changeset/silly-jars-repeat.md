---
"@n-dx/rex": patch
---

Point the "Rex directory not found" error at the real cause when rex is running as the git merge driver. Git passes the merge driver three temp-file paths (`.merge_file_XXXXXX`), so a rex that predates the merge-driver directory-check exemption reports a missing `.rex/` for git's scratch file and advises `n-dx init` — true, and useless. That path now says rex is out of date and to rebuild or update it, which is the actual fix for both a stale local `dist/` and a stale global install.
