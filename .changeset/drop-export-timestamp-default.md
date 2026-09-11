---
"@n-dx/rex": patch
---

Stop a bundle's unvalidated `exportedAt` becoming an item's `lastModified`.

`parseBundle` checks only that `exportedAt` is a string, and the import path
then wrote it straight onto any item that arrived with an author but no
timestamp. So a bundle declaring `"exportedAt": "yesterday"` put that literal on
disk. `isModifiedSinceSync` compares timestamps as strings, and `"yesterday"`
sorts above every ISO stamp, so such an item read as dirty on every sync forever
and won last-write-wins against every genuine remote edit. A future-dated ISO
value did the same without looking malformed.

The default is removed rather than validated. It had become redundant: the store
transaction already fills a missing timestamp and preserves the original author,
so the item still lands sync-visible and correctly attributed. It also ran
first, so the unvalidated value won over the checked one.

The argument for keeping it — that `exportedAt` says the content is *at least*
that old, which is more honest than "when it landed here" — is real but does not
survive who it applies to. rex writes both stamp halves together, so the only
items reaching that path come from hand-authored or third-party bundles: the
same untrusted source as the `exportedAt` being trusted to describe them.

Filling a missing timestamp is now the store transaction's job and only its job.
`exportedAt` remains bundle provenance, reported and logged, and no longer
reaches any stored field.
