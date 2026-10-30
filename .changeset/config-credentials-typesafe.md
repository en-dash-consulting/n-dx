---
"@n-dx/core": patch
---

`ndx config credentials` shows the per-user credential store (backend, source
in effect, fingerprint; never a value), and `ndx config credentials.typesafe`
stores the Jev key from a hidden prompt, `--stdin`, or argv (with a warning),
and `--unset` removes it. Other `credentials.<name>` are refused; vendor keys
come later.
