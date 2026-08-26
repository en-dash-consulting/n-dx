---
"@n-dx/hench": patch
---

`hench record --no-tokens` now burns the suppressed spend instead of deferring it to the next record.

The `--no-tokens` branch returned before the transcript was read, so the session watermark never advanced: in one session, `record --task=A --no-tokens` followed by a normal `record --task=B` silently rolled A's entire spend into B's record and B's PRD-item rollup. The flag's plain reading — and the existing precedent of the explicit `--*-tokens` path, which advances the watermark because "that spend is now accounted for" — is that suppressed spend is attributed to nothing.

Now the transcript is still read under `--no-tokens` and the watermark advances past the suppressed messages; the record keeps its zeros and its note says how many messages were discarded. A transcript problem never fails a `--no-tokens` record (the caller asked for no usage at all), and `hench record --help` states the discard semantics.
