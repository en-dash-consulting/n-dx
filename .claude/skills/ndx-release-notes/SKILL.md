---
name: ndx-release-notes
description: Write n-dx changeset files so they produce user-readable changelogs, and turn a released version's CHANGELOG sections into a short public summary for end users of @n-dx/core. Use whenever adding or editing a file under .changeset/, running `pnpm changeset`, finishing a PR that needs a changeset, or when asked for release notes, a release summary, an announcement, "what changed in <version>", or a public changeset list.
---

# n-dx changesets and public release summaries

Two jobs share one set of rules:

1. **Writing a changeset** (every PR that needs one).
2. **Summarizing a release** for the public, from the `CHANGELOG.md` sections that
   the changesets produced.

The audience for the public summary is **end users of `@n-dx/core`**. These are people
who run `ndx`, its dashboard and its agents. Integrators who call TypeScript
exports, MCP tool schemas or HTTP routes are not the audience. Those readers already
have the full per-package `CHANGELOG.md` and GitHub releases.

The summary exists because a raw release is too large to read. 0.10.3 had 265
distinct entries across 15 packages. Users need about 20 lines covering what
breaks, what is new and what changed. The changeset rules below make that summary
mechanical instead of a re-research of every PR.

---

## 1. Writing a changeset

The existing rules in CLAUDE.md / AGENTS.md ("Changeset Versioning") still apply:

- Use scoped package names.
- Default to `patch`.

The rules here only govern the **body**.

### Body structure

```md
---
"@n-dx/core": patch
---

<Lead sentence: the user-visible effect.>

Action needed: <exact command or config change>.   <- only when the user must act

<Detail paragraphs: mechanism, edge cases, refusals, as today.>

Soft freeze: <surface impact>.                    <- only when a frozen surface changes
```

**Lead sentence.** The summary is built from this sentence, so it must stand alone.

- Name the command, flag, setting or dashboard page in backticks.
- State what the user now sees or can do, in present tense.
- Keep it to 30 words or fewer.
- Put mechanism ("because X binds only 127.0.0.1") in the detail paragraphs, not
  in the lead.

**`Action needed:` paragraph.** Add it when an existing user can be broken, blocked
or surprised without doing something. Write the exact command, setting or env var
they need. Typical triggers:

- A default changes, such as a limit, a sandbox, or a fetch that no longer happens.
- A setting is now ignored in a file where it used to be honored (for example, a
  tracked `.n-dx.json`).
- Data or config moves to a new location, such as keys moving into the credential
  store.
- A printed URL, port or registration line changes, so clients must re-register.
- A command now writes, commits or refuses something it did not before.
- Environment variables, tools or network access are newly withheld from agent
  processes.
- A run can now refuse to start (for example, no sandbox backend is available).

If an opt-out exists, name it together with where it is allowed to live, such as
"`NDX_SANDBOX=off`, local or user config only".

**Experimental features.** Put the flag and its state in the lead, for example
"(experimental, off by default; enable with `web.sidecar`)". This keeps the
summary from presenting it as a stable feature.

**Internal-only changes.** Start the body with `Internal:` or `Test-only:` when
nothing user-visible changes. The existing `Test-only:` usage already follows this.
That covers:

- tests and CI
- refactors
- docs-only edits
- TypeScript exports
- MCP/HTTP shapes with no CLI or dashboard effect

The summary skips these entries.

**Security-relevant changes.**

- Describe the protection and the user action, not a reproduction recipe.
- Never put key values, tokens or real paths from a user's machine in a changeset.
- Coordinate anything unfixed with SECURITY.md before it lands in a public file.

**Splitting changes.** Write one user-visible effect per changeset where practical.
A PR that changes five behaviours should carry five changesets, not one paragraph.
The summary can merge related entries, but it cannot cleanly split a combined one.

### Self-check before committing a changeset

- Read only the lead sentence. Does it say what changed for a user?
- Could an existing setup break or be blocked? If yes, is there an
  `Action needed:` paragraph with an exact remedy?
- Is the entry internal-only? If yes, is it marked `Internal:` or `Test-only:`?

`tests/e2e/changeset-body-policy.test.js` enforces the mechanical parts: lead length and marker placement. Fix a failing body instead of adding it to the test's grandfather list.

---

## 2. Summarizing a release

### Gather

Extract the version's entries from every package and dedupe them. The same entry
appears in several packages' changelogs.

```sh
v=0.10.3
# Each section runs from "## <v>" to the next "## " heading; anything outside it
# belongs to another version and must not be summarized.
for f in packages/*/CHANGELOG.md; do
  awk -v h="## $v" '$0==h{f=1;next} /^## /{f=0} f' "$f"
done | grep -E '^- \[#' | sort -u > /tmp/ndx-$v-entries.txt
```

This captures only each entry's first line. Read the full entry in `CHANGELOG.md`
before summarizing anything that could be in "Action may be needed".

Confirm the release really shipped before calling it released:

- `npm view @n-dx/core@$v version`
- `git tag -l "@n-dx/core@$v"`

### Classify

Drop these entries:

- `Internal:` and `Test-only:` entries
- dependency-only "Updated dependencies" entries
- message-wording-only entries (look for "message text only")
- TypeScript-export, MCP tool and HTTP route changes with no CLI or dashboard
  effect
- docs-only changes

Sort what remains into:

1. **Action may be needed.** Any entry with `Action needed:`, plus any older-style
   entry that matches the triggers in section 1. Older entries predate this
   convention, so scan the detail paragraphs for words such as "no longer",
   "refuses", "ignored", "instead of", "re-register", "default", "moves" and
   "now writes/commits".
2. **New.** New commands, flags, settings, pages or tools.
3. **Changed / improved.** Fixes and behaviour changes that need no action.

Merge entries that describe one user-visible effect. 0.10.3, for example, has
roughly a dozen credential-store entries, which become two or three bullets. Order
each section by impact, highest first.

### Write

```md
**Action may be needed**
- <effect>. <exact remedy or opt-out>.

**New**
- `<command / setting>` <what it does>.

**Changed / improved**
- <effect>.
```

Bullet rules:

- Write one sentence of effect, plus at most one sentence of remedy.
- Put every command, flag, setting, env var and path in backticks, exactly as the
  CLI accepts it.
- Mark experimental features as experimental and give the enabling flag.
- Do not include PR links, commit hashes or contributor thanks. These stay in the
  per-package changelogs.
- Close the summary with one line pointing readers to the per-package GitHub
  releases or `CHANGELOG.md` for full detail.

### Verify (required before publishing)

- Every bullet traces to at least one entry in this version's section. No bullet
  may come from memory or from a neighbouring version.
- Every command and flag named exists. Check `ndx <cmd> --help` or grep
  `packages/core/` and the package that owns it.
- Every "Action may be needed" bullet states a remedy that the full entry
  actually supports.
- Nothing internal-only, unshipped or behind a flag is presented as default
  behaviour.

### Where it goes

Write the summary to the path the operator names.

`docs/releases/<version>.md` exists for minor releases (0.8.0, 0.10.0) and uses
longer prose. A patch summary in this bullet format is a different style. Ask
before adding a patch file there, and before adding it to the docs nav in
`docs/.vitepress/config.*`.

## Done when

- **Writing a changeset:** the file is in `.changeset/` and passes the
  self-check above. This skill does not commit, push or open a PR; that belongs
  to the work that needed the changeset.
- **Summarizing a release:** the summary is at the path the operator named and
  every verification item holds. Do not publish, post or announce it unless
  asked; publishing is a separate step.
