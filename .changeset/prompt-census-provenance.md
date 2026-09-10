---
"@n-dx/core": patch
---

Stop `prompt-census --write` stamping a commit the measurement did not come from.

The census measures the working tree but stamped `.git/HEAD`, so a recording
made from a dirty tree attributed its numbers to a commit that did not contain
them. That is how the checked-in baseline came to name `3dda8b5b` while
containing `JSON_OBJECT_ONLY`, a constant introduced by `0b57e2eb` — one of its
own descendants. `--compare` then reported "(no surface changed)" across a range
that had demonstrably changed a prompt, and the wrong SHA was published to the
docs site.

Note what would not have caught it: the token counts were right. Only the
attribution was wrong, so no numbers-based check could have noticed.

- `--write` now refuses a dirty tree, naming the reason. `--allow-dirty` records
  anyway and marks the stamp `<sha>-dirty` plus `dirty: true`, so an override
  can never be mistaken for a clean recording. The markdown header says so too.
- Recordings carry a `contentHash` over the measured surfaces and skill bodies —
  provenance that needs no git and cannot disagree with its own contents.
- `tests/e2e/prompt-census.test.js` fails when the repo no longer matches that
  hash, so a stale baseline cannot merge. Deliberately a content check rather
  than commit equality: recording dirties the baseline files, so committing them
  puts HEAD one ahead of the stamp and a SHA assertion would fail after every
  legitimate re-record.
- The dirty check is whole-tree, so an unrelated edit blocks recording. It can
  report dirty when the measurement would have been faithful, but never clean
  when it would not — and a false clean is the bug being fixed.

`scripts/prompt-census.mjs` joins the "Development scripts" entries in the
ALLOWED set of `tests/e2e/architecture-policy.test.js`, since answering "does
the tree match HEAD?" from `.git/` alone would mean reimplementing git's index
and object store, and the mtime shortcut reports clean after a `touch`.

The baseline is re-recorded from a clean tree in the following commit.
