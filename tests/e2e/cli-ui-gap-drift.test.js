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
import { readFileSync } from "node:fs";
import {
  DOC_PATH,
  BEGIN_MARKER,
  END_MARKER,
  UNDECLARED,
  buildCliUiGap,
  renderCommandEffectsSection,
} from "../../scripts/build-cli-ui-gap.mjs";
import { getOrchestratorCommands } from "../../packages/core/help.js";

describe("docs/cli-ui-gap.md command effects section", () => {
  it("matches what the generator produces", () => {
    const committed = readFileSync(DOC_PATH, "utf-8");
    expect(committed, "docs/cli-ui-gap.md is stale — run: node scripts/build-cli-ui-gap.mjs").toBe(
      buildCliUiGap(committed),
    );
  });

  it("lists every orchestrator command, none undeclared", () => {
    const committed = readFileSync(DOC_PATH, "utf-8");
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
