# Codex Transport and Artifact Decisions (First Pass)

**Date:** 2026-03-31
**Status:** Locked
**Epic:** Codex Workflow Parity (eeb9eaa6)
**Task:** Lock initial Codex transport and artifact decisions (3f98efc4)

These decisions establish the baseline for Codex artifact generation and init
behavior. They are intentionally conservative first-pass choices. Each section
notes what is deferred.

---

## 1. MCP Transport: stdio for init, HTTP as manual upgrade

**Decision:** `ndx init` registers Codex MCP servers via **stdio transport**.

| Property | Value |
|----------|-------|
| Transport | stdio (spawn per server) |
| Rex command | `node packages/rex/dist/cli/index.js mcp <dir>` |
| SourceVision command | `node packages/sourcevision/dist/cli/index.js mcp <dir>` |
| Config location | `.codex/config.toml` `[mcp_servers.rex]` / `[mcp_servers.sourcevision]` |
| Session management | Not applicable (stdio is stateless per invocation) |

**Rationale:**

- Matches the current Claude init behavior (stdio via `claude mcp add`).
- Does not require `ndx start` to be running, so MCP works immediately after init.
- Avoids fixed-port drift: stdio resolves paths at spawn time, not at config-write time.
- HTTP transport remains available as a documented manual upgrade path via `ndx start`.

**Deferred:**

- Auto-registering HTTP transport for Codex after `ndx start`.
- Transport auto-detection or negotiation during init.
- Dynamic transport switching at runtime.

---

## 2. AGENTS.md: generated, canonical shared guidance

**Decision:** `ndx init` generates a project-local `AGENTS.md` from the shared
assistant asset layer. AGENTS.md is the **canonical shared guidance surface** for
repo-level workflow instructions.

| Property | Value |
|----------|-------|
| File | `AGENTS.md` (project root) |
| Generator | `assistant-assets/` render pipeline |
| Content | n-dx workflow description, available skills, MCP capabilities, Rex/SourceVision usage guidance |
| Ownership | Generated output, not hand-edited source of truth |
| Git tracking | **Tracked** (checked in) — assistants read it from the worktree |

**Relationship to CLAUDE.md:**

- `CLAUDE.md` remains the Claude-facing instruction surface.
- `CLAUDE.md` will import `@AGENTS.md` to inherit shared guidance, plus any
  Claude-only additions (settings paths, Claude-specific troubleshooting).
- Both files are derived from the same assistant asset source.

**Relationship to CODEX.md:**

- `CODEX.md` currently exists as a manual mirror of `CLAUDE.md` with a
  troubleshooting addendum.
- Once `AGENTS.md` is generated, `CODEX.md` becomes a compatibility artifact.
  Its long-term role (retire vs. keep as Codex-only addendum) is deferred.

**Deferred:**

- Migrating `CLAUDE.md` to use `@AGENTS.md` import syntax (requires
  the instruction-loading alignment task in the Runtime Identity Guardrails
  feature).
- Deciding `CODEX.md` retirement timeline.
- Directory-scoped `AGENTS.md` files for sub-package guidance.

---

## 3. Generated Skill Locations

**Decision:** Skills are written to vendor-specific directories using
`writeVendorSkills()` from the canonical asset layer. Both outputs are
generated and gitignored.

| Property | Claude | Codex |
|----------|--------|-------|
| Directory | `.claude/skills/{name}/` | `.agents/skills/{name}/` |
| File | `SKILL.md` | `SKILL.md` |
| Wrapper | YAML frontmatter (name, description, argument-hint) | Plain markdown (no frontmatter) |
| Tool prefix in body | `mcp__{server}__{tool}` | `{tool}` (no prefix) |
| Git tracking | Gitignored | Gitignored |

These values are already encoded in `assistant-assets/manifest.json` under
`vendors.claude` and `vendors.codex`. No manifest changes are needed.

**Rationale:**

- `.claude/skills/` matches Claude Code's skill discovery convention.
- `.agents/skills/` matches Codex's repository-local skill discovery convention.
- Both are generated outputs from one source of truth, so they should not be
  checked in.

**Deferred:**

- Skill argument validation or structured parameter schemas.
- Per-skill enablement toggles in `.n-dx.json`.

---

## 4. Init Defaults: provision both assistants

**Decision:** `ndx init` provisions **both** Claude and Codex assistant artifacts
by default, regardless of the selected `llm.vendor`.

