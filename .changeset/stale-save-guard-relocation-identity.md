---
"@n-dx/rex": patch
---

Stale-save guard: a relocation cleanup must match the file's load-time identity

The guard's relocation exemption admitted any newer deletion candidate whose item id
appeared in the document being saved. That covered same-writer leaf-to-folder promotion,
but also let a stale mover delete a source file another writer had edited since the
snapshot loaded — the stale copy landed at the destination and the edit was lost with no
error. `parseFolderTree` now records a content digest per item file, `serializeFolderTree`
accepts it as `loadedFiles` and requires the source file to still match before allowing
the relocation, and returns fresh digests after each save so a same-writer follow-up save
needs no reload. Both stores carry the map between load and save.
