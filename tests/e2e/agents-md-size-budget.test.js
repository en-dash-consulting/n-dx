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

/**
 * Every `AGENTS.md` under `packages/`, at any depth, with its own size and the
 * chain Codex reads to reach it: the root file plus every `AGENTS.md` between
 * the package root and this one. A nested file does not replace its parents —
 * Codex concatenates them — so the chain is what has to fit, not the file.
 */
function nestedAgentsFiles(rootSize) {
  const dir = join(ROOT, "packages");
  if (!existsSync(dir)) return [];

  const found = [];
  const walk = (abs, rel, inherited) => {
    const here = join(abs, "AGENTS.md");
    const chain = existsSync(here)
      ? [...inherited, { rel: `${rel}/AGENTS.md`, size: bytes(readFileSync(here, "utf-8")) }]
      : inherited;
    if (existsSync(here)) {
      found.push({
        name: rel,
        size: chain.at(-1).size,
        chain: rootSize + chain.reduce((n, f) => n + f.size, 0),
        files: chain.map((f) => f.rel),
      });
    }
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === "dist") continue;
      walk(join(abs, entry.name), `${rel}/${entry.name}`, chain);
    }
  };

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(join(dir, entry.name), `packages/${entry.name}`, []);
  }
  return found;
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

  it("keeps every AGENTS.md chain inside the budget", () => {
    // Codex reads the root and every nested `AGENTS.md` down to the working
    // directory as one document, so a package's real budget is what the root
    // leaves behind — and a file nested deeper spends what its parents left.
    // This was a warning until `packages/web/AGENTS.md` was split by directory
    // (PRD fabfa3a2); it is an assertion now that every chain fits.
    const rootSize = bytes(renderAgentsMd(ROOT));
    const chains = nestedAgentsFiles(rootSize);

    expect(chains.length).toBeGreaterThanOrEqual(4);

    const over = chains
      .filter((c) => c.chain > BUDGET)
      .map((c) => `${c.name}: ${c.chain} bytes (${c.files.join(" + ")}, over by ${c.chain - BUDGET})`);

    expect(
      over,
      `Codex reads root + nested AGENTS.md as one chain and drops the tail past ` +
        `${CODEX_PROJECT_DOC_LIMIT} bytes. These chains exceed the ${BUDGET}-byte ` +
        `budget. ${ADVICE}`,
    ).toEqual([]);
  });

  it("leaves a package room for its own guidance", () => {
    // At zero headroom every package is truncated and no per-package trim can
    // fix it, so this fails on the root even when no package file exists yet.
    const headroom = CODEX_PROJECT_DOC_LIMIT - bytes(renderAgentsMd(ROOT));
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
    const nested = nestedAgentsFiles(bytes(renderAgentsMd(ROOT)));
    expect(nested.length).toBeGreaterThanOrEqual(4);
    for (const pkg of nested) expect(pkg.size, pkg.name).toBeGreaterThan(0);
  });
});
