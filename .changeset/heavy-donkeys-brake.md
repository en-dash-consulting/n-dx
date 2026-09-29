---
"@n-dx/rex": patch
---

Stop the stale-save guard from refusing a save that would repair a corrupt item file.

The guard compares each deletion candidate's `mtimeMs` against a `Date.now()` load stamp, and those are two different clocks — the filesystem clock was measured running up to ~4ms ahead of `Date.now()` on Windows, past the guard's 2ms tolerance. A file written just *before* a load could therefore read as newer than it.

For a file with no parseable `id` — a corrupt or truncated one — the check ended there and reported it as another writer's work, so the save that would have rewritten it was refused. The corruption became permanent: every subsequent save failed the same way.

The content-digest check that already existed now runs first. If a file still digests to exactly what the snapshot loaded from that path, the snapshot has seen its current contents and deleting it destroys nothing unseen, whatever its mtime says. Files the snapshot never read keep the guard's full mtime-based protection.
