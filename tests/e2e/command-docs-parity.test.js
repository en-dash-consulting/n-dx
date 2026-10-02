/**
 * Locks the hand-kept command references to the orchestrator command registry.
 *
 * Every command returned by getOrchestratorCommands() (packages/core/help.js)
 * must appear as a `ndx <command>` row in the README "## Commands" section and
 * in docs/guide/commands.md. Adding a registry command without documenting it
 * fails here; the row text itself stays hand-written.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { getOrchestratorCommands } from "../../packages/core/help.js";

const ROOT = join(import.meta.dirname, "../..");

/**
 * Delegation entries: documented once in the README "Direct Tool Access" block
 * (`ndx rex|hench|sourcevision <command>`; `sv` is an alias), not as table rows.
 */
const DELEGATION_EXEMPT = new Set(["rex", "hench", "sourcevision", "sv"]);

/** The README body from "## Commands" up to the next top-level section. */
function readmeCommandsSection() {
  const readme = readFileSync(join(ROOT, "README.md"), "utf-8");
  const start = readme.indexOf("\n## Commands\n");
  if (start === -1) throw new Error('README.md has no "## Commands" section');
  const end = readme.indexOf("\n## ", start + 1);
  return readme.slice(start, end === -1 ? undefined : end);
}

/** True when a table row starts with the command: `ndx <name>` then a space, bracket, pipe or closing tick. */
function documents(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  return new RegExp("^\\| `ndx " + escaped + "(?=[ `|\\[\\\\])", "m").test(text);
}

const registry = getOrchestratorCommands().filter((c) => !DELEGATION_EXEMPT.has(c));

describe("command reference parity with the help registry", () => {
  it("the exemption list only names real registry commands", () => {
    const all = new Set(getOrchestratorCommands());
    for (const name of DELEGATION_EXEMPT) expect(all.has(name), name).toBe(true);
  });

  it("README Commands section documents every registry command", () => {
    const section = readmeCommandsSection();
    const missing = registry.filter((c) => !documents(section, c));
    expect(missing).toEqual([]);
  });

  it("docs/guide/commands.md documents every registry command", () => {
    const guide = readFileSync(join(ROOT, "docs/guide/commands.md"), "utf-8");
    const missing = registry.filter((c) => !documents(guide, c));
    expect(missing).toEqual([]);
  });
});
