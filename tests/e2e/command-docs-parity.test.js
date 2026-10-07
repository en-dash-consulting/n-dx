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

/** Windows checkouts (core.autocrlf=true) give README.md and docs/*.md CRLF; match on LF. */
const norm = (s) => s.replace(/\r\n/g, "\n");
const toCrlf = (s) => norm(s).replace(/\n/g, "\r\n");

/** The README body from "## Commands" up to the next top-level section. */
function readmeCommandsSection(raw = readFileSync(join(ROOT, "README.md"), "utf-8")) {
  const readme = norm(raw);
  const start = readme.indexOf("\n## Commands\n");
  if (start === -1) throw new Error('README.md has no "## Commands" section');
  const end = readme.indexOf("\n## ", start + 1);
  return readme.slice(start, end === -1 ? undefined : end);
}

/** True when a table row starts with the command: `ndx <name>` then a space, bracket, pipe or closing tick. */
function documents(raw, name) {
  const text = norm(raw);
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

  it("handles CRLF checkouts of the README and the guide", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf-8");
    const guide = readFileSync(join(ROOT, "docs/guide/commands.md"), "utf-8");
    const section = readmeCommandsSection(toCrlf(readme));
    expect(section).toBe(readmeCommandsSection(readme));
    expect(registry.filter((c) => !documents(section, c))).toEqual([]);
    expect(registry.filter((c) => !documents(toCrlf(guide), c))).toEqual([]);
  });

  it("docs/guide/commands.md documents every registry command", () => {
    const guide = readFileSync(join(ROOT, "docs/guide/commands.md"), "utf-8");
    const missing = registry.filter((c) => !documents(guide, c));
    expect(missing).toEqual([]);
  });
});

/** Every command a table row opens with: `| \`ndx <name>`. */
function documentedCommands(raw) {
  return [...norm(raw).matchAll(/^\| `ndx ([a-z][a-z0-9-]*)/gm)].map((m) => m[1]);
}

/**
 * The other direction. A removed command left in a reference is worse than a
 * missing one: the reader runs it and gets "unknown command". packages/core's
 * README is the npm page of the package users install, so it is held to the
 * same rule as the repository README and the guide.
 */
describe("command references name only registry commands", () => {
  const all = new Set(getOrchestratorCommands());

  /**
   * Real commands that cli.js dispatches but COMMAND_REGISTRY does not list, so
   * getOrchestratorCommands() cannot vouch for them. Each entry is a registry
   * gap to close, not a permanent exemption; the staleness check below fails
   * once the command is registered, so the entry has to come out with the fix.
   */
  const KNOWN_UNREGISTERED = new Set(["iso"]);

  it("every known-unregistered command is still missing from the registry", () => {
    for (const name of KNOWN_UNREGISTERED) expect(all.has(name), name).toBe(false);
  });
  const references = {
    "README.md": () => readmeCommandsSection(),
    "docs/guide/commands.md": () => readFileSync(join(ROOT, "docs/guide/commands.md"), "utf-8"),
    "packages/core/README.md": () => readFileSync(join(ROOT, "packages/core/README.md"), "utf-8"),
  };

  for (const [file, read] of Object.entries(references)) {
    it(`${file} documents no command the registry lacks`, () => {
      const rows = documentedCommands(read());
      expect(rows.length, `${file} has no \`ndx <command>\` rows`).toBeGreaterThan(0);
      expect(rows.filter((name) => !all.has(name) && !KNOWN_UNREGISTERED.has(name))).toEqual([]);
    });
  }

  it("flags a row for a command that does not exist", () => {
    expect(documentedCommands("| `ndx sync [dir]` | Sync |\n| `ndx work` | Run |")).toEqual(["sync", "work"]);
    expect(all.has("sync")).toBe(false);
  });
});