| Behavior | Default | Override |
|----------|---------|----------|
| Claude artifacts | Written | `--no-claude` skips |
| Codex artifacts | Written | `--no-codex` skips |
| `llm.vendor` | User-selected (prompt or `--provider=`) | Controls Hench runtime, not artifact generation |

**Rationale:**

- A repository can be used from both Claude Code and Codex simultaneously.
  Users frequently switch between assistants.
- `llm.vendor` selects the Hench execution runtime (which model runs tasks),
  not which assistant surfaces are provisioned in the repo.
- Generating both is cheap (a few markdown files) and avoids the confusing
  state where a user opens a repo in the other assistant and finds no workflow
  guidance.

**Backward compatibility:**

- Existing `--no-claude` flag continues to work.
- New `--no-codex` flag added for users who want to exclude Codex artifacts.
- If neither assistant's CLI is available on the system, init still writes the
  artifacts (they are just files; no runtime dependency on the assistant CLI
  being installed).

**Deferred:**

- Auto-detecting which assistants are installed and adapting the summary output.
- Per-assistant configuration sections in `.n-dx.json`.
- `ndx init --only-claude` / `--only-codex` convenience aliases.

---

## 5. .codex/config.toml: MCP-only scope

**Decision:** The generated `.codex/config.toml` contains **only MCP server
definitions** in the first pass. No sandbox, approval, or model configuration.

```toml
# Generated by ndx init — do not edit manually.
# Re-run `ndx init` to regenerate.

[mcp_servers.rex]
command = "node"
args = ["packages/rex/dist/cli/index.js", "mcp", "."]

[mcp_servers.sourcevision]
command = "node"
args = ["packages/sourcevision/dist/cli/index.js", "mcp", "."]
```

**Rationale:**

- MCP access is the minimum requirement for Codex to participate in the n-dx
  workflow (read PRD, update task status, query codebase analysis).
- Sandbox and approval configuration belongs to the runtime identity guardrails
  feature, not artifact generation.
- Keeping the generated config minimal reduces the surface area for conflicts
  with user-managed Codex settings.

**Deferred:**

- Generating `sandbox_mode` and `approval_policy` settings (blocked on the
  normalized runtime contract task).
- Generating `model` or `provider` settings.
- `project_doc_fallback_filenames` configuration.
- Merging with existing user `.codex/config.toml` (analogous to Claude's
  `settings.local.json` merge behavior).

---

## 6. Summary of Locked Decisions

| Decision | Choice | Manifest field |
|----------|--------|---------------|
| Codex MCP transport | stdio | N/A (init-time behavior) |
| AGENTS.md | Generated, canonical shared guidance | `vendors.codex.instructionFile` |
| Codex skill directory | `.agents/skills/{name}/SKILL.md` | `vendors.codex.skillDir` + `skillFile` |
| Codex skill wrapper | Plain markdown, no frontmatter | `vendors.codex.skillWrapper` |
| Codex tool prefix | None (bare tool names) | `vendors.codex.toolPrefix` |
| Init default | Provision both assistants | N/A (init-time behavior) |
| `.codex/config.toml` scope | MCP servers only | N/A (init-time behavior) |

---

## 7. Downstream Task Implications

These decisions unblock the following tasks:

- **Generate AGENTS.md during ndx init** (6b1b809b): Use the render pipeline
  from `assistant-assets/` to emit `AGENTS.md` with workflow guidance, skill
  listing, and MCP capability descriptions.

- **Generate .agents skill directories for Codex** (ceb4b95d): Call
  `writeVendorSkills("codex", dir)` — the function and manifest target already
  exist.

- **Generate .codex/config.toml MCP definitions** (73346263): Write the stdio
  MCP entries shown in section 5. Use `assistant-assets/manifest.json`
  `mcpServers` to derive server names, packages, and entrypoints.

- **Define normalized Claude/Codex runtime contract** (547ba5e2): The transport
  and artifact decisions here are inputs to the runtime contract — they define
  the "what is provisioned" half; the runtime contract defines the "how it
  behaves" half.

---

## References

- `assistant-assets/manifest.json` — vendor targets and MCP server descriptors
- `assistant-assets/index.js` — render contract API and `writeVendorSkills()`
- `claude-integration.js` — reference Claude init integration pattern
- `docs/analysis/claude-codex-runtime-identity-discovery.md` — runtime identity analysis
- Codex config reference: https://developers.openai.com/codex/config-reference
- Codex MCP guide: https://developers.openai.com/codex/mcp
- Codex AGENTS.md guide: https://developers.openai.com/codex/guides/agents-md
