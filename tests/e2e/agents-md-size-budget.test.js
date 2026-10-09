/**
 * `AGENTS.md` must stay inside the budget Codex reads it under.
 *
 * Codex builds its project instructions by walking up from the working
 * directory to the project root and reading each `AGENTS.md` it finds, up to
 * `project_doc_max_bytes` — "Maximum bytes read from `AGENTS.md` when building
 * project instructions" (Codex config reference,
 * https://learn.chatgpt.com/docs/config-file/config-reference). Past that it
 * reads only part of the guidance. Nothing is logged and no error is raised:
 * the tail is simply absent, and every test stays green while Codex runs
 * without whatever was at the end.
 *
 * What that costs here is specific. `renderAgentsMd` puts the Codex-operational
 * sections last — Workflow, Available Skills, MCP Servers, When to Use Each
 * Server, Codex Troubleshooting — so the first thing a size overrun takes is
 * the workflow steps and the MCP tool reference, which is the half Codex
 * cannot work without.
 *
 * ## About the limit
 *
 * The docs name the setting and describe the truncation, but **do not publish a
 * default value** — config-basic, config-reference and config-advanced all
 * describe `project_doc_max_bytes` without a number. 32 KiB is the figure
 * Codex has historically shipped and the one this repository's review captured,
 * so it is used here as a *project budget* rather than quoted as a documented
 * constant. The margin below is ours as well: the point is to fail a pull
 * request while there is still room to act, not at the moment Codex starts
 * dropping text.
 *
 * A package's budget is the whole chain, not its own file: Codex reads the root
 * and the nested file together, so `packages/web/AGENTS.md` is spent out of
 * what the root leaves behind.
 *
 * @see tests/e2e/assistant-body-drift.test.js — the committed files match the generator
 * @see packages/core/assistant-assets.js — `renderAgentsMd`
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderAgentsMd } from "../../packages/core/assistant-assets.js";

const ROOT = join(import.meta.dirname, "../..");

/**
 * The byte ceiling Codex is assumed to read under. Not a documented default
 * (see the header) — the figure Codex has shipped, treated as this project's
 * budget.
 */
const CODEX_PROJECT_DOC_LIMIT = 32 * 1024;

/**
 * How much of the budget is left unspent, so a pull request fails while there
 * is still room to move text rather than once Codex is already dropping it.
 */
const MARGIN = 2 * 1024;

const BUDGET = CODEX_PROJECT_DOC_LIMIT - MARGIN;

const bytes = (text) => Buffer.byteLength(text, "utf-8");

/** Every package that ships its own `AGENTS.md`, with that file's size. */
function nestedAgentsFiles() {
  const dir = join(ROOT, "packages");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => ({ name, path: join(dir, name, "AGENTS.md") }))
    .filter((p) => existsSync(p.path))
    .map((p) => ({ ...p, size: bytes(readFileSync(p.path, "utf-8")) }));
}

/** What to do about it, named in the failure rather than left to the reader. */
const ADVICE =
  "Codex reads the root AGENTS.md and the package's together, and stops at " +
  `project_doc_max_bytes (~${CODEX_PROJECT_DOC_LIMIT} bytes). Past that it ` +
  "silently drops the rest — for the root that is the Workflow, Skills and " +
  "MCP sections, which renderAgentsMd puts last. Move prose into docs/ and " +
  "link it, or shorten a section, rather than raising this budget.";

describe("AGENTS.md stays inside Codex's project-doc budget", () => {
  it("renders a root AGENTS.md under the budget", () => {
    const size = bytes(renderAgentsMd(ROOT));

    expect(
      size,
      `The generated root AGENTS.md is ${size} bytes, over the ${BUDGET}-byte ` +
        `budget (${CODEX_PROJECT_DOC_LIMIT} minus a ${MARGIN}-byte margin). ${ADVICE}`,
    ).toBeLessThanOrEqual(BUDGET);
  });

  it("reports the chain each package costs, so a breach is visible before it is fixed", () => {
    // Codex reads the root and the package's file together, so a package's real
    // budget is what the root leaves behind. This is a measurement rather than
    // an assertion: `packages/web/AGENTS.md` is over today, and trimming it is
    // its own task (PRD fabfa3a2). Asserting here would make this guard red for
    // a defect it is not the fix for — and a guard that cannot be committed
    // green guards nothing.
    //
    // Turn this into an assertion as part of that task.
    const rootSize = bytes(renderAgentsMd(ROOT));
    const chains = nestedAgentsFiles().map((pkg) => ({
      name: pkg.name,
      chain: rootSize + pkg.size,
      over: rootSize + pkg.size - CODEX_PROJECT_DOC_LIMIT,
    }));

    expect(chains.length).toBeGreaterThanOrEqual(4);
    for (const c of chains) {
      if (c.over > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[agents-md-size] packages/${c.name}: chain ${c.chain} bytes, ` +
            `${c.over} over the ${CODEX_PROJECT_DOC_LIMIT}-byte budget — Codex drops the tail.`,
        );
      }
    }

    // What this guard does assert: the root leaves room for a package file at
    // all. At zero headroom every package is truncated and no per-package trim
    // can fix it.
    const headroom = CODEX_PROJECT_DOC_LIMIT - rootSize;
    expect(
      headroom,
      `The root AGENTS.md leaves only ${headroom} bytes for any package's own ` +
        `AGENTS.md. ${ADVICE}`,
    ).toBeGreaterThan(2048);
  });

  it("reads a plausible set of files, so the budget assertions cannot pass vacuously", () => {
    // If the renderer or the package scan broke, the assertions above would
    // pass by measuring nothing.
    expect(bytes(renderAgentsMd(ROOT))).toBeGreaterThan(5000);
    const nested = nestedAgentsFiles();
    expect(nested.length).toBeGreaterThanOrEqual(4);
    for (const pkg of nested) expect(pkg.size, pkg.name).toBeGreaterThan(0);
  });
});
