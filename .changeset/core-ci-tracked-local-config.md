---
"@n-dx/core": patch
---

`ndx ci` now fails its config-secrets step when git is tracking `.n-dx.local.json`. That file holds every API key `ndx config` writes, and nothing protects it but the `.gitignore` entry — so trimming that line, negating it, or one `git add -f` put every vendor key on the remote while the step reported "no API keys in .n-dx.json" and passed. A tracked local file now fails on the fact of being tracked, whatever it holds, and the detail says to `git rm --cached` it, restore the ignore line and rotate any key it held. The step also no longer prints a tick above a failing run.
