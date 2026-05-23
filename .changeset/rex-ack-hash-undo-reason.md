---
"rex": minor
---

Make `rex recommend` acknowledgement workflow address-by-hash. Each finding
now prints with a stable 6-char hash prefix (`[a3f5d8]`) and
`--acknowledge=<hash|index>,…` accepts either. Hashes are recommended because
indices renumber after every ack — a planned `--acknowledge=1,5,9` no longer
goes wrong when the first ack shifts the list.

Adds `--unacknowledge=<hash|index>,…` to undo prior acknowledgements
(previously required hand-editing `.rex/acknowledged-findings.json`) and
`--reason=<category>` to capture *why* — canonical categories are
`tool-artifact`, `already-done`, `doesnt-apply`, `over-engineered`,
`speculative`, and free-form values are also accepted. The recorded reason
will later let the analyzer mine repeated junk and improve its prompts.
