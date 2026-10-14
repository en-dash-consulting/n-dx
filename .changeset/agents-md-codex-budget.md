---
"@n-dx/core": patch
---

Shrink the generated `AGENTS.md` so Codex reads all of it

Codex concatenates `AGENTS.md` from the repository root down to the working
directory and stops at `project_doc_max_bytes`, dropping the rest with no
error. The root file had grown to 27 KB of a ~32 KiB budget, so a session
under a package with its own `AGENTS.md` lost most of that package's
guidance.

The shared guidance now keeps the rules and sends the reasoning to
`docs/architecture/`: the spawn-versus-gateway signal table and the
command-pair concurrency table (both already in the architecture overview),
the PRD lock's enforcement detail and the two export carve-outs (already in
the PRD write-concurrency page), and the derived-file rows of Key Files,
which move to a new `docs/architecture/generated-files.md`. Nothing is
dropped — each cut leaves the rule in place and links to the fuller text.
