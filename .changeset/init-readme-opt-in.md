---
"@n-dx/core": patch
---

`ndx init` no longer writes a README; pass `--readme` to generate `README.md` (or `README.proposed.md` beside an existing README).

Action needed: add `--readme` to `ndx init` if you relied on it generating a README.

Without the flag, init writes neither file, its summary says nothing about a README, and its commit never includes a README the project already had. When it does generate one, the License section names the manifest's `license`, links a `LICENSE`, `LICENSE.md`, `LICENSE.txt` or `COPYING` file only when one exists, and is left out when there is neither, instead of saying "See LICENSE." regardless.
