/**
 * docs/cli-ui-gap.md drift regression.
 *
 * The page's "Command effects" section is generated from core's command
 * manifest by `scripts/build-cli-ui-gap.mjs`. Edit a declaration and forget to
 * regenerate, or hand-edit the section, and this fails. It also refuses a
 * generated row marked undeclared: the doc must not list a command whose
 * effects nobody has written down.
 *
 * If it fails, run:  node scripts/build-cli-ui-gap.mjs
 *
 * @see tests/e2e/iso-skill-drift.test.js — the same pattern for the iso-map skill
 */

import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DOC_PATH,
  BEGIN_MARKER,
  END_MARKER,
  UNDECLARED,
  buildCliUiGap,
  renderCommandEffectsSection,
} from "../../scripts/build-cli-ui-gap.mjs";
import { getOrchestratorCommands } from "../../packages/core/help.js";

/** Windows checkouts (core.autocrlf=true) give this page CRLF; compare on LF. */
const norm = (s) => s.replace(/\r\n/g, "\n");
const toCrlf = (s) => norm(s).replace(/\n/g, "\r\n");
const readDoc = () => norm(readFileSync(DOC_PATH, "utf-8"));

describe("docs/cli-ui-gap.md command effects section", () => {
  it("matches what the generator produces", () => {
    const committed = readDoc();
    expect(committed, "docs/cli-ui-gap.md is stale — run: node scripts/build-cli-ui-gap.mjs").toBe(
      buildCliUiGap(committed),
    );
  });

  it("accepts a CRLF checkout of the page", () => {
    const crlf = toCrlf(readDoc());
    expect(norm(crlf)).toBe(norm(buildCliUiGap(crlf)));
    expect(norm(buildCliUiGap(crlf))).toBe(readDoc());
  });

  it("keeps the line ending of the page it regenerates", () => {
    const crlf = toCrlf(readDoc());
    expect(buildCliUiGap(crlf)).toBe(crlf);
    expect(buildCliUiGap(readDoc())).not.toContain("\r");
  });

  it("the script rewrites a stale CRLF copy with CRLF throughout", () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-ui-gap-"));
    try {
      const file = join(dir, "cli-ui-gap.md");
      writeFileSync(file, toCrlf(readDoc()).replace("## Command effects", "## Command effects (stale)"));
      const script = join(import.meta.dirname, "../../scripts/build-cli-ui-gap.mjs");
      const run = spawnSync(process.execPath, [script, file], { encoding: "utf-8" });
      expect(run.status, run.stderr).toBe(0);
      const written = readFileSync(file, "utf-8");
      expect(written).toBe(toCrlf(readDoc()));
      expect(written.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists every orchestrator command, none undeclared", () => {
    const committed = readDoc();
    const section = committed.slice(committed.indexOf(BEGIN_MARKER), committed.indexOf(END_MARKER));
    for (const name of getOrchestratorCommands()) {
      expect(section, name).toContain(`| \`ndx ${name}\` |`);
    }
    expect(section).not.toContain(UNDECLARED);
  });

  it("marks a command without a declaration as undeclared", () => {
    // Guards the guard: if the renderer silently skipped missing commands, the
    // assertion above could never fail.
    const section = renderCommandEffectsSection(["no-such-command"], {});
    expect(section).toContain(`| \`ndx no-such-command\` | ${UNDECLARED}`);
  });
});
