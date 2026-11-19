---
"@n-dx/lang-runtime": patch
---

`ndx analyze` keeps a language pack's other facts when its import resolver fails, and names the failure instead of asking you to reinstall the pack.

A resolver whose preparation throws now loses only the imports (and the references frameworks would follow through it), reported as a notice carrying the error. Before, the whole pack was reported as broken with a reinstall remedy that could not help.
